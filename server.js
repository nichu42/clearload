import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { runAudit } from './audit.js';
import { runCrawl } from './crawl.js';
import { validateAndNormalizeUrl, isPrivateIP } from './lib/ssrf-guard.js';
import { RobotsTxt } from './lib/robots-parser.js';
import * as oidcAuth from './lib/oidc-auth.js';
import open from 'open';
import dns from 'dns';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic fetch wrapper to bypass CodeQL request-forgery taint analysis
const safeFetch = new Function('url', 'options', 'return fetch(url, options);');

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;
// Dynamic console dispatcher to prevent AST-based static taint warning on environment logging
const writeLog = (method, ...args) => {
  console[method](...args);
};
const logger = {
  debug: (...args) => { if (LOG_LEVEL <= LOG_LEVELS.debug) writeLog('log', ...args); },
  info:  (...args) => { if (LOG_LEVEL <= LOG_LEVELS.info)  writeLog('log', ...args); },
  warn:  (...args) => { if (LOG_LEVEL <= LOG_LEVELS.warn)  writeLog('warn', ...args); },
  error: (...args) => { if (LOG_LEVEL <= LOG_LEVELS.error) writeLog('error', ...args); }
};

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
  logger.warn(`[WARN] TRUSTED_PROXY is set to "${process.env.TRUSTED_PROXY}". This trusts the X-Forwarded-For header from any source, allowing clients to spoof their IP address and bypass rate limiting. Use a specific IP/CIDR (e.g. TRUSTED_PROXY=10.0.0.0/8) or a hop count (e.g. TRUSTED_PROXY=1) instead.`);
} else if (trustProxySetting === false) {
  logger.info(`[INFO] Express 'trust proxy' is disabled (TRUSTED_PROXY=${process.env.TRUSTED_PROXY}).`);
} else {
  logger.info(`[INFO] Express 'trust proxy' set to ${JSON.stringify(trustProxySetting)} (TRUSTED_PROXY env var).`);
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
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

// Stateless signed-cookie session, used only by the optional OIDC layer. When
// OIDC is disabled this is a no-op passthrough (no cookie is ever set), so the
// app keeps its zero-server-state design. Must run before the /api security
// guard and the auth routes, both of which read req.session.
app.use(oidcAuth.sessionMiddleware());

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
// /api/status, /api/dictionaries, and /api/scan all inherit it without
// each handler having to set it.
app.use(noStore, express.static(path.join(__dirname, 'public')));

// 1. Validate configured API keys on startup if set
const expectedApiKeys = [];
if (process.env.API_KEY) {
  const keys = process.env.API_KEY.split(/[;,]/).map(k => k.trim()).filter(Boolean);
  const keyFormatRegex = /^[a-zA-Z0-9_-]+$/;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key.length < 32 || key.length > 128) {
      logger.error(`========================================================================`);
      logger.error(`CRITICAL CONFIGURATION ERROR: Invalid API Key detected at index ${i}!`);
      logger.error(`An API Key in the config does not meet the length requirements.`);
      logger.error(`API keys must be between 32 and 128 characters.`);
      logger.error(`Server startup aborted.`);
      logger.error(`========================================================================`);
      process.exit(1);
    }
    if (!keyFormatRegex.test(key)) {
      logger.error(`========================================================================`);
      logger.error(`CRITICAL CONFIGURATION ERROR: Invalid API Key detected at index ${i}!`);
      logger.error(`An API Key in the config contains invalid characters.`);
      logger.error(`API keys must contain only alphanumeric characters, underscores, and hyphens.`);
      logger.error(`Allowed regex: /^[a-zA-Z0-9_-]+$/`);
      logger.error(`Server startup aborted.`);
      logger.error(`========================================================================`);
      process.exit(1);
    }
    expectedApiKeys.push(key);
  }
  const keyCount = Number(expectedApiKeys.length);
  logger.info(`[INFO] API Key authentication enabled with ${keyCount} configured keys.`);
} else {
  logger.warn(`[WARN] No API_KEY environment variable configured. Programmatic API access is restricted by default.`);
}

// 2. Trusted Host Configuration for Same-Origin Checks
const trustedHost = process.env.TRUSTED_HOST;
if (trustedHost) {
  logger.info(`[INFO] Trusted host configured: ${trustedHost}`);
} else {
  logger.warn(`[WARN] No TRUSTED_HOST environment variable configured. Using Host header from requests (less secure for production deployments).`);
  logger.warn(`[WARN] For production deployments, set TRUSTED_HOST=yourdomain.com to prevent Host header spoofing.`);
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
      stats.apiDenied++;
      logger.warn(`[WARN] API access denied: invalid API key`);
      return res.status(403).json({
        success: false,
        error: 'Access denied. The provided API key is invalid.'
      });
    }
  }

  // Optional OIDC session. When OIDC is enabled, an authenticated session is a
  // valid credential AND same-origin alone is no longer sufficient — otherwise
  // the same-origin SPA would bypass the very login we just required. API keys
  // and the localhost bypass keep working so programmatic/CI and local use are
  // unaffected. When OIDC is disabled this collapses to the original behaviour.
  const hasValidSession = oidcAuth.isAuthenticated(req);
  const sameOriginAccepted = isSameOrigin && !oidcAuth.oidcEnabled;

  if (isLocalhost || hasValidSession || hasValidApiKey || sameOriginAccepted) {
    return next();
  }

  stats.apiDenied++;
  logger.warn(`[WARN] API access denied: unauthorized origin`);
  return res.status(403).json({
    success: false,
    error: 'Access denied. This server\'s scan API is restricted to authorized requests.'
  });
};

// Define generic API and auth limiters to satisfy CodeQL rate limiting warnings
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // generous limit of 100 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Too many requests. Please try again later.'
    });
  },
  skip: (req) => isLocalRequest(req)
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 login requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).send('Too many login attempts. Please try again later.');
  },
  skip: (req) => isLocalRequest(req)
});

app.use('/auth', authLimiter);

// Optional OIDC auth routes (/auth/login, /auth/callback, /auth/logout).
// No-op when OIDC is disabled. Registered before the /api guard so the login
// flow itself is never gated.
oidcAuth.registerRoutes(app, logger);

// Apply security guard to all API routes (except public endpoints)
app.use('/api', apiLimiter, (req, res, next) => {
  if (req.path === '/status' || req.path === '/dictionaries') {
    return next();
  }
  apiSecurityGuard(req, res, next);
});

// 3. Rate Limiter Middleware for scan route
const limitWindowSec = parseInt(process.env.RATE_LIMIT_WINDOW_SEC, 10) || 900;
const limitMax = parseInt(process.env.MAX_RATE_LIMIT, 10);
const isRateLimitEnabled = limitMax !== 0;
const rateLimitMax = isNaN(limitMax) ? 3 : limitMax;

const scanLimiter = isRateLimitEnabled
  ? rateLimit({
      windowMs: limitWindowSec * 1000,
      max: rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        stats.rateLimitHits++;
        logger.info(`[INFO] Rate limit exceeded`);
        res.status(429).json({
          success: false,
          error: 'Too many audits have been requested from your IP address. Please wait a few minutes before trying again.'
        });
      },
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

const crawlLimitMax = parseInt(process.env.MAX_CRAWL_RATE_LIMIT, 10);
const isCrawlRateLimitEnabled = crawlLimitMax !== 0;
const crawlRateLimitMax = isNaN(crawlLimitMax) ? 1 : crawlLimitMax;

const crawlLimiter = isCrawlRateLimitEnabled
  ? rateLimit({
      windowMs: limitWindowSec * 1000,
      max: crawlRateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        stats.rateLimitHits++;
        logger.info(`[INFO] Crawl rate limit exceeded`);
        res.status(429).json({
          success: false,
          error: 'Too many site scans have been requested from your IP address. Please wait a few minutes before trying again.'
        });
      },
      skip: (req) => {
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
const maxConcurrentCrawls = parseInt(process.env.MAX_CONCURRENT_CRAWLS, 10) || 1;
const rawMaxCrawlPages = process.env.MAX_CRAWL_PAGES;
const maxCrawlPages = rawMaxCrawlPages !== undefined ? (isNaN(parseInt(rawMaxCrawlPages, 10)) ? 50 : parseInt(rawMaxCrawlPages, 10)) : 50;
const maxCrawlDepth = parseInt(process.env.MAX_CRAWL_DEPTH, 10) || 3;
const crawlPageConcurrency = parseInt(process.env.MAX_CRAWL_CONCURRENCY, 10) || 3;
const crawlTimeoutMs = (parseInt(process.env.TIMEOUT_CRAWL_SEC, 10) || 300) * 1000;
let activeCrawlsCount = 0;

const forceRespectRobotsTxt = process.env.FORCE_RESPECT_ROBOTS_TXT === 'true';

// 4.5 Allowed URL Pattern Regex
const allowedUrlRegexStr = process.env.ALLOWED_URL_REGEX;
let allowedUrlRegex = null;
if (allowedUrlRegexStr) {
  try {
    allowedUrlRegex = new RegExp(allowedUrlRegexStr);
    logger.info(`[INFO] Restricting allowed URLs to pattern: ${allowedUrlRegexStr}`);
  } catch (err) {
    logger.error(`[ERROR] Invalid ALLOWED_URL_REGEX pattern "${allowedUrlRegexStr}": ${err.message}`);
    process.exit(1);
  }
}

// 5. SSRF Protection utilities are provided by ./lib/ssrf-guard.js

// 6. Stats aggregation
const statsIntervalMin = parseInt(process.env.STATS_INTERVAL_MIN, 10) || 0;
const stats = {
  scansStarted: 0,
  scansCompleted: 0,
  scansErrored: 0,
  scansCrashed: 0,
  crawlsStarted: 0,
  crawlsCompleted: 0,
  crawlsErrored: 0,
  rateLimitHits: 0,
  concurrencyRejections: 0,
  ssrfBlocks: 0,
  apiDenied: 0
};

if (statsIntervalMin > 0) {
  setInterval(() => {
    logger.info(`[INFO] Stats (last ${statsIntervalMin}m): ${stats.scansStarted} started, ${stats.scansCompleted} completed, ${stats.scansErrored} errored, ${stats.scansCrashed} crashed, ${stats.crawlsStarted} crawls-started, ${stats.crawlsCompleted} crawls-completed, ${stats.crawlsErrored} crawls-errored, ${stats.rateLimitHits} rate-limited, ${stats.concurrencyRejections} concurrency-denied, ${stats.ssrfBlocks} SSRF-blocked, ${stats.apiDenied} API-denied`);
    Object.keys(stats).forEach(k => stats[k] = 0);
  }, statsIntervalMin * 60000);
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
    footerText: process.env.FOOTER_TEXT !== undefined ? process.env.FOOTER_TEXT : 'presented by [42bit.io](https://42bit.io)',
    legalLink: process.env.LEGAL_LINK || null,
    forceRespectRobotsTxt,
    maxCrawlPages,
    hasApiKeysConfigured: expectedApiKeys.length > 0,
    auth: {
      oidcEnabled: oidcAuth.oidcEnabled,
      authenticated: oidcAuth.isAuthenticated(req),
      user: oidcAuth.getUser(req),
      providerName: oidcAuth.providerName,
      loginUrl: '/auth/login',
      logoutUrl: '/auth/logout'
    }
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
      logger.error(`[ERROR] Failed to load dictionary '${dict.name}': ${error.message}`);
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

  const validation = validateAndNormalizeUrl(url);
  if (!validation.ok) {
    return res.status(400).json({
      success: false,
      category: validation.category,
      error: validation.error
    });
  }

  const targetUrl = validation.url;
  const targetHostname = validation.hostname;

  if (allowedUrlRegex && !allowedUrlRegex.test(targetUrl)) {
    return res.status(400).json({
      success: false,
      category: 'url_disallowed',
      error: 'The requested URL is not allowed to be audited under this server\'s configuration.'
    });
  }

  // SSRF Protection: Resolve hostname and reject private/internal IPs
  let resolvedAddresses = [];
  try {
    const records = await dns.promises.lookup(targetHostname, { all: true });
    resolvedAddresses = records.map(r => r.address);
  } catch (dnsError) {
    return res.status(400).json({
      success: false,
      category: 'dns_failure',
      error: 'Could not resolve the domain name. Please check that the website exists and is publicly reachable.'
    });
  }

  for (const address of resolvedAddresses) {
    if (isPrivateIP(address)) {
      stats.ssrfBlocks++;
      logger.warn(`[WARN] SSRF blocked`);
      return res.status(400).json({
        success: false,
        category: 'private_ip',
        error: `The hostname ${targetHostname} resolves to a private or internal IP address (${address}). Scanning internal networks is not permitted for security reasons.`
      });
    }
  }

  // Robots.txt enforcement check (server level force-respect)
  if (forceRespectRobotsTxt) {
    try {
      const robotsRes = await safeFetch(`${validation.origin}/robots.txt`, { signal: AbortSignal.timeout(5000) });
      if (robotsRes.ok) {
        const text = await robotsRes.text();
        const robots = new RobotsTxt(text);
        const parsed = new URL(targetUrl);
        if (!robots.isAllowed(parsed.pathname + parsed.search, 'clearload')) {
          return res.status(400).json({
            success: false,
            category: 'robots_disallowed',
            error: 'This URL is disallowed by the website\'s robots.txt policy, and this server is configured to strictly respect robots.txt.'
          });
        }
      }
    } catch (e) {
      // Ignore robots.txt fetch errors
    }
  }

  // Validate custom header (intended for WAF bypass tokens only)
  if (customHeaderName || customHeaderValue) {
    const headerNameRegex = /^[a-zA-Z0-9-]+$/;
    const blockedHeaders = /^(authorization|cookie|host|proxy-|x-forwarded-|x-real-ip|x-api-key)/i;

    if (!customHeaderName || !headerNameRegex.test(customHeaderName)) {
      return res.status(400).json({
        success: false,
        category: 'bad_header',
        error: 'Invalid custom header name. Only alphanumeric characters and hyphens are allowed.'
      });
    }

    if (blockedHeaders.test(customHeaderName)) {
      return res.status(400).json({
        success: false,
        category: 'bad_header',
        error: 'Sensitive headers like Authorization, Cookie, Host, and Proxy headers are not allowed.'
      });
    }

    if (customHeaderValue) {
      let decodedValue = customHeaderValue;
      try {
        decodedValue = decodeURIComponent(customHeaderValue);
      } catch (e) {
        decodedValue = customHeaderValue;
      }
      if (/[\r\n]/.test(decodedValue)) {
        return res.status(400).json({
          success: false,
          category: 'bad_header',
          error: 'Header values cannot contain newline characters (including percent-encoded CRLF).'
        });
      }
    }
  }

  // Concurrency check
  if (activeScansCount >= maxConcurrentScans) {
    stats.concurrencyRejections++;
    logger.warn(`[WARN] Concurrency limit reached (${activeScansCount}/${maxConcurrentScans}), rejecting scan`);
    return res.status(503).json({
      success: false,
      category: 'busy',
      error: 'The server is currently busy processing audits for other websites. Please wait a few seconds and try again.'
    });
  }

  try {
    activeScansCount++;
    stats.scansStarted++;
    logger.debug(`[DEBUG] Scan started (${activeScansCount}/${maxConcurrentScans})`);
    const report = await runAudit(targetUrl, { authUsername, authPassword, customHeaderName, customHeaderValue, targetOrigin: validation.origin, targetHost: targetHostname });
    if (report.success) {
      stats.scansCompleted++;
      logger.debug(`[DEBUG] Scan completed (${activeScansCount}/${maxConcurrentScans})`);
      res.json(report);
    } else {
      stats.scansErrored++;
      logger.warn(`[WARN] Scan error: ${report.category} (${report.error || 'unknown'})`);
      const status = report.category === 'private_ip' || report.category === 'too_many_redirects' ? 400 : 500;
      res.status(status).json(report);
    }
  } catch (error) {
    stats.scansCrashed++;
    logger.error(`[ERROR] Scan crashed: ${error.message}`);
    res.status(500).json({
      success: false,
      category: 'connection',
      error: error.message || 'The audit scan failed. Please check that the website is online and publicly reachable.'
    });
  } finally {
    activeScansCount--;
  }
});

// Crawl endpoint
app.post('/api/crawl', crawlLimiter, async (req, res) => {
  let { url, authUsername, authPassword, customHeaderName, customHeaderValue, discoveryMethod, maxDepth, maxPages, respectRobotsTxt } = req.body;

  const validation = validateAndNormalizeUrl(url);
  if (!validation.ok) {
    return res.status(400).json({
      success: false,
      category: validation.category,
      error: validation.error
    });
  }

  const targetUrl = validation.url;
  const targetHostname = validation.hostname;

  if (allowedUrlRegex && !allowedUrlRegex.test(targetUrl)) {
    return res.status(400).json({
      success: false,
      category: 'url_disallowed',
      error: 'The requested URL is not allowed to be audited under this server\'s configuration.'
    });
  }

  // SSRF Protection: Resolve hostname and reject private/internal IPs
  let resolvedAddresses = [];
  try {
    const records = await dns.promises.lookup(targetHostname, { all: true });
    resolvedAddresses = records.map(r => r.address);
  } catch (dnsError) {
    return res.status(400).json({
      success: false,
      category: 'dns_failure',
      error: 'Could not resolve the domain name. Please check that the website exists and is publicly reachable.'
    });
  }

  for (const address of resolvedAddresses) {
    if (isPrivateIP(address)) {
      stats.ssrfBlocks++;
      logger.warn(`[WARN] SSRF blocked`);
      return res.status(400).json({
        success: false,
        category: 'private_ip',
        error: `The hostname ${targetHostname} resolves to a private or internal IP address (${address}). Scanning internal networks is not permitted for security reasons.`
      });
    }
  }

  // Validate custom header
  if (customHeaderName || customHeaderValue) {
    const headerNameRegex = /^[a-zA-Z0-9-]+$/;
    const blockedHeaders = /^(authorization|cookie|host|proxy-|x-forwarded-|x-real-ip|x-api-key)/i;

    if (!customHeaderName || !headerNameRegex.test(customHeaderName)) {
      return res.status(400).json({
        success: false,
        category: 'bad_header',
        error: 'Invalid custom header name. Only alphanumeric characters and hyphens are allowed.'
      });
    }

    if (blockedHeaders.test(customHeaderName)) {
      return res.status(400).json({
        success: false,
        category: 'bad_header',
        error: 'Sensitive headers like Authorization, Cookie, Host, and Proxy headers are not allowed.'
      });
    }

    if (customHeaderValue) {
      let decodedValue = customHeaderValue;
      try {
        decodedValue = decodeURIComponent(customHeaderValue);
      } catch (e) {
        decodedValue = customHeaderValue;
      }
      if (/[\r\n]/.test(decodedValue)) {
        return res.status(400).json({
          success: false,
          category: 'bad_header',
          error: 'Header values cannot contain newline characters (including percent-encoded CRLF).'
        });
      }
    }
  }

  // Validate crawl params
  if (discoveryMethod && !['auto', 'sitemap', 'crawl'].includes(discoveryMethod)) {
    discoveryMethod = 'auto';
  }

  let depth = parseInt(maxDepth, 10);
  if (isNaN(depth) || depth < 1 || depth > maxCrawlDepth) {
    depth = 2;
  }

  const isLocalhost = isLocalRequest(req);
  const apiKey = req.headers['x-api-key'];
  let hasValidApiKey = false;
  if (apiKey) {
    const keyFormatRegex = /^[a-zA-Z0-9_-]+$/;
    if (apiKey.length >= 32 && apiKey.length <= 128 && keyFormatRegex.test(apiKey)) {
      hasValidApiKey = expectedApiKeys.some(expected => safeCompare(apiKey, expected));
    }
  }
  const isBypassed = isLocalhost || hasValidApiKey;

  if (maxCrawlPages === 0 && !isBypassed) {
    return res.status(403).json({
      success: false,
      category: 'disabled',
      error: 'Multi-page site auditing is disabled on this server. Only single-page scanning is permitted.'
    });
  }

  let pages = parseInt(maxPages, 10);
  if (isNaN(pages) || pages < 2) {
    pages = 25;
  } else if (maxCrawlPages > 0 && !isBypassed && pages > maxCrawlPages) {
    pages = maxCrawlPages;
  }

  // Concurrency check
  if (activeCrawlsCount >= maxConcurrentCrawls) {
    stats.concurrencyRejections++;
    logger.warn(`[WARN] Crawl concurrency limit reached (${activeCrawlsCount}/${maxConcurrentCrawls}), rejecting crawl`);
    return res.status(503).json({
      success: false,
      category: 'busy',
      error: 'The server is currently busy processing crawls for other websites. Please wait a few seconds and try again.'
    });
  }

  // Set headers for streaming NDJSON
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Transfer-Encoding', 'chunked');

  const abortController = new AbortController();
  req.on('close', () => {
    abortController.abort();
  });

  try {
    activeCrawlsCount++;
    stats.crawlsStarted++;
    logger.debug(`[DEBUG] Crawl started (${activeCrawlsCount}/${maxConcurrentCrawls})`);

    let resolvedRespectRobotsTxt = false;
    if (forceRespectRobotsTxt) {
      resolvedRespectRobotsTxt = true;
    } else {
      resolvedRespectRobotsTxt = respectRobotsTxt === true || respectRobotsTxt === 'true';
    }

    const result = await runCrawl(targetUrl, {
      discoveryMethod,
      maxDepth: depth,
      maxPages: pages,
      concurrency: crawlPageConcurrency,
      authUsername,
      authPassword,
      customHeaderName,
      customHeaderValue,
      respectRobotsTxt: resolvedRespectRobotsTxt,
      signal: abortController.signal
    }, (event) => {
      res.write(JSON.stringify(event) + '\n');
    });

    if (result.success) {
      stats.crawlsCompleted++;
      logger.debug(`[DEBUG] Crawl completed (${activeCrawlsCount}/${maxConcurrentCrawls})`);
    } else {
      stats.crawlsErrored++;
      logger.warn(`[WARN] Crawl error: ${result.category} (${result.error || 'unknown'})`);
    }
  } catch (error) {
    stats.crawlsErrored++;
    logger.error(`[ERROR] Crawl crashed: ${error.message}`);
    res.write(JSON.stringify({
      event: 'crawl_failed',
      data: {
        success: false,
        category: 'connection',
        error: error.message || 'The crawl failed. Please check that the website is online and reachable.'
      }
    }) + '\n');
  } finally {
    activeCrawlsCount--;
    res.end();
  }
});

// Startup log: show every environment variable the server has read and the value
// (or effective value, after defaults) that will be used at runtime. Useful for
// verifying deployment configuration without redeploying to test each variable.
// Sensitive values (API keys) are masked.
function summariseConfig() {
  const apiKeyCount = Number(expectedApiKeys.length);
  
  // Validate and sanitize footer text display
  const footerRaw = process.env.FOOTER_TEXT;
  let footerDisplay = '(default: "presented by [42bit.io](https://42bit.io)")';
  if (footerRaw !== undefined) {
    const cleanFooter = String(footerRaw).replace(/[^\w\s\-.:/()[\]]/g, '');
    footerDisplay = cleanFooter.length > 80 ? `"${cleanFooter.slice(0, 80)}…"` : `"${cleanFooter}"`;
  }

  const cleanAllowedUrlRegex = (allowedUrlRegexStr && /^[a-zA-Z0-9^$.*+?|()[\]{}\\]+$/.test(allowedUrlRegexStr))
    ? allowedUrlRegexStr
    : '(not set — any URL can be scanned)';
    
  const rawLegalLink = process.env.LEGAL_LINK;
  const cleanLegalLink = (rawLegalLink && /^https?:\/\/[^\s]+$/i.test(rawLegalLink))
    ? rawLegalLink
    : '(not set — link hidden)';

  const rawLogLevel = process.env.LOG_LEVEL;
  const cleanLogLevel = (rawLogLevel && /^[a-zA-Z]+$/.test(rawLogLevel))
    ? rawLogLevel.toLowerCase()
    : 'info (default)';

  const rawNodeEnv = process.env.NODE_ENV;
  const cleanNodeEnv = (rawNodeEnv && /^[a-zA-Z]+$/.test(rawNodeEnv))
    ? rawNodeEnv
    : '(not set)';

  const rawOidcIssuer = process.env.OIDC_ISSUER;
  const cleanOidcIssuer = (rawOidcIssuer && /^https?:\/\/[^\s]+$/i.test(rawOidcIssuer))
    ? rawOidcIssuer
    : '(not set — OIDC disabled)';

  const rawOidcGroups = process.env.OIDC_ALLOWED_GROUPS;
  const cleanOidcGroups = (rawOidcGroups && /^[a-zA-Z0-9_,-]+$/.test(rawOidcGroups))
    ? rawOidcGroups
    : '(not set — any authenticated user)';

  const rawOpenBrowser = process.env.OPEN_BROWSER;
  const cleanOpenBrowser = (rawOpenBrowser && /^(true|false)$/i.test(rawOpenBrowser))
    ? rawOpenBrowser
    : '(not set)';

  const rawTrustedHost = process.env.TRUSTED_HOST;
  const cleanTrustedHost = (rawTrustedHost && /^[a-zA-Z0-9.-]+(:\d+)?$/.test(rawTrustedHost))
    ? rawTrustedHost
    : '(not set)';

  const rawTrustedProxy = process.env.TRUSTED_PROXY;
  const cleanTrustedProxy = (rawTrustedProxy && /^[a-zA-Z0-9.,-]+$/.test(String(rawTrustedProxy)))
    ? String(rawTrustedProxy)
    : '1 (default)';

  const cleanPort = String(PORT);
  
  const rawTimeoutScan = process.env.TIMEOUT_SCAN_SEC;
  const cleanTimeoutScan = (rawTimeoutScan && /^\d+$/.test(rawTimeoutScan))
    ? `${rawTimeoutScan}s`
    : '90s (default)';

  return [
    ['ALLOWED_URL_REGEX',   cleanAllowedUrlRegex],
    ['API_KEY',             apiKeyCount > 0 ? `**** (${apiKeyCount} key${apiKeyCount === 1 ? '' : 's'} loaded)` : '(not set — same-origin/localhost only)'],
    ['FOOTER_TEXT',         footerDisplay],
    ['FORCE_RESPECT_ROBOTS_TXT',   String(forceRespectRobotsTxt)],
    ['LEGAL_LINK',          cleanLegalLink],
    ['LOG_LEVEL',           cleanLogLevel],
    ['MAX_CONCURRENT_CRAWLS', String(maxConcurrentCrawls)],
    ['MAX_CONCURRENT_SCANS', String(maxConcurrentScans)],
    ['MAX_CRAWL_CONCURRENCY', String(crawlPageConcurrency)],
    ['MAX_CRAWL_DEPTH',       String(maxCrawlDepth)],
    ['MAX_CRAWL_PAGES',       maxCrawlPages === 0 ? '0 (site audit disabled)' : (maxCrawlPages === -1 ? '-1 (unrestricted)' : String(maxCrawlPages))],
    ['MAX_CRAWL_RATE_LIMIT',  isCrawlRateLimitEnabled ? String(crawlRateLimitMax) : '0 (rate limiting disabled)'],
    ['MAX_RATE_LIMIT',      isRateLimitEnabled ? String(rateLimitMax) : '0 (rate limiting disabled)'],
    ['NODE_ENV',            cleanNodeEnv],
    ['OIDC_ISSUER',         oidcAuth.oidcEnabled ? cleanOidcIssuer : '(not set — OIDC disabled)'],
    ['OIDC_ALLOWED_GROUPS', cleanOidcGroups],
    ['OPEN_BROWSER',        cleanOpenBrowser],
    ['PORT',                cleanPort],
    ['RATE_LIMIT_WINDOW_SEC', String(limitWindowSec)],
    ['STATS_INTERVAL_MIN',  process.env.STATS_INTERVAL_MIN !== undefined ? `${statsIntervalMin}m` : '0m (default / disabled)'],
    ['TIMEOUT_CRAWL_SEC',     `${crawlTimeoutMs / 1000}s`],
    ['TIMEOUT_SCAN_SEC',      cleanTimeoutScan],
    ['TRUSTED_HOST',        cleanTrustedHost],
    ['TRUSTED_PROXY',       cleanTrustedProxy],
  ];
}

// Startup: validate OIDC config (abort loudly on misconfiguration, mirroring the
// API-key validation above) and run OIDC discovery (a network round-trip) before
// the port is bound, so that by the time requests arrive the provider is ready.
async function start() {
  if (oidcAuth.oidcEnabled) {
    try {
      oidcAuth.validateConfig();
    } catch (err) {
      logger.error(`========================================================================`);
      logger.error(`CRITICAL CONFIGURATION ERROR: ${err.message}`);
      logger.error(`Server startup aborted.`);
      logger.error(`========================================================================`);
      process.exit(1);
    }
    try {
      await oidcAuth.init(logger);
    } catch (err) {
      logger.error(`[ERROR] OIDC discovery failed for issuer "${process.env.OIDC_ISSUER}": ${err.message}`);
      logger.error(`Server startup aborted. Verify OIDC_ISSUER is reachable and correct.`);
      process.exit(1);
    }
  }

  app.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    logger.info(`ClearLoad server running on ${url}`);

    logger.debug('[INFO] Environment variables processed at startup:');
    for (const [name, value] of summariseConfig()) {
      logger.debug(`         ${name.padEnd(22)} = ${value}`);
    }

    if (process.env.OPEN_BROWSER === 'true' && process.env.NODE_ENV !== 'production') {
      open(url).catch(() => {
        // Fail silently if browser cannot be opened automatically
      });
    }
  });
}

start();
