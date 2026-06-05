import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { runAudit } from './audit.js';
import open from 'open';
import dns from 'dns';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constant-time string comparison to prevent timing attacks
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

// Detect whether a request genuinely originated from this machine.
// This is the ONLY safe way to implement the "localhost exemption" because it
// relies on the real TCP socket address (which an attacker cannot forge from
// the outside) rather than on req.ip (which honours the X-Forwarded-For
// header once trust proxy is enabled). It also requires no X-Forwarded-For /
// X-Real-IP header to be present, so a request that comes in through a local
// reverse proxy is correctly *not* treated as local.
function isLocalRequest(req) {
  const socketIp = (req.socket && req.socket.remoteAddress)
    || (req.connection && req.connection.remoteAddress)
    || '';
  const isLoopback = socketIp === '127.0.0.1'
    || socketIp === '::1'
    || socketIp === '::ffff:127.0.0.1';
  if (!isLoopback) return false;
  const hasForwardedHeader = !!(req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  return !hasForwardedHeader;
}

// Read version from package.json dynamically
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const APP_VERSION = packageJson.version;

const app = express();
const PORT = process.env.PORT || 3000;

// Configure Express 'trust proxy' setting.
// This MUST be set before any middleware that relies on req.ip (express-rate-limit,
// the apiSecurityGuard, etc.). When ClearLoad runs behind a reverse proxy
// (e.g. nginx, Traefik, Caddy) inside a container, the proxy injects an
// X-Forwarded-For header on every request. express-rate-limit v7+ throws
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR when that header is present but trust
// proxy is still the default (false), which falsely appears as if the client
// is spoofing its source address.
//
// Default: 1 (trust one reverse-proxy hop). This works for the vast majority of
// deployments — a single nginx, Traefik, Caddy, Bunny.net, Cloudflare, Fly.io,
// Railway, etc. in front of the app. For chained proxies (e.g. CDN + nginx)
// set TRUSTED_PROXY=2 or a specific subnet. To disable trust entirely (e.g. when
// exposing the port directly to the internet with no proxy in front), set
// TRUSTED_PROXY=false.
//
// SECURITY NOTE: when trust proxy is enabled, the apiSecurityGuard and rate
// limiter must NOT use req.ip for the "localhost" check, because an attacker
// who can reach the app could forge `X-Forwarded-For: 127.0.0.1` to fake
// localhost. See isLocalRequest() below — it uses the real socket address
// instead, which a header cannot forge.
//
// TRUSTED_PROXY accepts the same value formats as Express itself:
//   - false / 0 / no / off  -> trust no proxies
//   - true  / 1  / yes / on -> trust ALL proxies (insecure, only for local testing)
//   - <integer>             -> trust that many reverse-proxy hops (default: 1)
//   - loopback / linklocal / uniquelocal  -> built-in Express presets
//   - <ip-or-cidr>          -> a single proxy address, e.g. 10.0.0.0/8
//   - <a,b,c>               -> comma-separated list of IPs, CIDRs, or presets
function parseTrustProxy(value) {
  if (value === undefined || value === null) return 1;
  const v = String(value).trim();
  if (v === '') return 1;

  if (/^(false|0|no|off)$/i.test(v)) return false;
  // Note: "1" is intentionally NOT in the boolean-true alternation. "1" should
  // mean "trust one hop" (an integer), not "trust all proxies" (boolean true).
  // Express treats any truthy value as "trust all", so we must return the
  // boolean true ONLY for unambiguous truthy strings, and let the numeric regex
  // below handle "1" as the integer 1.
  if (/^(true|yes|on)$/i.test(v)) return true;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  if (/^(loopback|linklocal|uniquelocal)$/i.test(v)) return v.toLowerCase();
  if (v.includes(',')) {
    return v.split(',').map(s => s.trim()).filter(Boolean);
  }
  return v;
}

const trustProxySetting = parseTrustProxy(process.env.TRUSTED_PROXY);
app.set('trust proxy', trustProxySetting);
if (trustProxySetting === true) {
  console.warn(`[Security] WARNING: TRUSTED_PROXY is set to "${process.env.TRUSTED_PROXY}". This trusts the X-Forwarded-For header from any source, allowing clients to spoof their IP address and bypass rate limiting. Use a specific IP/CIDR (e.g. TRUSTED_PROXY=10.0.0.0/8) or a hop count (e.g. TRUSTED_PROXY=1) instead.`);
} else if (trustProxySetting === false) {
  console.log(`[Security] Express 'trust proxy' is disabled (TRUSTED_PROXY=${process.env.TRUSTED_PROXY}).`);
} else {
  console.log(`[Security] Express 'trust proxy' set to ${JSON.stringify(trustProxySetting)} (TRUSTED_PROXY env var).`);
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Enable JSON middleware for POST bodies
app.use(express.json({ limit: '1kb' }));



// Cache-control helpers. Per the project policy:
//   - Self-hosted vendor assets (text fonts via @fontsource + icon fonts via
//     @fortawesome, plus their accompanying CSS/JS/SVG) are aggressively
//     cached. These only change when the npm packages are upgraded, which
//     produces a new Docker image; the file names don't change, so
//     'immutable' is safe for the lifetime of an image.
//   - Everything else — the SPA bundle (index.html / app.js / style.css),
//     every /api/* response, and the SPA fallback — is marked no-store, so
//     browsers and CDNs always revalidate and never serve a stale app
//     version, footer, or rate-limit response.
function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}
function longCache(req, res, next) {
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  next();
}

// Self-hosted vendor assets: cache aggressively. Path-specific middlewares are
// listed first so the long-cache header wins over the generic no-store applied
// below. This covers:
//   - /vendor/fonts/outfit/*         (Outfit text font, @fontsource)
//   - /vendor/fonts/plus-jakarta-sans/* (Plus Jakarta Sans text font, @fontsource)
//   - /vendor/fontawesome/*          (FontAwesome icon fonts + their CSS/JS/SVG)
app.use('/vendor/fonts/outfit', longCache, express.static(path.join(__dirname, 'node_modules', '@fontsource', 'outfit')));
app.use('/vendor/fonts/plus-jakarta-sans', longCache, express.static(path.join(__dirname, 'node_modules', '@fontsource', 'plus-jakarta-sans')));
app.use('/vendor/fontawesome', longCache, express.static(path.join(__dirname, 'node_modules', '@fortawesome', 'fontawesome-free')));

// All other static / api / fallback responses: no-store.
// The middleware below fires for every request path, sets no-store, then
// either serves a file (public/) or falls through to the /api/* routes.
// The header stays on the res object for the rest of the chain, so
// /api/status, /api/dictionaries, /api/scan, and the SPA fallback all
// inherit it without each handler having to set it.
app.use(noStore, express.static(path.join(__dirname, 'public')));

// 1. Validate configured API keys on startup if set
const expectedApiKeys = [];
if (process.env.API_KEY) {
  const keys = process.env.API_KEY.split(/[;,]/).map(k => k.trim()).filter(Boolean);
  const keyFormatRegex = /^[a-zA-Z0-9_-]+$/;
  for (const key of keys) {
    if (key.length < 32 || key.length > 128) {
      console.error(`========================================================================`);
      console.error(`CRITICAL CONFIGURATION ERROR: Invalid API Key detected!`);
      console.error(`The API Key "${key.substring(0, 8)}..." does not meet the length requirements.`);
      console.error(`API keys must be between 32 and 128 characters (current: ${key.length} chars).`);
      console.error(`Server startup aborted.`);
      console.error(`========================================================================`);
      process.exit(1);
    }
    if (!keyFormatRegex.test(key)) {
      console.error(`========================================================================`);
      console.error(`CRITICAL CONFIGURATION ERROR: Invalid API Key detected!`);
      console.error(`The API Key "${key.substring(0, 8)}..." contains invalid characters.`);
      console.error(`API keys must contain only alphanumeric characters, underscores, and hyphens.`);
      console.error(`Allowed regex: /^[a-zA-Z0-9_-]+$/`);
      console.error(`Server startup aborted.`);
      console.error(`========================================================================`);
      process.exit(1);
    }
    expectedApiKeys.push(key);
  }
  console.log(`[Security] API Key authentication enabled with ${expectedApiKeys.length} configured keys.`);
} else {
  console.warn(`[Security] WARNING: No API_KEY environment variable configured. Programmatic API access is restricted by default.`);
}

// 2. Trusted Host Configuration for Same-Origin Checks
const trustedHost = process.env.TRUSTED_HOST;
if (trustedHost) {
  console.log(`[Security] Trusted host configured: ${trustedHost}`);
} else {
  console.warn(`[Security] WARNING: No TRUSTED_HOST environment variable configured. Using Host header from requests (less secure for production deployments).`);
  console.warn(`[Security] For production deployments, set TRUSTED_HOST=yourdomain.com to prevent Host header spoofing.`);
}

// 3. Security Guard Middleware for API endpoints
const apiSecurityGuard = (req, res, next) => {
  const host = trustedHost || req.headers.host;
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const apiKey = req.headers['x-api-key'];

  // Check if request is from localhost (same machine)
  // isLocalRequest uses the socket address, NOT req.ip, so the bypass cannot
  // be triggered by a forged X-Forwarded-For header from a remote attacker.
  const isLocalhost = isLocalRequest(req);

  // Check if Same-Origin (official frontend on the same domain)
  let isSameOrigin = false;
  try {
    if (origin) {
      isSameOrigin = new URL(origin).host === host;
    } else if (referer) {
      isSameOrigin = new URL(referer).host === host;
    }
  } catch (e) {
    // Ignore URL parsing errors
  }

  // Check if valid API Key is provided
  let hasValidApiKey = false;
  if (apiKey) {
    // Basic length/format validation on incoming key before lookup
    const keyFormatRegex = /^[a-zA-Z0-9_-]+$/;
    if (apiKey.length >= 32 && apiKey.length <= 128 && keyFormatRegex.test(apiKey)) {
      hasValidApiKey = expectedApiKeys.some(expected => safeCompare(apiKey, expected));
    }
    
    // If an API key was provided but is invalid, reject the request immediately
    if (!hasValidApiKey) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. The provided API key is invalid.'
      });
    }
  }

  if (isLocalhost || isSameOrigin || hasValidApiKey) {
    return next();
  }

  return res.status(403).json({
    success: false,
    error: 'Access denied. This server\'s scan API is restricted to authorized requests.'
  });
};

// Apply security guard to all API routes (except public endpoints)
app.use('/api', (req, res, next) => {
  if (req.path === '/status' || req.path === '/dictionaries') {
    return next();
  }
  apiSecurityGuard(req, res, next);
});

// 3. Rate Limiter Middleware for scan route
const limitWindowSec = parseInt(process.env.RATE_LIMIT_WINDOW_SEC, 10) || 900;
const limitMax = parseInt(process.env.RATE_LIMIT_MAX, 10);
const isRateLimitEnabled = limitMax !== 0;
const rateLimitMax = isNaN(limitMax) ? 3 : limitMax;

const scanLimiter = isRateLimitEnabled
  ? rateLimit({
      windowMs: limitWindowSec * 1000,
      max: rateLimitMax,
      message: {
        success: false,
        error: 'Too many audits have been requested from your IP address. Please wait a few minutes before trying again.'
      },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => {
        // Skip rate-limiting for localhost and valid API keys
        // isLocalRequest uses the socket address, NOT req.ip, so the bypass
        // cannot be triggered by a forged X-Forwarded-For header.
        const isLocalhost = isLocalRequest(req);

        const apiKey = req.headers['x-api-key'];
        let hasValidApiKey = false;
        if (apiKey) {
          const keyFormatRegex = /^[a-zA-Z0-9_-]+$/;
          if (apiKey.length >= 32 && apiKey.length <= 128 && keyFormatRegex.test(apiKey)) {
            hasValidApiKey = expectedApiKeys.some(expected => safeCompare(apiKey, expected));
          }
        }
        return isLocalhost || hasValidApiKey;
      }
    })
  : (req, res, next) => next();

// 4. Concurrency Guard setup
let activeScansCount = 0;
const maxConcurrentScans = parseInt(process.env.MAX_CONCURRENT_SCANS, 10) || 2;

// 5. SSRF Protection: Check if an IP address is private/internal
function isPrivateIP(ip) {
  if (!ip) return false;
  
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  
  // Loopback: 127.0.0.0/8
  if (parts[0] === 127) return true;
  
  // Private networks (RFC 1918)
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  
  // Link-local: 169.254.0.0/16 (includes cloud metadata 169.254.169.254)
  if (parts[0] === 169 && parts[1] === 254) return true;
  
  // Current network: 0.0.0.0/8
  if (parts[0] === 0) return true;
  
  return false;
}

// API Status endpoint
app.get('/api/status', (req, res) => {
  // No-store: the status endpoint reflects runtime configuration (env vars,
  // package version) and must always return the current values. CDNs otherwise
  // happily cache a tiny JSON response for days/weeks, leaving the UI showing
  // a stale version number and a stale FOOTER_TEXT after a deploy.
  res.set('Cache-Control', 'no-store').json({
    status: 'ok',
    environment: 'dynamic',
    version: APP_VERSION,
    footerText: process.env.FOOTER_TEXT !== undefined ? process.env.FOOTER_TEXT : 'presented by (42bit.io)[42bit.io]',
    legalLink: process.env.LEGAL_LINK || null
  });
});

// API Dictionaries endpoint
app.get('/api/dictionaries', (req, res) => {
  const dictionaries = [
    { name: 'cmp_mapping', file: 'cmp_mapping.json' },
    { name: 'tracking_patterns', file: 'tracking_patterns.json' },
    { name: 'public_cdns', file: 'public_cdns.json' },
    { name: 'cookie_definitions', file: 'cookie_definitions.json' },
    { name: 'widget_mappings', file: 'widget_mappings.json' },
    { name: 'classification_rules', file: 'classification_rules.json' }
  ];
  
  const result = { success: true };
  const failedDicts = [];
  
  for (const dict of dictionaries) {
    try {
      const filePath = path.join(__dirname, 'dictionaries', dict.file);
      const content = fs.readFileSync(filePath, 'utf8');
      result[dict.name] = JSON.parse(content);
    } catch (error) {
      console.error(`[Error] Failed to load dictionary '${dict.name}': ${error.message}`);
      failedDicts.push(dict.name);
    }
  }
  
  if (failedDicts.length > 0) {
    return res.status(500).json({
      success: false,
      error: `Failed to load dictionaries: ${failedDicts.join(', ')}`
    });
  }
  
  res.json(result);
});

// Scan endpoint
app.post('/api/scan', scanLimiter, async (req, res) => {
  const { url, authUsername, authPassword, customHeaderName, customHeaderValue } = req.body;

  if (!url || typeof url !== 'string' || url.trim() === '') {
    return res.status(400).json({
      success: false,
      error: 'Please provide a valid website domain name (e.g., example.com).'
    });
  }

  // Clean the input (extract domain name only)
  let targetDomain = url.trim();
  // Strip protocol
  targetDomain = targetDomain.replace(/^https?:\/\//i, '');
  // Strip path and query parameters
  targetDomain = targetDomain.split('/')[0];
  
  // Validate domain format
  const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!domainRegex.test(targetDomain)) {
    return res.status(400).json({
      success: false,
      error: 'Please provide a valid website domain name (e.g., example.com).'
    });
  }

  // SSRF Protection: Resolve domain and reject private/internal IPs
  try {
    const { address } = await dns.promises.lookup(targetDomain);
    if (isPrivateIP(address)) {
      return res.status(400).json({
        success: false,
        error: 'Scanning internal or private network addresses is not permitted.'
      });
    }
  } catch (dnsError) {
    return res.status(400).json({
      success: false,
      error: 'Could not resolve the domain name. Please check that the website exists and is publicly reachable.'
    });
  }

  // Validate custom header (intended for WAF bypass tokens only)
  if (customHeaderName || customHeaderValue) {
    const headerNameRegex = /^[a-zA-Z0-9-]+$/;
    const blockedHeaders = /^(authorization|cookie|host|proxy-|x-forwarded-|x-real-ip|x-api-key)/i;
    
    if (!customHeaderName || !headerNameRegex.test(customHeaderName)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid custom header name. Only alphanumeric characters and hyphens are allowed.'
      });
    }
    
    if (blockedHeaders.test(customHeaderName)) {
      return res.status(400).json({
        success: false,
        error: 'Sensitive headers like Authorization, Cookie, Host, and Proxy headers are not allowed.'
      });
    }
    
    if (customHeaderValue && /[\r\n]/.test(customHeaderValue)) {
      return res.status(400).json({
        success: false,
        error: 'Header values cannot contain newline characters.'
      });
    }
  }

  // Concurrency check
  if (activeScansCount >= maxConcurrentScans) {
    return res.status(503).json({
      success: false,
      error: 'The server is currently busy processing audits for other websites. Please wait a few seconds and try again.'
    });
  }

  try {
    activeScansCount++;
    const report = await runAudit(targetDomain, { authUsername, authPassword, customHeaderName, customHeaderValue });
    if (report.success) {
      res.json(report);
    } else {
      res.status(500).json(report);
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'The audit scan failed. Please check that the website is online and publicly reachable.'
    });
  } finally {
    activeScansCount--;
  }
});

// Fallback to index.html for Single Page App routing
app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Startup log: show every environment variable the server has read and the value
// (or effective value, after defaults) that will be used at runtime. Useful for
// verifying deployment configuration without redeploying to test each variable.
// Sensitive values (API keys) are masked.
function summariseConfig() {
  const apiKeyCount = expectedApiKeys.length;
  const footerRaw = process.env.FOOTER_TEXT;
  const footerDisplay = footerRaw !== undefined
    ? (footerRaw.length > 80 ? `"${footerRaw.slice(0, 80)}…"` : `"${footerRaw}"`)
    : '(default: "presented by (42bit.io)[42bit.io]")';
  return [
    ['PORT',                process.env.PORT || '3000 (default)'],
    ['NODE_ENV',            process.env.NODE_ENV || '(not set)'],
    ['TRUSTED_HOST',        process.env.TRUSTED_HOST || '(not set)'],
    ['TRUSTED_PROXY',       process.env.TRUSTED_PROXY !== undefined ? process.env.TRUSTED_PROXY : '1 (default)'],
    ['API_KEY',             apiKeyCount > 0 ? `**** (${apiKeyCount} key${apiKeyCount === 1 ? '' : 's'} loaded)` : '(not set — same-origin/localhost only)'],
    ['RATE_LIMIT_WINDOW_SEC', String(limitWindowSec)],
    ['RATE_LIMIT_MAX',      isRateLimitEnabled ? String(rateLimitMax) : '0 (rate limiting disabled)'],
    ['MAX_CONCURRENT_SCANS', String(maxConcurrentScans)],
    ['FOOTER_TEXT',         footerDisplay],
    ['LEGAL_LINK',          process.env.LEGAL_LINK || '(not set — link hidden)'],
    ['OPEN_BROWSER',        process.env.OPEN_BROWSER || '(not set)'],
  ];
}

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`ClearLoad server running on ${url}`);

  console.log('[Config] Environment variables processed at startup:');
  for (const [name, value] of summariseConfig()) {
    console.log(`         ${name.padEnd(22)} = ${value}`);
  }

  if (process.env.OPEN_BROWSER === 'true') {
    open(url).catch(() => {
      // Fail silently if browser cannot be opened automatically
    });
  }
});
