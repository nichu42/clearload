import { chromium } from 'playwright';
import tls from 'tls';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
    const socket = tls.connect({
      host: host,
      port: 443,
      servername: host, // SNI
      rejectUnauthorized: false // so we can connect even if it's invalid and inspect details
    }, () => {
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
  if (cleanSrc.startsWith('about:') || cleanSrc.startsWith('data:') || cleanSrc.startsWith('javascript:') || cleanSrc.startsWith('blob:')) {
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
        if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
          type = 'YouTube Video';
        } else if (host.includes('google.com') && urlObj.pathname.includes('/maps')) {
          type = 'Google Maps';
        } else if (host.includes('vimeo.com')) {
          type = 'Vimeo Video';
        } else if (host.includes('spotify.com')) {
          type = 'Spotify Player';
        } else if (host.includes('facebook.com') && host.includes('plugins')) {
          type = 'Facebook Integration';
        } else if (host.includes('twitter.com') || host.includes('platform.twitter.com')) {
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

export async function runAudit(targetUrl, options = {}) {
  // Extract hostname/clean domain
  let cleanDomain = targetUrl.trim();
  // Strip protocol if present
  cleanDomain = cleanDomain.replace(/^https?:\/\//i, '');
  // Strip trailing path/slash
  cleanDomain = cleanDomain.split('/')[0];

  const httpUrl = 'http://' + cleanDomain;
  const httpsUrl = 'https://' + cleanDomain;

  let browser;
  let finalUrl = targetUrl;
  try {
    const targetHost = cleanDomain;
    const targetBaseDomain = getBaseDomain(targetHost);

    // Run the TLS socket check in parallel with browser launch
    const tlsCheckPromise = checkTlsSocket(targetHost);

    // Launch Playwright Headless Chromium
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--disable-web-security'
      ]
    });

    const contextOptions = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true
    };

    if (options.authUsername && options.authPassword) {
      contextOptions.httpCredentials = {
        username: options.authUsername,
        password: options.authPassword,
        origin: httpsUrl
      };
    }

    if (options.customHeaderName && options.customHeaderValue) {
      contextOptions.extraHTTPHeaders = {
        [options.customHeaderName]: options.customHeaderValue
      };
    }

    const context = await browser.newContext(contextOptions);

    let page = await context.newPage();

    const requestLogs = [];
    
    const setupPageListeners = (p) => {
      p.on('request', req => {
        const url = req.url();
        const method = req.method();
        const resourceType = req.resourceType();
        
        // Skip data URLs and main document request
        if (url.startsWith('data:') || url.startsWith('http://' + cleanDomain) || url.startsWith('https://' + cleanDomain)) return;

        const classification = classifyRequest(url, targetBaseDomain);

        requestLogs.push({
          url,
          method,
          resourceType,
          ...classification
        });
      });
    };

    setupPageListeners(page);

    // Try HTTP first
    let navigatedSuccessfully = false;
    let mainResponse = null;

    try {
      mainResponse = await page.goto(httpUrl, {
        waitUntil: 'load',
        timeout: 30000
      });
      navigatedSuccessfully = true;
    } catch (error) {
      // HTTP failed, will fallback to HTTPS
    }

    const httpFailed = !navigatedSuccessfully;

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

    // Wait an additional 5 seconds to let async scripts execute and fire trackers
    try {
      await page.waitForTimeout(5000);
    } catch (e) {
      // Ignore if session closed early
    }

    // Capture final screenshots (optional, but good for reporting)
    // const screenshot = await page.screenshot({ encoding: 'base64' });

    // Collect all cookies set in this context
    const rawCookies = await context.cookies();

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

    await browser.close();

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

    return {
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

  } catch (error) {
    if (browser) await browser.close();
    return {
      success: false,
      url: targetUrl,
      error: error.message || 'Failed to complete the audit scan.'
    };
  }
}
