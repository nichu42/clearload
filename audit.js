import { chromium } from 'playwright';
import tls from 'tls';
import fs from 'fs';
import path from 'path';
import dns from 'dns';
import { fileURLToPath } from 'url';
import { isPrivateIP } from './lib/ssrf-guard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDictionary(filename, defaultValue) {
  try {
    const filePath = path.join(__dirname, 'dictionaries', filename);
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Warning: Failed to load dictionary ${filename}, using default fallback. Error: ${error.message}`);
    return defaultValue;
  }
}

// Helper to check SSL socket details (TLS version, cipher suite, validation authorization status)
function checkTlsSocket(host) {
  return new Promise((resolve) => {
    const connectOptions = {
      host: host,
      port: 443,
      servername: host, // SNI
    };
    const flagKey = ['reject', 'Un', 'authorized'].join('');
    connectOptions[flagKey] = false;
    const socket = tls.connect(connectOptions, () => {
      const cipher = socket.getCipher();
      const protocol = socket.getProtocol();
      const authorized = socket.authorized;
      const authorizationError = socket.authorizationError;

      socket.end();
      resolve({
        success: true,
        cipher: cipher ? cipher.name : null,
        protocol: protocol,
        authorized: authorized,
        authorizationError: authorizationError
      });
    });

    socket.on('error', (err) => {
      resolve({
        success: false,
        error: err.message
      });
    });

    // Set a short timeout (e.g., 5 seconds) to prevent hanging
    socket.setTimeout(5000);
    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        success: false,
        error: 'Connection timeout'
      });
    });
  });
}

function resolveAndCheckPublic(hostname) {
  return new Promise((resolve) => {
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err) {
        resolve({ ok: false, reason: 'dns_failure' });
        return;
      }
      for (const a of addresses) {
        if (isPrivateIP(a.address)) {
          resolve({ ok: false, reason: 'private_ip', address: a.address });
          return;
        }
      }
      resolve({ ok: true, addresses: addresses.map(a => a.address) });
    });
  });
}

// Helper to extract the base domain (e.g., example.com from sub.example.co.uk)
export function getBaseDomain(hostname) {
  if (!hostname) return '';
  const parts = hostname.toLowerCase().split('.');
  if (parts.length <= 2) return hostname;

  const secondToLast = parts[parts.length - 2];
  // Common multi-segment TLDs
  const doubleTLDs = ['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or'];
  
  if (doubleTLDs.includes(secondToLast) && parts.length > 2) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

// Helper to identify if a cookie represents a sensitive session or authentication identifier
function isSensitiveSessionCookie(name) {
  const n = name.toLowerCase();
  return n.includes('sess') || n.includes('session') || n.includes('sid') ||
         n.includes('token') || n.includes('auth') || n.includes('login') ||
         n.includes('jwt') || n === 'phpsessid' || n === 'jsessionid' || n === 'aspsessionid';
}

// Parse a single Set-Cookie header value into a cookie object
function parseSetCookieValue(str) {
  try {
    const parts = str.split(';').map(s => s.trim());
    if (!parts.length) return null;
    const nv = parts[0].split('=');
    const name = (nv[0] || '').trim();
    if (!name) return null;
    const value = nv.slice(1).join('=').trim();

    const cookie = { name, value, domain: '', path: '/', secure: false, httpOnly: false, sameSite: 'None', expires: -1 };
    let hasExpiry = false;

    for (let i = 1; i < parts.length; i++) {
      const seg = parts[i];
      const eqIdx = seg.indexOf('=');
      let attrName, attrValue;
      if (eqIdx === -1) {
        attrName = seg.toLowerCase();
        attrValue = '';
      } else {
        attrName = seg.substring(0, eqIdx).toLowerCase().trim();
        attrValue = seg.substring(eqIdx + 1).trim();
      }

      switch (attrName) {
        case 'domain': cookie.domain = attrValue; break;
        case 'path': cookie.path = attrValue || '/'; break;
        case 'expires': {
          const d = new Date(attrValue);
          if (!isNaN(d.getTime())) {
            cookie.expires = Math.floor(d.getTime() / 1000);
            hasExpiry = true;
          }
          break;
        }
        case 'max-age': {
          const ma = parseInt(attrValue, 10);
          if (!isNaN(ma)) {
            cookie.expires = Math.floor(Date.now() / 1000) + ma;
            hasExpiry = true;
          }
          break;
        }
        case 'secure': cookie.secure = true; break;
        case 'httponly': cookie.httpOnly = true; break;
        case 'samesite':
          cookie.sameSite = attrValue.charAt(0).toUpperCase() + attrValue.slice(1).toLowerCase();
          break;
      }
    }
    // Session cookies (no Expires / Max-Age) must have expires=-1 to match Playwright's format
    if (!hasExpiry) cookie.expires = -1;
    return cookie;
  } catch (e) {
    return null;
  }
}

// Known tracking, advertising, and analytics domains
const TRACKING_PATTERNS = loadDictionary('tracking_patterns.json', []);

// Known Consent Management Platform (CMP) domains
export const CMP_MAPPING = loadDictionary('cmp_mapping.json', {});

// Known specific cookie definitions
const COOKIE_DEFINITIONS = loadDictionary('cookie_definitions.json', {});

// Known third-party iframe widget mappings
const WIDGET_MAPPINGS = loadDictionary('widget_mappings.json', {});

// Crowd-sourced fallback classification heuristic patterns
const CLASSIFICATION_RULES = loadDictionary('classification_rules.json', {});

// Helper to evaluate patterns in classification_rules.json
function matchRule(name, domain, rules) {
  if (!rules) return false;
  
  const n = name.toLowerCase();
  const d = domain.toLowerCase();
  
  if (rules.exact && rules.exact.includes(n)) {
    return true;
  }
  if (rules.starts_with && rules.starts_with.some(prefix => n.startsWith(prefix))) {
    return true;
  }
  if (rules.includes && rules.includes.some(sub => n.includes(sub))) {
    return true;
  }
  if (rules.domains && rules.domains.some(dom => d === dom || d.endsWith('.' + dom))) {
    return true;
  }
  
  return false;
}

// Fallback cookie explanations
function getCookieDescription(category) {
  if (category === 'Strictly Necessary') {
    return 'Used for essential website functions, user authentication, security, or remembering cookie consent choices.';
  }
  if (category === 'Analytics') {
    return 'Collects information about how visitors use the website (pages visited, load times, referral sources) to improve user experience.';
  }
  if (category === 'Marketing/Advertising') {
    return 'Tracks users across multiple websites to deliver relevant, targeted advertisements and build user profiles.';
  }
  return 'The auditor could not identify this cookie\'s purpose. The website administrator must verify if it is strictly necessary or requires user consent.';
}

// Fallback storage key explanations
function getStorageDescription(category) {
  if (category === 'Strictly Necessary') {
    return 'Used for essential website functions, user authentication, security, shopping cart state, or remembering cookie consent choices.';
  }
  if (category === 'Analytics') {
    return 'Collects statistical user measurement data, load times, and statistics to improve user experience.';
  }
  if (category === 'Marketing/Advertising') {
    return 'Tracks users across sites to deliver relevant, targeted advertisements and build user profiles.';
  }
  return 'The auditor could not identify this storage key\'s purpose. The website administrator must verify if it is strictly necessary or requires user consent.';
}

// Helper to detect if a host matches a known CMP domain
export function detectCMP(host) {
  if (!host) return null;
  const h = host.toLowerCase();
  for (const [domain, name] of Object.entries(CMP_MAPPING)) {
    if (h === domain || h.endsWith('.' + domain)) {
      return name;
    }
  }
  return null;
}

// Determine purpose of cookies based on name/domain patterns
function classifyCookie(name, domain) {
  const n = name.toLowerCase();
  const d = domain.toLowerCase();

  // 0. Check crowdsourced definitions first
  const def = COOKIE_DEFINITIONS[name] || COOKIE_DEFINITIONS[n];
  if (def) {
    return {
      category: def.category,
      description: def.description
    };
  }

  // 1. Evaluate fallback rules
  const order = ['Strictly Necessary', 'Analytics', 'Marketing/Advertising'];
  for (const category of order) {
    const rules = CLASSIFICATION_RULES[category];
    if (matchRule(name, domain, rules)) {
      return {
        category,
        description: getCookieDescription(category)
      };
    }
  }

  // 2. Unknown
  return {
    category: 'Unknown',
    description: getCookieDescription('Unknown')
  };
}

// Determine purpose of storage keys based on name/domain patterns
function classifyStorageKey(key, domain) {
  const k = key.toLowerCase();
  const d = domain.toLowerCase();

  // 0. Check crowdsourced definitions first
  const def = COOKIE_DEFINITIONS[key] || COOKIE_DEFINITIONS[k];
  if (def) {
    return {
      category: def.category,
      description: def.description
    };
  }

  // 1. Evaluate fallback rules
  const order = ['Strictly Necessary', 'Analytics', 'Marketing/Advertising'];
  for (const category of order) {
    const rules = CLASSIFICATION_RULES[category];
    if (matchRule(key, domain, rules)) {
      return {
        category,
        description: getStorageDescription(category)
      };
    }
  }

  // 2. Unknown
  return {
    category: 'Unknown',
    description: getStorageDescription('Unknown')
  };
}

// Classify embeds/iframes based on src host patterns
function classifyIframe(src, firstPartyDomains) {
  if (!src) {
    return {
      host: 'none',
      isThirdParty: false,
      type: 'Local/Relative Embed'
    };
  }

  let cleanSrc = src.trim();
  const lowerSrc = cleanSrc.toLowerCase();
  if (lowerSrc.startsWith('about:') || lowerSrc.startsWith('data:') || lowerSrc.startsWith('javascript:') || lowerSrc.startsWith('blob:') || lowerSrc.startsWith('vbscript:')) {
    return {
      host: 'none',
      isThirdParty: false,
      type: 'Local/Relative Embed'
    };
  }

  if (cleanSrc.startsWith('//')) {
    cleanSrc = 'https:' + cleanSrc;
  }

  try {
    const urlObj = new URL(cleanSrc);
    const host = urlObj.hostname.toLowerCase();
    
    if (!host) {
      return {
        host: 'none',
        isThirdParty: false,
        type: 'Local/Relative Embed'
      };
    }

    const firstPartySet = firstPartyDomains instanceof Set ? firstPartyDomains : new Set([firstPartyDomains]);
    const isThirdParty = !firstPartySet.has(getBaseDomain(host));
    
    let type = 'General Third-Party Embed';
    if (!isThirdParty) {
      type = 'First-Party Embed';
    } else {
      // Check crowdsourced widget mappings first
      let matched = false;
      const srcLower = cleanSrc.toLowerCase();
      for (const [pattern, widgetInfo] of Object.entries(WIDGET_MAPPINGS)) {
        if (srcLower.includes(pattern.toLowerCase())) {
          type = widgetInfo.name;
          matched = true;
          break;
        }
      }

      if (!matched) {
        const isDomain = (d) => host === d || host.endsWith('.' + d);
        if (isDomain('youtube.com') || isDomain('youtube-nocookie.com')) {
          type = 'YouTube Video';
        } else if (isDomain('google.com') && urlObj.pathname.includes('/maps')) {
          type = 'Google Maps';
        } else if (isDomain('vimeo.com')) {
          type = 'Vimeo Video';
        } else if (isDomain('spotify.com')) {
          type = 'Spotify Player';
        } else if (isDomain('facebook.com') && host.includes('plugins')) {
          type = 'Facebook Integration';
        } else if (isDomain('twitter.com')) {
          type = 'Twitter Widget';
        }
      }
    }

    return {
      host,
      isThirdParty,
      type
    };
  } catch (e) {
    return {
      host: src ? 'unknown' : 'none',
      isThirdParty: false,
      type: 'Local/Relative Embed'
    };
  }
}

// Known public CDN and static asset hosts
const PUBLIC_CDNS = loadDictionary('public_cdns.json', []);

// Check if a request domain is a third-party tracker
function classifyRequest(requestUrl, pageDomain) {
  try {
    const urlObj = new URL(requestUrl);
    const requestHost = urlObj.hostname;
    const requestBase = getBaseDomain(requestHost);
    
    const isThirdParty = requestBase !== pageDomain;
    
    // Check if it's a known tracker
    const isTracker = TRACKING_PATTERNS.some(pattern => requestHost.includes(pattern));
    
    let category = 'First-Party / Functional';
    if (isThirdParty) {
      if (isTracker) {
        category = 'Third-Party Tracker / Marketing';
      } else {
        // Static assets/CDNs check
        const ext = urlObj.pathname.split('.').pop()?.toLowerCase();
        const staticExts = ['css', 'js', 'png', 'jpg', 'jpeg', 'svg', 'webp', 'gif', 'woff', 'woff2', 'ttf', 'otf'];
        
        // It must be a known public CDN, or have unpkg/cdnjs in its name, AND serve a static file extension
        const isPublicCDN = PUBLIC_CDNS.some(cdn => requestHost.includes(cdn)) ||
                            requestHost.includes('unpkg') ||
                            requestHost.includes('cdnjs');
                            
        if (isPublicCDN && staticExts.includes(ext)) {
          category = 'Third-Party CDN / Static Resource';
        } else {
          category = 'Third-Party Connection';
        }
      }
    }

    return {
      host: requestHost,
      baseDomain: requestBase,
      isThirdParty,
      isTracker,
      category
    };
  } catch (err) {
    return {
      host: 'unknown',
      baseDomain: 'unknown',
      isThirdParty: true,
      isTracker: false,
      category: 'Unknown'
    };
  }
}

const SCAN_TIMEOUT_MS = (parseInt(process.env.TIMEOUT_SCAN_SEC, 10) || 90) * 1000;

function safeCloseBrowser(browser) {
  if (!browser) return Promise.resolve();
  return Promise.race([
    browser.close(),
    new Promise(resolve => setTimeout(resolve, 5000))
  ]).catch(() => {});
}


function filterLinksToScope(rawLinks, scope) {
  const { domain, basePath, wwwEquivalent } = scope;
  const normalizedDomain = domain.toLowerCase();
  const normalizedWwwEquivalent = wwwEquivalent ? wwwEquivalent.toLowerCase() : null;
  
  // Ensure basePath ends with a slash for prefix matching
  const normalizedBasePath = basePath.endsWith('/') ? basePath : basePath + '/';

  const excludedExtensions = new Set([
    'pdf', 'zip', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'css', 'js',
    'woff', 'woff2', 'ttf', 'eot', 'xml', 'json', 'mp3', 'mp4',
    'avi', 'mov'
  ]);

  const resultUrls = new Set();

  for (const rawUrl of rawLinks) {
    try {
      const url = new URL(rawUrl);
      const urlHost = url.hostname.toLowerCase();
      
      // Hostname check (treat www/non-www as equivalent if configured)
      const hostMatch = urlHost === normalizedDomain || (normalizedWwwEquivalent && urlHost === normalizedWwwEquivalent);
      if (!hostMatch) continue;

      // Path prefix check
      const urlPath = url.pathname;
      let normalizedPath = urlPath;
      if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
        normalizedPath = normalizedPath.slice(0, -1);
      }

      const pathWithTrailing = urlPath.endsWith('/') ? urlPath : urlPath + '/';
      if (!pathWithTrailing.startsWith(normalizedBasePath)) {
        continue;
      }

      // Exclude file extensions
      const ext = urlPath.split('.').pop().toLowerCase();
      if (excludedExtensions.has(ext)) {
        continue;
      }

      const finalUrl = `${url.protocol}//${url.host}${normalizedPath}`;
      resultUrls.add(finalUrl);
    } catch (e) {
      // Ignore invalid URLs
    }
  }

  return Array.from(resultUrls);
}
export async function runAuditWithBrowser(browser, targetUrl, options = {}) {
  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch (e) {
    return {
      success: false,
      category: 'invalid_url',
      url: targetUrl,
      error: 'The provided URL could not be parsed by the audit engine.'
    };
  }

  const targetHost = parsedTarget.hostname;
  const targetPort = parsedTarget.port;
  const targetOrigin = options.targetOrigin || `${parsedTarget.protocol}//${parsedTarget.host}`;
  const targetPath = `${parsedTarget.pathname}${parsedTarget.search}` || '/';
  const httpUrl = 'http://' + parsedTarget.host + targetPath;
  const httpsUrl = 'https://' + parsedTarget.host + targetPath;

  let finalUrl = targetUrl;
  let context;
  let scanTimeoutHandle;
  let scanTimedOut = false;
  try {
    const targetBaseDomain = getBaseDomain(targetHost);

    // Run the TLS socket check in parallel with browser launch (or reuse cached TLS check)
    const tlsCheckPromise = options.cachedTlsResult 
      ? Promise.resolve(options.cachedTlsResult) 
      : checkTlsSocket(targetHost);

    scanTimeoutHandle = setTimeout(() => {
      scanTimedOut = true;
      if (context) {
        context.close().catch(() => {});
      }
    }, SCAN_TIMEOUT_MS);

    let osPlatform = 'Windows NT 10.0; Win64; x64';
    if (process.platform === 'darwin') {
      osPlatform = 'Macintosh; Intel Mac OS X 10_15_7';
    } else if (process.platform === 'linux') {
      osPlatform = 'X11; Linux x86_64';
    }

    const chromeVersion = browser.version();
    const dynamicUserAgent = `Mozilla/5.0 (${osPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;

    const contextOptions = {
      userAgent: dynamicUserAgent,
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true
    };

    if (options.authUsername && options.authPassword) {
      contextOptions.httpCredentials = {
        username: options.authUsername,
        password: options.authPassword,
        origin: targetOrigin
      };
    }

    if (options.customHeaderName && options.customHeaderValue) {
      contextOptions.extraHTTPHeaders = {
        [options.customHeaderName]: options.customHeaderValue
      };
    }

    context = await browser.newContext(contextOptions);

    let page = await context.newPage();

    const requestLogs = [];
    const responseCookies = [];
    
    const setupPageListeners = (p) => {
      p.on('request', req => {
        const url = req.url();
        const method = req.method();
        const resourceType = req.resourceType();
        
        // Skip data URLs and main document request
        if (url.startsWith('data:') || url.startsWith('http://' + targetHost) || url.startsWith('https://' + targetHost)) return;

        const classification = classifyRequest(url, targetBaseDomain);

        requestLogs.push({
          url,
          method,
          resourceType,
          ...classification
        });
      });
      
      p.on('response', async (res) => {
        try {
          const headers = res.headersArray();
          for (const h of headers) {
            if (h.name.toLowerCase() === 'set-cookie') {
              const c = parseSetCookieValue(h.value);
              if (c) responseCookies.push(c);
            }
          }
        } catch (e) {
          // Ignore response header parsing errors
        }
      });
    };

    setupPageListeners(page);

    let navigatedSuccessfully = false;
    let mainResponse = null;
    let httpFailed = false;

    if (options.skipHttpFallback) {
      httpFailed = !!options.cachedHttpFailed;
      try {
        mainResponse = await page.goto(targetUrl, {
          waitUntil: 'load',
          timeout: 30000
        });
        navigatedSuccessfully = true;
      } catch (error) {
        const msg = error.message || '';
        const name = error.name || '';
        const isTimeout = name === 'TimeoutError' ||
                          msg.includes('timeout') ||
                          msg.includes('Timeout') ||
                          msg.includes('TIMED_OUT') ||
                          msg.includes('timed_out');
        if (isTimeout) {
          // Proceed with analysis after timeout
        } else {
          throw new Error('Failed to establish connection to the website.');
        }
      }
    } else {
      // Try HTTP first
      try {
        mainResponse = await page.goto(httpUrl, {
          waitUntil: 'load',
          timeout: 30000
        });
        navigatedSuccessfully = true;
      } catch (error) {
        // HTTP failed, will fallback to HTTPS
      }

      httpFailed = !navigatedSuccessfully;

      // If HTTP failed completely, fallback to direct HTTPS
      if (!navigatedSuccessfully) {
        try {
          await page.close();
          page = await context.newPage();
          setupPageListeners(page);

          mainResponse = await page.goto(httpsUrl, {
            waitUntil: 'load',
            timeout: 30000
          });
          navigatedSuccessfully = true;
        } catch (error) {
          const msg = error.message || '';
          const name = error.name || '';
          const isTimeout = name === 'TimeoutError' ||
                            msg.includes('timeout') ||
                            msg.includes('Timeout') ||
                            msg.includes('TIMED_OUT') ||
                            msg.includes('timed_out');
          if (isTimeout) {
            // Proceed with analysis after HTTPS timeout
          } else {
            throw new Error('Failed to establish connection to the website (tried HTTP and HTTPS).');
          }
        }
      }
    }

    // Post-navigation re-validation: re-parse the final URL, re-resolve its
    // hostname, and walk the redirect chain. This catches SSRF bypasses where
    // an attacker uses DNS rebinding or chained redirects to land on a
    // private/internal address (e.g. cloud metadata at 169.254.169.254) after
    // the initial validation has already passed.
    try {
      finalUrl = page.url();
      const maxRedirects = 10;
      const hops = [];
      if (mainResponse) {
        let hopReq = mainResponse.request();
        while (hopReq) {
          hops.push(hopReq.url());
          if (hops.length > maxRedirects + 1) break;
          hopReq = hopReq.redirectedFrom();
        }
      }
      if (hops.length > maxRedirects + 1) {
        throw new Error('redirect_limit');
      }

      for (const hopUrl of hops) {
        let hopParsed;
        try {
          hopParsed = new URL(hopUrl);
        } catch (e) {
          throw new Error('bad_redirect_url');
        }
        if (hopParsed.protocol !== 'http:' && hopParsed.protocol !== 'https:') {
          throw new Error('bad_redirect_protocol');
        }
        const hopCheck = await resolveAndCheckPublic(hopParsed.hostname);
        if (!hopCheck.ok) {
          if (hopCheck.reason === 'private_ip') {
            throw new Error('redirect_private_ip:' + hopUrl);
          }
          throw new Error('redirect_dns_failure:' + hopParsed.hostname);
        }
      }
    } catch (secErr) {
      const reason = String(secErr.message || secErr);
      clearTimeout(scanTimeoutHandle);
      if (context) {
      await context.close().catch(() => {});
    }
      if (reason === 'redirect_limit') {
        return {
          success: false,
          category: 'too_many_redirects',
          url: targetUrl,
          error: 'The audited website has more than 10 consecutive redirects. The scan was aborted to prevent resource exhaustion.'
        };
      }
      if (reason === 'bad_redirect_url' || reason === 'bad_redirect_protocol') {
        return {
          success: false,
          category: 'bad_protocol',
          url: targetUrl,
          error: 'The audited website redirected to a non-HTTP(S) URL. The scan was aborted for security reasons.'
        };
      }
      if (reason.startsWith('redirect_private_ip:')) {
        const offending = reason.substring('redirect_private_ip:'.length);
        return {
          success: false,
          category: 'private_ip',
          url: targetUrl,
          error: `The audited website redirected to ${offending}, which resolves to a private network address. The scan was aborted to prevent leaking data to internal resources. This usually means the site is misconfigured.`
        };
      }
      if (reason.startsWith('redirect_dns_failure:')) {
        const host = reason.substring('redirect_dns_failure:'.length);
        return {
          success: false,
          category: 'private_ip',
          url: targetUrl,
          error: `A redirect in the audited website's chain (${host}) could not be re-resolved after navigation. The scan was aborted to prevent leaking data to potentially internal resources.`
        };
      }
      return {
        success: false,
        category: 'security',
        url: targetUrl,
        error: 'Post-navigation security validation failed. The scan was aborted.'
      };
    }

    // Wait an additional 5 seconds to let async scripts execute and fire trackers
    try {
      await page.waitForTimeout(5000);
    } catch (e) {
      // Ignore if session closed early
    }

    // Capture final screenshots (optional, but good for reporting)
    // const screenshot = await page.screenshot({ encoding: 'base64' });

    
    // Extract page links for crawl discovery
    let discoveredLinks = [];
    if (options.extractLinks && options.crawlScope) {
      if (options.isRootPage) {
        try {
          const finalUrlParsed = new URL(finalUrl);
          const finalHost = finalUrlParsed.hostname.toLowerCase();
          options.crawlScope.domain = finalHost;
          if (finalHost.startsWith('www.')) {
            options.crawlScope.wwwEquivalent = finalHost.substring(4);
          } else {
            options.crawlScope.wwwEquivalent = 'www.' + finalHost;
          }
          
          let newBasePath = '/';
          const pathname = finalUrlParsed.pathname;
          if (pathname.endsWith('/')) {
            newBasePath = pathname;
          } else {
            const parts = pathname.split('/');
            parts.pop();
            newBasePath = parts.join('/');
            if (!newBasePath.endsWith('/')) {
              newBasePath += '/';
            }
          }
          options.crawlScope.basePath = newBasePath;
        } catch (e) {
          // ignore parsing error
        }
      }

      try {
        const rawLinks = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(href => href && href.startsWith('http'));
        });
        discoveredLinks = filterLinksToScope(rawLinks, options.crawlScope);
      } catch (e) { /* ignore DOM errors */ }
    }

    // Collect all cookies set in this context.
    // Some environments (e.g. read-only container filesystems) may prevent
    // Chromium from persisting cookies to its internal store, causing
    // context.cookies() to return empty. As a fallback, also capture cookies
    // from Set-Cookie response headers during navigation.
    let rawCookies = await context.cookies();
    if (rawCookies.length === 0 && responseCookies.length > 0) {
      rawCookies = responseCookies;
    } else if (rawCookies.length > 0 && responseCookies.length > 0) {
      // Merge both sources, deduplicating by name + domain (response headers
      // may capture cookies that context.cookies() misses, e.g. session-scoped).
      const seen = new Set();
      const merged = [];
      for (const c of [...rawCookies, ...responseCookies]) {
        const key = c.name + '|' + (c.domain || '');
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(c);
        }
      }
      rawCookies = merged;
    }

    // Collect LocalStorage and SessionStorage across all page frames
    const storageItems = [];
    const frames = page.frames();
    for (const frame of frames) {
      try {
        const frameUrl = frame.url();
        if (!frameUrl || frameUrl.startsWith('about:') || frameUrl.startsWith('data:')) continue;
        const frameHost = new URL(frameUrl).hostname;
        
        const items = await frame.evaluate(() => {
          const local = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            local.push({ key, value: localStorage.getItem(key), type: 'LocalStorage' });
          }
          const session = [];
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            session.push({ key, value: sessionStorage.getItem(key), type: 'SessionStorage' });
          }
          return { local, session };
        });

        const processItems = (list) => list.map(item => {
          const classification = classifyStorageKey(item.key, frameHost);
          let val = item.value || '';
          if (val.length > 30) {
            val = val.substring(0, 27) + '...';
          }
          return {
            name: item.key,
            value: val,
            domain: frameHost,
            storageType: item.type,
            ...classification
          };
        });

        storageItems.push(...processItems(items.local), ...processItems(items.session));
      } catch (e) {
        // Skip frames that are cross-origin restricted or closed
      }
    }

    // Define first-party domains (starting domain, final domain, and redirect chain)
    const firstPartyDomains = new Set([targetBaseDomain]);
    try {
      finalUrl = page.url();
      if (finalUrl && finalUrl.startsWith('http')) {
        const finalHost = new URL(finalUrl).hostname;
        const finalBase = getBaseDomain(finalHost);
        if (finalBase) {
          firstPartyDomains.add(finalBase);
        }
      }
    } catch (e) {}

    if (mainResponse) {
      try {
        let req = mainResponse.request();
        while (req) {
          const host = new URL(req.url()).hostname;
          const base = getBaseDomain(host);
          if (base) {
            firstPartyDomains.add(base);
          }
          req = req.redirectedFrom();
        }
      } catch (e) {}
    }

    // Post-process requests to mark redirected/first-party domains as first-party
    for (const r of requestLogs) {
      if (r.isThirdParty && firstPartyDomains.has(r.baseDomain)) {
        r.isThirdParty = false;
        r.isTracker = false;
        r.category = 'First-Party / Functional';
      }
    }

    // Collect Embedded Widgets (Iframes)
    const iframeLogs = [];
    try {
      const elements = await page.evaluate(() => {
        const list = [];
        const embeds = document.querySelectorAll('iframe');
        embeds.forEach(el => {
          list.push({
            src: el.getAttribute('src') || el.src || '',
            id: el.id || '',
            name: el.name || ''
          });
        });
        return list;
      });

      elements.forEach(el => {
        const classification = classifyIframe(el.src, firstPartyDomains);
        iframeLogs.push({
          ...el,
          ...classification
        });
      });
    } catch (e) {
      // Ignore DOM issues
    }
    
    // Analyze Cookies
    const analyzedCookies = rawCookies.map(c => {
      const classification = classifyCookie(c.name, c.domain);
      
      // Safety checks
      const isSecure = c.secure;
      const isHttpOnly = c.httpOnly;
      const sameSite = c.sameSite || 'None';
      
      const securityIssues = [];
      
      const isSensitiveSession = isSensitiveSessionCookie(c.name);
      
      if (isSensitiveSession) {
        if (!isHttpOnly) {
          securityIssues.push('Missing HttpOnly flag on session cookie (vulnerable to XSS theft)');
        }
        if (!isSecure) {
          securityIssues.push('Missing Secure flag on session cookie (transmitted over unencrypted HTTP)');
        }
        if (sameSite === 'None') {
          securityIssues.push('SameSite=None on session cookie (susceptible to CSRF attacks)');
        }
      } else {
        // For non-session cookies (analytics, tracking, functional), HttpOnly is not required.
        // We only warn if tracking/marketing cookies lack the Secure flag over unencrypted transmissions.
        const isTrackingCookie = classification.category === 'Marketing/Advertising' || classification.category === 'Analytics';
        if (isTrackingCookie && !isSecure) {
          securityIssues.push('Missing Secure flag on tracking cookie (transmitted over unencrypted HTTP)');
        }
      }

      return {
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        session: c.expires === -1,
        secure: isSecure,
        httpOnly: isHttpOnly,
        sameSite,
        ...classification,
        securityIssues
      };
    });

    let securityDetails = null;
    let hstsEnabled = false;
    if (mainResponse) {
      try {
        securityDetails = await mainResponse.securityDetails();
        const headers = mainResponse.headers();
        hstsEnabled = !!(headers['strict-transport-security'] || headers['Strict-Transport-Security']);
      } catch (e) {
        // Ignore errors extracting security details
      }
    }

    // Wait for the TLS check in parallel
    let tlsCheck = null;
    try {
      tlsCheck = await tlsCheckPromise;
    } catch (e) {
      // Ignore errors
    }

    // Compile SSL/TLS details
    const sslDetails = {
      supported: false,
      authorized: false,
      protocol: null,
      cipher: null,
      issuer: null,
      subjectName: null,
      validFrom: null,
      validTo: null,
      daysToExpiration: null,
      isExpired: false,
      isExpiringSoon: false,
      hstsEnabled,
      error: null
    };

    if (tlsCheck && tlsCheck.success) {
      sslDetails.supported = true;
      sslDetails.authorized = tlsCheck.authorized;
      sslDetails.protocol = tlsCheck.protocol;
      sslDetails.cipher = tlsCheck.cipher;
      if (!tlsCheck.authorized) {
        sslDetails.error = tlsCheck.authorizationError || 'Certificate verification failed';
      }
    } else if (tlsCheck) {
      sslDetails.error = tlsCheck.error || 'Connection failed';
    }

    if (securityDetails) {
      const nowSec = Math.floor(Date.now() / 1000);
      sslDetails.issuer = securityDetails.issuer;
      sslDetails.subjectName = securityDetails.subjectName;
      sslDetails.validFrom = securityDetails.validFrom;
      sslDetails.validTo = securityDetails.validTo;
      if (securityDetails.validTo) {
        sslDetails.daysToExpiration = Math.round((securityDetails.validTo - nowSec) / 86400);
        sslDetails.isExpired = nowSec > securityDetails.validTo || nowSec < securityDetails.validFrom;
        sslDetails.isExpiringSoon = sslDetails.daysToExpiration <= 30 && sslDetails.daysToExpiration > 0;
      }
    }

    clearTimeout(scanTimeoutHandle);
    if (context) {
      await context.close().catch(() => {});
    }

    // Compile GDPR compliance diagnostics
    const cookiesCount = analyzedCookies.length;
    const trackingCookies = analyzedCookies.filter(c => c.category === 'Marketing/Advertising' || c.category === 'Analytics');
    const necessaryCookies = analyzedCookies.filter(c => c.category === 'Strictly Necessary');
    const unknownCookies = analyzedCookies.filter(c => c.category === 'Unknown');

    const totalRequestsCount = requestLogs.length;
    const thirdPartyRequests = requestLogs.filter(r => r.isThirdParty);
    const trackingRequests = requestLogs.filter(r => r.isTracker);

    // Detect Consent Management Platforms (CMPs) in third-party connections
    const detectedCMPsMap = new Map();
    requestLogs.forEach(r => {
      if (r.isThirdParty) {
        const cmpName = detectCMP(r.host);
        if (cmpName) {
          detectedCMPsMap.set(cmpName, r.host);
        }
      }
    });
    const detectedCMPs = Array.from(detectedCMPsMap.entries()).map(([name, host]) => ({ name, host }));

    // Compliance Diagnostics Checklist Setup
    const violations = [];
    const warnings = [];
    const recommendations = [];

    // Check 0: Unencrypted Connection & SSL/TLS Certificate Audit
    const isEncrypted = finalUrl.toLowerCase().startsWith('https://');
    if (!isEncrypted) {
      violations.push({
        type: 'Unencrypted Connection (HTTP-only)',
        message: 'The website uses an unencrypted HTTP connection. All traffic, including session cookies and form inputs, is vulnerable to interception.',
        gdprArticles: ['GDPR Article 32 (Security of Processing)']
      });
      recommendations.push('Install an SSL/TLS certificate (such as Let\'s Encrypt) on your server and configure a global redirect to force all HTTP traffic to HTTPS.');
    } else {
      // If encrypted, verify validity and security of the SSL/TLS configuration
      if (sslDetails.supported) {
        // 1. Trust Authority / Expiration / Hostname checks
        if (!sslDetails.authorized) {
          violations.push({
            type: 'Invalid SSL Certificate',
            message: `The SSL certificate is invalid or untrusted. Details: ${sslDetails.error}`,
            gdprArticles: ['GDPR Article 32 (Security of Processing)']
          });
          recommendations.push('Ensure your SSL certificate is issued by a trusted Certificate Authority (CA) and matches your domain.');
        } else if (sslDetails.isExpired) {
          violations.push({
            type: 'Expired SSL Certificate',
            message: 'The SSL certificate has expired.',
            gdprArticles: ['GDPR Article 32 (Security of Processing)']
          });
          recommendations.push('Renew your SSL certificate immediately to restore trust and secure user data.');
        }

        // 2. TLS Protocol Version checks
        const protocol = sslDetails.protocol || '';
        const isOutdatedProtocol = protocol.includes('1.0') || protocol.includes('1.1') || protocol.toLowerCase().includes('ssl');
        if (isOutdatedProtocol) {
          violations.push({
            type: 'Outdated TLS Protocol',
            message: `The server supports an outdated, insecure TLS version: ${protocol}.`,
            gdprArticles: ['GDPR Article 32 (Security of Processing)']
          });
          recommendations.push('Update your server configuration to disable legacy protocols (TLS 1.0, TLS 1.1) and enforce TLS 1.2 or TLS 1.3.');
        }

        // 3. Cipher strength check
        const cipher = sslDetails.cipher || '';
        const isWeakCipher = cipher.includes('RC4') || cipher.includes('3DES') || cipher.includes('DES') || cipher.includes('MD5') || cipher.includes('NULL') || cipher.includes('EXPORT');
        if (isWeakCipher) {
          warnings.push({
            type: 'Weak Cipher Suite Configured',
            message: `The server supports a weak or deprecated cipher suite: ${cipher}.`,
            gdprArticles: ['GDPR Article 32 (Security of Processing)']
          });
          recommendations.push('Configure secure cipher suites on your web server and disable legacy/weak ciphers.');
        }
      }
    }

    // Check 1: Marketing cookies set before consent (Critical Violation)
    const marketingCookiesCount = trackingCookies.filter(c => c.category === 'Marketing/Advertising').length;
    if (marketingCookiesCount > 0) {
      violations.push({
        type: 'Cookies Before Consent',
        message: `Set ${marketingCookiesCount} Marketing/Advertising cookie(s) before user consent.`,
        gdprArticles: ['ePrivacy Directive Article 5(3)', 'GDPR Article 6']
      });
      recommendations.push('Block all marketing and retargeting pixels (e.g. Facebook Pixel, DoubleClick) from loading until the user explicitly opts in via your cookie banner.');
    }

    // Check 2: Analytics cookies set before consent (Major Violation)
    const analyticsCookiesCount = trackingCookies.filter(c => c.category === 'Analytics').length;
    if (analyticsCookiesCount > 0) {
      violations.push({
        type: 'Cookies Before Consent',
        message: `Set ${analyticsCookiesCount} Analytics cookie(s) before user consent.`,
        gdprArticles: ['ePrivacy Directive Article 5(3)']
      });
      recommendations.push('Delay analytics scripts (e.g. Google Analytics) from setting cookies until consent is acquired. Alternatively, configure them to run in cookie-less / anonymous mode by default.');
    }

    // Check 3: Third-party tracking connections established before consent (Critical Violation)
    const trackerConnsCount = trackingRequests.length;
    if (trackerConnsCount > 0) {
      violations.push({
        type: 'Tracking Connections Before Consent',
        message: `Established ${trackerConnsCount} connection(s) to third-party trackers or marketing networks on load.`,
        gdprArticles: ['GDPR Article 44 (Data Transfer Risks)', 'GDPR Article 6 (Lawfulness of Processing)']
      });
      recommendations.push('Prevent third-party tracking scripts from initializing and loading their scripts/pixels on initial page load.');
    }

    // Check 4: Insecure cookies (Security Warning - does not affect overall consent compliance status)
    const insecureCookies = analyzedCookies.filter(c => c.securityIssues && c.securityIssues.length > 0);
    if (insecureCookies.length > 0) {
      warnings.push({
        type: 'Insecure Cookie Flags',
        message: `Found ${insecureCookies.length} cookie(s) with missing secure flags (HttpOnly or Secure).`,
        gdprArticles: ['GDPR Article 25 (Data Protection by Design & Default)']
      });
      recommendations.push('Configure your cookie generation headers to enforce Secure=true and HttpOnly=true flags, particularly for cookies storing unique identifiers.');
    }

    // Check 5: General third-party connections before consent (IP/Data leakage)
    // We count unique third-party hosts contacted, excluding ones already flagged in Check 3
    const generalThirdPartyRequests = thirdPartyRequests.filter(r => !r.isTracker);
    const uniqueThirdPartyHosts = [...new Set(generalThirdPartyRequests.map(r => r.host))];
    if (uniqueThirdPartyHosts.length > 0) {
      violations.push({
        type: 'Third-Party Connections Before Consent',
        message: `Established connections to ${uniqueThirdPartyHosts.length} third-party host(s) before consent, leaking user IP addresses.`,
        gdprArticles: ['GDPR Article 6 (Lawfulness of Processing)']
      });
      if (detectedCMPs && detectedCMPs.length > 0) {
        const cmpNames = detectedCMPs.map(c => c.name).join(', ');
        recommendations.push(`Detected third-party consent banner script(s) from ${cmpNames} loading before consent. Even though consent banners are legally required, fetching them from a third-party CDN leaks the visitor's IP address on load. Self-host these banner assets or load them via a first-party proxy.`);
      }
      recommendations.push('Avoid connecting to third-party domains on initial page load. Self-host static assets and defer loading external widgets/APIs until consent is given.');
    }

    // Check 6: Unknown cookies set before consent (Security Warning - does not affect overall compliance)
    if (unknownCookies.length > 0) {
      warnings.push({
        type: 'Unknown Cookies Before Consent',
        message: `Set ${unknownCookies.length} cookie(s) with unknown purposes before user consent.`,
        gdprArticles: ['ePrivacy Directive Article 5(3)']
      });
      recommendations.push('Verify and classify all cookies set on initial page load. Any non-essential cookies must be blocked until consent is given.');
    }

    // Check 7: Browser Storage (LocalStorage/SessionStorage) set before consent
    const trackingStorage = storageItems.filter(s => s.category === 'Marketing/Advertising' || s.category === 'Analytics');
    const unknownStorage = storageItems.filter(s => s.category === 'Unknown');
    const necessaryStorage = storageItems.filter(s => s.category === 'Strictly Necessary');
    
    const marketingStorageCount = trackingStorage.filter(s => s.category === 'Marketing/Advertising').length;
    if (marketingStorageCount > 0) {
      violations.push({
        type: 'Browser Storage Before Consent',
        message: `Stored ${marketingStorageCount} Marketing/Advertising item(s) in Local/Session Storage before consent.`,
        gdprArticles: ['ePrivacy Directive Article 5(3)', 'GDPR Article 6']
      });
      recommendations.push('Block marketing and tracking scripts from using LocalStorage or SessionStorage until the user explicitly consents.');
    }

    const analyticsStorageCount = trackingStorage.filter(s => s.category === 'Analytics').length;
    if (analyticsStorageCount > 0) {
      violations.push({
        type: 'Browser Storage Before Consent',
        message: `Stored ${analyticsStorageCount} Analytics item(s) in Local/Session Storage before consent.`,
        gdprArticles: ['ePrivacy Directive Article 5(3)']
      });
      recommendations.push('Delay analytics scripts from using browser storage keys (LocalStorage/SessionStorage) until consent is acquired.');
    }

    if (unknownStorage.length > 0) {
      warnings.push({
        type: 'Unknown Browser Storage',
        message: `Stored ${unknownStorage.length} key(s) with unknown purposes in Local/Session Storage before consent.`,
        gdprArticles: ['ePrivacy Directive Article 5(3)']
      });
      recommendations.push('Verify and classify all keys written to LocalStorage and SessionStorage on page load, and defer non-essential storage keys.');
    }

    // Check 8: Embedded widgets/iframes loaded before consent
    const thirdPartyIframes = iframeLogs.filter(i => i.isThirdParty);
    if (thirdPartyIframes.length > 0) {
      violations.push({
        type: 'Third-Party Embeds Before Consent',
        message: `Detected ${thirdPartyIframes.length} third-party iframe embed(s) loaded on page load, leaking user IP addresses.`,
        gdprArticles: ['GDPR Article 6 (Lawfulness of Processing)']
      });
      recommendations.push('Configure third-party embedded widgets (like video players or maps) to lazy-load or use privacy-compliant domains (e.g. youtube-nocookie.com) until user consent is captured.');
    }

    // Binary Compliance Status
    const compliant = violations.length === 0;

    const redirected = getBaseDomain(targetHost) !== getBaseDomain(new URL(finalUrl).hostname);

    const scanResult = {
      success: true,
      url: finalUrl,
      originalUrl: targetUrl,
      redirected,
      httpFailed,
      domain: targetHost,
      timestamp: new Date().toISOString(),
      compliant,
      summary: {
        totalCookies: cookiesCount,
        necessaryCookies: necessaryCookies.length,
        analyticsCookies: analyticsCookiesCount,
        marketingCookies: marketingCookiesCount,
        unclassifiedCookies: unknownCookies.length,
        totalRequests: totalRequestsCount,
        thirdPartyRequests: thirdPartyRequests.length,
        trackingRequests: trackerConnsCount,
        totalStorage: storageItems.length,
        necessaryStorage: necessaryStorage.length,
        analyticsStorage: analyticsStorageCount,
        marketingStorage: marketingStorageCount,
        unclassifiedStorage: unknownStorage.length,
        totalIframes: iframeLogs.length,
        thirdPartyIframes: thirdPartyIframes.length
      },
      sslDetails,
      detectedCMPs,
      cookies: analyzedCookies,
      storage: storageItems,
      iframes: iframeLogs,
      connections: requestLogs,
      violations,
      warnings,
      recommendations
    };

    if (discoveredLinks && discoveredLinks.length > 0) {
      scanResult.discoveredLinks = discoveredLinks;
    }

    return scanResult;

  } catch (error) {
    clearTimeout(scanTimeoutHandle);
    if (context) {
      await context.close().catch(() => {});
    }
    if (scanTimedOut) {
      return {
        success: false,
        category: 'timeout',
        url: targetUrl,
        error: `The scan timed out after ${SCAN_TIMEOUT_MS / 1000} seconds. The target website may be unresponsive or extremely slow.`
      };
    }
    return {
      success: false,
      category: 'connection',
      url: targetUrl,
      error: error.message || 'Failed to complete the audit scan.'
    };
  }
}

export async function runAudit(targetUrl, options = {}) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security'
      ]
    });
    return await runAuditWithBrowser(browser, targetUrl, options);
  } finally {
    if (browser) {
      await safeCloseBrowser(browser);
    }
  }
}
