// OIDC (OpenID Connect) authentication for ClearLoad.
//
// This is an OPT-IN layer: it is completely inert unless OIDC_ISSUER (or
// OIDC_ENABLED=true) is configured. When disabled, registerSession() installs a
// no-op passthrough, registerRoutes() adds nothing, and isAuthenticated() always
// returns false — so the server behaves exactly as it did before OIDC existed and
// the existing API-key / same-origin / localhost auth is untouched.
//
// When enabled, it implements the Authorization-Code-with-PKCE flow against a
// generic OIDC provider. The target IdP is Authentik, whose issuer looks like
//   https://<authentik-host>/application/o/<app-slug>/
// and whose discovery document lives at <issuer>/.well-known/openid-configuration.
//
// Sessions are STATELESS: the signed cookie (cookie-session) carries the minimal
// identity (sub/email/name/groups) plus an expiry — there is no server-side store,
// so the app stays single-binary and survives restarts without losing the design's
// stateless property.

import * as client from 'openid-client';
import cookieSession from 'cookie-session';

// ---------------------------------------------------------------------------
// Configuration (read once at module load)
// ---------------------------------------------------------------------------

const issuerUrl = process.env.OIDC_ISSUER;
export const oidcEnabled = !!issuerUrl || process.env.OIDC_ENABLED === 'true';

// Display name for the login button. Generic OIDC, but defaults to our IdP.
export const providerName = process.env.OIDC_PROVIDER_NAME || 'Authentik';

const clientId = process.env.OIDC_CLIENT_ID;
const clientSecret = process.env.OIDC_CLIENT_SECRET;
const sessionSecret = process.env.SESSION_SECRET;
const configuredRedirectUri = process.env.OIDC_REDIRECT_URI;
const scopes = process.env.OIDC_SCOPES || 'openid profile email';
const postLogoutRedirectUri = process.env.OIDC_POST_LOGOUT_REDIRECT_URI;
const allowedGroups = (process.env.OIDC_ALLOWED_GROUPS || '')
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean);
const trustedHost = process.env.TRUSTED_HOST;
const isProduction = process.env.NODE_ENV === 'production';

// Session lifetime (seconds). Defaults to 8 hours. The cookie itself is signed
// and carries an absolute `exp` we re-check on every request.
const sessionMaxAgeSec = parseInt(process.env.OIDC_SESSION_MAX_AGE_SEC, 10) || 8 * 60 * 60;

// Populated asynchronously by init() (needs a network round-trip for discovery).
let oidcConfig = null;

/**
 * Validate required configuration synchronously. Call this at startup BEFORE
 * binding the port so a misconfiguration aborts the boot loudly (mirrors the
 * API-key validation style in server.js). Throws on missing values.
 */
export function validateConfig() {
  if (!oidcEnabled) return;
  const missing = [];
  if (!issuerUrl) missing.push('OIDC_ISSUER');
  if (!clientId) missing.push('OIDC_CLIENT_ID');
  if (!clientSecret) missing.push('OIDC_CLIENT_SECRET');
  if (!sessionSecret) missing.push('SESSION_SECRET');
  if (missing.length > 0) {
    throw new Error(
      `OIDC is enabled but required configuration is missing: ${missing.join(', ')}. ` +
      `Set these environment variables or unset OIDC_ISSUER/OIDC_ENABLED to disable OIDC.`
    );
  }
  if (sessionSecret.length < 16) {
    throw new Error('SESSION_SECRET must be at least 16 characters for a secure signed session cookie.');
  }
}

/**
 * Perform OIDC discovery against the configured issuer. Async — call (and await)
 * during startup. Safe to call when OIDC is disabled (no-op).
 */
export async function init(logger = console) {
  if (!oidcEnabled) return;
  oidcConfig = await client.discovery(new URL(issuerUrl), clientId, clientSecret);
  const meta = oidcConfig.serverMetadata();
  logger.info(`[INFO] OIDC enabled — issuer "${meta.issuer}" discovered. ` +
    `${allowedGroups.length > 0 ? `Access restricted to groups: ${allowedGroups.join(', ')}.` : 'No group restriction.'}`);
}

// ---------------------------------------------------------------------------
// Session middleware
// ---------------------------------------------------------------------------

/**
 * Returns the session middleware. When OIDC is disabled this is a passthrough so
 * req.session is simply never created and nothing downstream changes.
 */
export function sessionMiddleware() {
  if (!oidcEnabled) return (req, res, next) => next();
  return cookieSession({
    name: 'clearload_session',
    keys: [sessionSecret],
    maxAge: sessionMaxAgeSec * 1000,
    httpOnly: true,
    sameSite: 'lax', // returns the cookie on the top-level GET redirect back from the IdP
    secure: isProduction,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRedirectUri(req) {
  if (configuredRedirectUri) return configuredRedirectUri;
  const host = trustedHost || req.headers.host;
  const proto = req.protocol || 'https';
  return `${proto}://${host}/auth/callback`;
}

/**
 * True when the request carries a valid, unexpired authenticated session.
 * Always false when OIDC is disabled.
 */
export function isAuthenticated(req) {
  if (!oidcEnabled) return false;
  const s = req.session;
  if (!s || !s.user || !s.exp) return false;
  // Compare against an injected/asserted "now". Uses Date.now() at request time,
  // which is fine in the server runtime (this is not a workflow script).
  return s.exp * 1000 > Date.now();
}

/**
 * Minimal user identity for the UI, or null. Never exposes tokens.
 */
export function getUser(req) {
  if (!isAuthenticated(req)) return null;
  const { sub, email, name, groups } = req.session.user;
  return { sub, email, name, groups: groups || [] };
}

function groupsAllowed(claims) {
  if (allowedGroups.length === 0) return true;
  const userGroups = Array.isArray(claims.groups) ? claims.groups : [];
  return userGroups.some((g) => allowedGroups.includes(g));
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * Registers /auth/login, /auth/callback, /auth/logout. No-op when OIDC disabled.
 */
export function registerRoutes(app, logger = console) {
  if (!oidcEnabled) return;

  // Begin the login flow: stash state/nonce/PKCE verifier in the session cookie
  // and redirect the browser to the IdP authorization endpoint.
  app.get('/auth/login', async (req, res) => {
    if (!oidcConfig) return res.status(503).send('OIDC provider not ready yet. Please try again shortly.');
    try {
      const codeVerifier = client.randomPKCECodeVerifier();
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
      const state = client.randomState();
      const nonce = client.randomNonce();

      req.session.oidc = { state, nonce, codeVerifier, redirectUri: getRedirectUri(req) };

      const authUrl = client.buildAuthorizationUrl(oidcConfig, {
        redirect_uri: req.session.oidc.redirectUri,
        scope: scopes,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        nonce,
      });
      res.redirect(authUrl.href);
    } catch (err) {
      logger.error(`[ERROR] OIDC login initiation failed: ${err.message}`);
      res.status(500).send('Failed to start login.');
    }
  });

  // IdP redirects back here with ?code&state. Exchange, validate, enforce groups,
  // then persist the minimal identity into the session cookie.
  app.get('/auth/callback', async (req, res) => {
    if (!oidcConfig) return res.status(503).send('OIDC provider not ready yet. Please try again shortly.');
    const pending = req.session && req.session.oidc;
    if (!pending) {
      return res.status(400).send('No login in progress (missing or expired session). Please start again at /auth/login.');
    }
    try {
      const proto = req.protocol || 'https';
      const host = trustedHost || req.headers.host;
      const currentUrl = new URL(req.originalUrl, `${proto}://${host}`);

      const tokens = await client.authorizationCodeGrant(oidcConfig, currentUrl, {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
      });
      const claims = tokens.claims();

      if (!groupsAllowed(claims)) {
        logger.warn(`[WARN] OIDC access denied for sub=${claims.sub}: not in an allowed group.`);
        req.session = null;
        return res.status(403).send('Access denied: your account is not a member of an authorized group.');
      }

      // Persist only what the UI needs; drop the transient flow state and tokens.
      req.session.oidc = undefined;
      req.session.user = {
        sub: claims.sub,
        email: claims.email,
        name: claims.name || claims.preferred_username || claims.email || claims.sub,
        groups: Array.isArray(claims.groups) ? claims.groups : [],
      };
      req.session.exp = Math.floor(Date.now() / 1000) + sessionMaxAgeSec;

      logger.info(`[INFO] OIDC login success: ${req.session.user.email || req.session.user.sub}`);
      res.redirect('/');
    } catch (err) {
      logger.warn(`[WARN] OIDC callback failed: ${err.message}`);
      req.session = null;
      res.status(400).send('Login failed or was tampered with. Please try again.');
    }
  });

  // Clear the local session, then (if the IdP supports it) RP-initiated logout.
  app.post('/auth/logout', (req, res) => {
    req.session = null;
    let endSessionUrl = null;
    try {
      const meta = oidcConfig && oidcConfig.serverMetadata();
      if (meta && meta.end_session_endpoint) {
        const params = {};
        if (postLogoutRedirectUri) params.post_logout_redirect_uri = postLogoutRedirectUri;
        endSessionUrl = client.buildEndSessionUrl(oidcConfig, params).href;
      }
    } catch {
      endSessionUrl = null;
    }
    res.json({ success: true, endSessionUrl });
  });
}
