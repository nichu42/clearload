# 🫧 ClearLoad

<p align="left">
  <a href="https://github.com/nichu42/clearload/releases"><img src="https://img.shields.io/badge/Version-0.6.0-007EC6?style=for-the-badge" alt="Version" /></a>&nbsp;
  <a href="https://hub.docker.com/r/nichu42/clearload"><img src="https://img.shields.io/docker/pulls/nichu42/clearload?style=for-the-badge&logo=docker&logoColor=white" alt="Docker Pulls" /></a>&nbsp;
  <a href="https://clearload.42bit.io"><img src="https://img.shields.io/badge/Live_Demo-clearload.42bit.io-7C3AED?style=for-the-badge&logo=windowsterminal&logoColor=white" alt="Live Demo" /></a>&nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL_v3-E74C3C?style=for-the-badge" alt="License: AGPL v3" /></a>&nbsp;
  <a href="https://liberapay.com/nichu42"><img src="https://img.shields.io/liberapay/patrons/nichu42?style=for-the-badge&logo=liberapay" alt="Liberapay Patrons" /></a>&nbsp;
  <a href="https://ko-fi.com/nichu42"><img src="https://img.shields.io/badge/Support_on-Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Support on Ko-fi" /></a>
</p>

ClearLoad is an on-demand website privacy, cookie, and security compliance auditor. It helps website administrators, CMS managers (WordPress, Webflow, Shopify), and marketing operations teams instantly identify if their site is violating GDPR or ePrivacy regulations.

Simply enter any URL, and ClearLoad launches a sandboxed headless browser to capture exactly what cookies, storage keys, iframe widgets, and network connections are loaded **before** a visitor has granted consent.

## 🤔 Why Use ClearLoad?

### 1. Detect Illegal "Pre-Consent" Tracking
Under GDPR and the ePrivacy Directive, you cannot place non-essential cookies or establish external third-party connections before a visitor explicitly opts in. ClearLoad runs audits on the initial page load state to catch hidden tracking scripts, analytics trackers, and retargeting pixels that are running illegally.

### 2. Identify IP Address Leakage (Third-Party Connections)
Connecting to any third-party domain before consent leaks the visitor's IP address, which is classified as Personal Data under GDPR. ClearLoad automatically flags all external connections (like loading trackers, custom widgets, or fonts from third-party servers) as compliance violations.

### 3. Fully Stateless & Privacy-First Architecture
Unlike commercial compliance tools that store historical scans in databases or charge based on page counts, ClearLoad is designed with a lightweight, stateless approach:
* **In-Memory Audits:** Runs completely on-demand and serves reports directly in-memory, leaving no trace.
* **No Database Overheads:** No database integrations (SQLite, PostgreSQL) or local file persistence are used, making it perfect for micro-containers and low-maintenance hosting.
* **Open Source & Copyleft:** Free to host, modify, and distribute under the copyleft AGPL v3 license.

---

## ✨ Key Features

- **GDPR & ePrivacy Master-Detail Sidebar Diagnostics:**
  - Automatically maps scan findings to specific regulatory articles (e.g., GDPR Art 6, 25, 32, 44, or ePrivacy Art 5(3)) and highlights recommendations.
  - Divider-based visual chapters organize compliance analysis into three parts:
    1. **Security & Encryption:** SSL/TLS details and Cookie Security & Policy (checking HttpOnly, Secure, and SameSite flags).
    2. **Cookies & Local Storage:** Analytics cookies, Marketing/Advertising cookies, and non-essential Browser Storage (LocalStorage/SessionStorage).
    3. **External Connections:** Outbound trackers, general third-party connection IP leaks, and embedded iframe widgets (YouTube, Vimeo, Google Maps, Spotify).
- **Automated Chromium-Based Single-Page Auditing:** Launches Playwright headless Chromium in an isolated sandbox context to capture exactly what cookies, storage, embeds, and connections are loaded **before** a visitor has granted consent.
- **Multi-Page Site Auditing (Crawl & Discover):**
  - Audits multiple pages of a website in a single run (up to a configurable limit of 50 pages).
  - Offers flexible URL discovery methods: **Auto** (checks sitemap, falls back to links), **Sitemap.xml** parsed URLs (supporting transparent gzip/`.gz` decompression, and automatically sorting discovered pages to audit the highest `<priority>` and newest `<lastmod>` pages first, up to the scan's page limit), or recursive **Follow Links** (same-domain link-scraping).
  - Restricts crawl scope by link depth and path prefix to prevent scanning unintended or out-of-scope pages.
  - Restricts redirect targets to the same domain or subdomains, preventing the crawler from auditing external third-party sites if an in-scope URL redirects out-of-domain.
  - Automatically deduplicates discovered URL paths, skipping duplicate redirect targets to prevent scanning the same physical page multiple times.
  - Features a site-wide crawl overview showing aggregated stats, a top site violations filter, and a scrollable table of all audited pages with detailed drill-down views.
- **Consent Banner IP Leak Paradox Detection:** Identifies and flags if a site loads its third-party Consent Management Platform (CMP) like Cookiebot or OneTrust prior to consent, leaking visitor IP addresses to those CDNs.
- **Network Call Inspection & Classification:**
  - Tracks all HTTP/S requests made on load, including request methods, resource types, and hosts.
  - Categorizes request types with plain-language explanations for administrators:
    - **Script:** Executable JavaScript files (potential pre-consent trackers or cookie sources).
    - **Fetch / XHR:** API and data requests made by scripts (potentially leaking user IP addresses to third parties).
    - **CSS:** Stylesheets loaded for page design and layout.
    - **Third-Party CDN / Static Resource:** Library mirrors (e.g., jsDelivr, unpkg, cdnjs) serving open-source resources, distinct from tracking servers.
- **Cookie & Storage Key Classification:** Compares cookies and Local/SessionStorage keys against known definitions in the crowdsourced scanner dictionaries to instantly flag statistics, marketing, or unclassified items.
- **Third-Party Embed Detection:** Checks for third-party iframe widgets (YouTube, Google Maps, Facebook widgets, Vimeo, Spotify) that load external resources on page load.
- **SSL/TLS Security Audit & HTTP Fallback:**
  - Evaluates SSL protocol version (blocking TLS v1.0/v1.1), weak cipher suites (e.g., 3DES, RC4), HSTS headers, and certificate expiration.
  - Queries HTTP (port 80) first and automatically falls back to HTTPS (port 443) if unresponsive, alerting the user about missing HTTP-to-HTTPS redirects.
- **API Security, Rate Limiting & Concurrency Control:**
  - Employs a stateless `apiSecurityGuard` to protect `/api/*` routes, permitting only Same-Origin requests, local requests (localhost), or requests supplying a valid API key.
  - Applies configurable IP-based rate limiting to public scan endpoints.
  - Utilizes a global concurrency guard (`MAX_CONCURRENT_SCANS`) to prevent server overload, returning `503 Service Unavailable` if the maximum limit of parallel Playwright browser sessions is reached.
- **Zero-Contact Local Self-Hosting UI Assets:** Self-hosts all frontend resources (including FontAwesome icons, Outfit fonts, and Plus Jakarta Sans fonts) locally from `node_modules` via the `/vendor/` endpoint to guarantee complete compliance and zero pre-consent IP leaks from the user's browser.
- **Basic Auth & Custom HTTP Headers Support:** Allows providing basic authentication credentials and custom HTTP request header key-value pairs (to bypass WAFs or firewalls) when scanning protected staging or staging/development websites.

---

## 📚 Crowdsourced Scanner Dictionaries

To classify cookies, identify outbound tracking, and recognize static CDNs, ClearLoad relies on community-driven dictionary files located in the `dictionaries/` directory:
* **`tracking_patterns.json`**: Hostnames of analytics, marketing, and advertising scripts.
* **`cmp_mapping.json`**: Mappings of cookie banners to their platform names.
* **`public_cdns.json`**: Public mirrors serving open-source libraries.
* **`cookie_definitions.json`**: Known cookies, their classifications, and standard descriptions.
* **`widget_mappings.json`**: Mappings of iframe sources to interactive widget names.
* **`classification_rules.json`**: General heuristic matching rules for categorizing items.

If you spot `Unknown` cookies or unclassified `Third-Party Connections` in your audit reports, you can help improve the scanner for everyone! Check our **[Dictionaries Guide](./dictionaries/README.md)** to add classifications directly on GitHub with a few clicks. Every dictionary change is automatically checked by our built-in validation script.

---

## 💻 Running Locally

### One-Command Instant Startup
You can launch ClearLoad instantly without manually cloning the repository. Open your terminal and run the command matching your operating system:

* **Linux / macOS:**
  ```bash
  curl -fsSL https://raw.githubusercontent.com/nichu42/clearload/main/run.sh | bash
  ```
* **Windows (PowerShell):**
  ```powershell
  irm https://raw.githubusercontent.com/nichu42/clearload/main/run.ps1 | iex
  ```

---

## 🚀 Deployment Options

### 1. Deploy the Pre-built Public Image (Easiest & Recommended)
Because this project automatically publishes public, pre-built container images, you do not need to build the project from source or set up Git pipelines. You can deploy the app to any container hosting platform (like Bunny.net Magic Containers, Portainer, or Railway) by pointing it directly to:

* **Docker Hub:** `nichu42/clearload:latest`
* **Port:** `3000`

No registry account or authentication is required to pull these public images. The published images are multi-arch manifests supporting both **`linux/amd64`** and **`linux/arm64`** (Apple silicon, Ampere, Raspberry Pi-class servers); your host's architecture is selected automatically on pull.

### 2. Build and Deploy from Git
If you want to build the container from source directly:
1. Paste the public repository HTTP clone URL into your hosting platform's Git import tool.
2. The platform will automatically detect the `Dockerfile` in the root and build the container for your host architecture (`linux/amd64` or `linux/arm64`), then run it on port `3000`. The release pipeline (`.forgejo/workflows/release.yml`) publishes a multi-arch manifest for both.

---

## 📈 Scaling for Production & SaaS

The default docker-compose.yml is configured for moderate use (4 CPUs, 4GB RAM, 200 PIDs). For high-concurrency deployments, scale resources based on `MAX_CONCURRENT_SCANS`:

| Concurrent Scans | Memory | CPUs | PIDs |
| ---------------- | ------ | ---- | ---- |
| 2 (default)      | 2GB    | 2    | 150  |
| 4                | 4GB    | 4    | 200  |
| 6                | 6GB    | 6    | 250  |
| 8                | 8GB    | 8    | 300  |

**Formula:** ~750MB + 500MB overhead per scan, ~1.5 cores per scan, ~30 PIDs per scan + 100 overhead.

When using `docker run` or orchestration platforms (Kubernetes, ECS, Cloud Run), configure resource limits in your deployment manifests using these guidelines.

---

## 🔒 Security & Performance Configuration

When deploying ClearLoad on public Internet servers, you can configure security gates, API access control, and rate limiting using the following environment variables:

| Environment Variable | Description | Default |
| :--- | :--- | :--- |
| `ALLOWED_URL_REGEX` | Optional regex pattern. If set, only target URLs matching this pattern can be scanned. Example: `^https?://([^/]+\.)?example` restricts scans to domains containing "example". | *Not set* (any URL can be scanned) |
| `API_KEY` | Comma/semicolon-separated list of authorized API keys. External API calls must supply a key in the `x-api-key` header. Same-origin and localhost requests are automatically exempted. | *Not set* (restricted to same-origin/localhost) |
| `FOOTER_TEXT` | Custom text/branding to display in the footer. Supports basic Markdown (bold, italics, links, newlines). | `presented by [42bit.io](https://42bit.io)` |
| `FORCE_RESPECT_ROBOTS_TXT` | Forces strict adherence to `robots.txt` Disallow rules for all scans/crawls (disabling the bypass option on the frontend). | `false` |
| `LEGAL_LINK` | Optional URL to a legal notice/privacy policy page. Renders a link in the footer when set; hides it when unset. | *Not set* (link hidden) |
| `LOG_LEVEL` | Minimum log level (`debug`, `info`, `warn`, `error`). No personally identifiable information (PII) is ever logged. | `info` |
| `MAX_CONCURRENT_CRAWLS` | Maximum parallel crawl jobs allowed server-wide. Excess requests receive `503 Service Unavailable`. | `1` |
| `MAX_CONCURRENT_SCANS` | Maximum parallel browser audits running server-wide to prevent CPU/RAM exhaustion. | `2` |
| `MAX_CRAWL_CONCURRENCY` | Maximum concurrent page workers within a single crawl job (worker pool size). | `3` |
| `MAX_CRAWL_DEPTH` | Enforced limit on maximum link depth for site crawls. | `3` |
| `MAX_CRAWL_PAGES` | Maximum pages allowed per crawl. Set `0` to disable crawls entirely, or `-1` for unlimited. (Exempts localhost/API keys). | `50` |
| `MAX_CRAWL_RATE_LIMIT` | Maximum crawl requests per IP in the rate-limit window. Set `0` to disable. | `1` |
| `MAX_RATE_LIMIT` | Maximum single-page scans per IP in the rate-limit window. Set `0` to disable. | `3` |
| `OIDC_ISSUER` | OIDC provider issuer URL. **Setting this enables optional Single Sign-On** (see [OIDC section](#-single-sign-on-oidc--authentik)). For Authentik: `https://<authentik-host>/application/o/<app-slug>/`. | *Not set* (OIDC disabled) |
| `OIDC_CLIENT_ID` | OIDC client ID from your provider. Required when OIDC is enabled. | *Not set* |
| `OIDC_CLIENT_SECRET` | OIDC client secret from your provider. Required when OIDC is enabled. | *Not set* |
| `OIDC_REDIRECT_URI` | Callback URL registered with the provider. | Derived from `TRUSTED_HOST`/request as `<origin>/auth/callback` |
| `OIDC_SCOPES` | Space-separated scopes requested at login. | `openid profile email` |
| `OIDC_ALLOWED_GROUPS` | Comma-separated group names; if set, only users in at least one group may sign in (matched against the `groups` claim). | *Not set* (any authenticated user) |
| `OIDC_PROVIDER_NAME` | Display name shown on the sign-in button (e.g. "Sign in with Authentik"). | `Authentik` |
| `OIDC_POST_LOGOUT_REDIRECT_URI` | Where the provider redirects after RP-initiated logout. | *Not set* |
| `OIDC_SESSION_MAX_AGE_SEC` | Lifetime of the signed session cookie in seconds. | `28800` (8 hours) |
| `OPEN_BROWSER` | Set `true` to auto-open the app in the default browser at startup (disabled in production or remote hosting). | *Not set* |
| `PORT` | The port the Express server listens on. | `3000` |
| `RATE_LIMIT_WINDOW_SEC` | Tracking window duration in seconds for IP rate limiting. | `900` (15 minutes) |
| `SESSION_SECRET` | Secret used to sign the session cookie. **Required when OIDC is enabled** (min. 16 chars). | *Not set* |
| `STATS_INTERVAL_MIN` | Aggregated scan stats logging interval in minutes. Set `0` to disable. | `0` (disabled) |
| `TIMEOUT_CRAWL_SEC` | Timeout in seconds for an entire crawl job. If exceeded, returns results collected up to that point. | `300` (5 minutes) |
| `TIMEOUT_SCAN_SEC` | Timeout in seconds for auditing a single page. Exceeding force-terminates the browser session for that page. | `90` (90 seconds) |
| `TRUSTED_HOST` | Trusted hostname for same-origin checks. Prevents Host header spoofing behind reverse proxies. Format: bare hostname (e.g., `clearload.42bit.io`). | *Not set* (uses `Host` header from request) |
| `TRUSTED_PROXY` | Express reverse proxy trust setting for `X-Forwarded-For` client IP resolution (crucial for rate limiting). See recipes below. | `1` (one reverse-proxy hop) |


### `TRUSTED_PROXY` — Common Deployment Recipes

The default of `1` works out of the box for a single reverse proxy in front of the app. Override it only if your setup differs:

| Deployment | Recommended `TRUSTED_PROXY` | Why |
| :--- | :--- | :--- |
| Running on your laptop (no proxy) | *(unset, default)* | No `X-Forwarded-For` is sent, so the setting is ignored. |
| Docker on your laptop (no proxy) | *(unset, default)* | Same — ignored. |
| One reverse proxy in front (nginx, Traefik, Caddy, Bunny.net edge, Cloudflare, Fly.io, Railway, Render, …) | *(unset, default)* | One hop is exactly right. |
| Two hops in front (e.g. CDN + nginx) | `2` | Two hops means two trusted proxies. |
| No proxy at all, port exposed directly to the internet | `false` | Prevents rate-limit spoofing via fake `X-Forwarded-For`. |
| A specific proxy IP you want to pin to | e.g. `10.0.0.0/8` or `203.0.113.10` | Strictest match. |

> **Note:** The localhost API bypass always uses the real TCP socket address (not the `X-Forwarded-For` header) to guarantee it cannot be spoofed. A local reverse proxy (like nginx) on the same machine is *not* considered local; you must set `TRUSTED_HOST` or provide a valid `API_KEY` for it.

### Production Hardening

ClearLoad's built-in rate limiter is a basic safeguard, but is not a substitute for edge protection. For public deployments, we recommend placing the application behind a WAF, CDN, or reverse proxy that provides:
* DDoS protection and bot detection.
* TLS termination.
* IP-based blocklists (e.g., Spamhaus, firehol).
* Edge-level rate limiting.

Recommended solutions include Cloudflare (free tier), Bunny.net, AWS CloudFront + WAF, or a self-hosted nginx with the `modsecurity` + `fail2ban` stack. Ensure `TRUSTED_PROXY` is configured to match the number of hops.

### Custom API Keys

If you configure custom API keys via the `API_KEY` environment variable, they must meet the following constraints:
* **Length:** Between 32 and 128 characters.
* **Format:** Alphanumeric characters, underscores, and hyphens only (matching `/^[a-zA-Z0-9_-]+$/`).
* **Validation:** The server validates keys at startup and exits immediately if any key is invalid.

#### Generating a Secure 64-Character API Key
To generate a secure random 64-character hexadecimal key (using 32 random bytes), run the command for your operating system:

* **Linux / macOS (OpenSSL):**
  ```bash
  openssl rand -hex 32
  ```
* **Windows (PowerShell):**
  ```powershell
  $bytes = [Byte[]]::new(32); [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); -join ($bytes | % { $_.ToString("x2") })
  ```

### 🔑 Single Sign-On (OIDC / Authentik)

ClearLoad supports **optional** OpenID Connect login so you can put the web UI behind your identity provider. It is **off by default** and only activates when `OIDC_ISSUER` is set — without it, nothing changes.

The implementation is generic OIDC (Authorization Code flow with PKCE) and is tested against [Authentik](https://goauthentik.io/), our reference IdP.

**How it coexists with existing access control:**
* When OIDC is **enabled**, the web UI requires sign-in. The API endpoints (`/api/scan`, `/api/crawl`) accept a **valid session, a valid `x-api-key`, or a localhost request** — so programmatic/CI access via API keys keeps working unchanged. Same-origin requests *alone* no longer bypass auth (otherwise the login would be pointless).
* When OIDC is **disabled**, behaviour is exactly as before (API key / same-origin / localhost).

Sessions are **stateless**: identity is stored in a signed, `HttpOnly`, `SameSite=Lax` cookie (via `SESSION_SECRET`). There is no database or Redis to run.

**Configuring Authentik:**
1. In Authentik, create an **OAuth2/OpenID Provider** and an **Application** for ClearLoad.
2. Set the provider's **Redirect URI** to `https://<your-clearload-host>/auth/callback`.
3. Note the **Client ID** and **Client Secret**, and the issuer URL: `https://<authentik-host>/application/o/<app-slug>/`.
4. *(Optional)* To use `OIDC_ALLOWED_GROUPS`, add a **Scope Mapping** that emits the `groups` claim and include it in the provider's scopes.

**Minimal configuration:**
```bash
OIDC_ISSUER=https://authentik.example.com/application/o/clearload/
OIDC_CLIENT_ID=<client-id>
OIDC_CLIENT_SECRET=<client-secret>
SESSION_SECRET=<random 32+ char string, e.g. `openssl rand -hex 32`>
# Optional:
OIDC_ALLOWED_GROUPS=clearload-users,admins
OIDC_REDIRECT_URI=https://clearload.example.com/auth/callback
```

> The server performs OIDC discovery at startup and **aborts** if `OIDC_ISSUER` is unreachable or required variables are missing, so misconfiguration fails fast rather than silently.

---

## ⚙️ Manual Setup (Development & Customization)

### Prerequisites
* **[Node.js](https://nodejs.org/)** (v20 or higher)
* **npm** (bundled with Node.js)

### Installation & Run
1. Clone the repository and navigate to the directory:
   ```bash
   git clone https://github.com/nichu42/clearload.git
   cd clearload
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the validation checks:
   ```bash
   npm test
   ```
4. Run the application:
   ```bash
   npm start
   ```
5. Open your browser and navigate to `http://localhost:3000`.

---

## 🐳 Docker & Self-Hosting

ClearLoad is pre-packaged as a Docker container. Since Playwright requires underlying system libraries, the container simplifies deployment.

### Running with Docker Compose
To build and run the container locally:
```bash
docker compose up -d
```
The server will start and expose the interface on `http://localhost:3000`.

### Building the Image Manually
```bash
docker build -t clearload .
docker run -d -p 3000:3000 clearload
```

---

## ☕ Support the Developer

ClearLoad is developed with love as an open-source project. If you are happy with the app and would like to support its ongoing development, please consider donating:

<p align="left">
  <a href="https://ko-fi.com/nichu42"><img src="https://img.shields.io/badge/Support_on_Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Support on Ko-fi" /></a>
  <a href="https://liberapay.com/nichu42"><img src="https://img.shields.io/liberapay/patrons/nichu42?style=for-the-badge&logo=liberapay" alt="Liberapay Patrons" /></a>
</p>

---

## ⚖️ Legal Disclaimer

ClearLoad is a technical diagnostic tool, does not constitute legal advice, carries no warranty, and all results must be verified independently.

### No Legal Advice
ClearLoad is an automated technical diagnostic tool designed for testing public website assets. **It does not provide legal advice, legal counsel, or formal compliance certifications.** Use of this tool does not create an attorney-client relationship.

### Limitations of Automated Audits
Compliance with regulations such as the General Data Protection Regulation (GDPR) and the ePrivacy Directive depends on numerous factors, including your privacy policy text, user consent histories, data processing agreements, and overall data handling workflows. Automated tools can only check technical aspects visible on initial page load and cannot evaluate your complete legal compliance framework.

### No Warranty & Liability Limitation
This tool is provided "as is" without any warranty of any kind, either express or implied, including but not limited to warranties of accuracy, completeness, or fitness for a particular purpose. Under no circumstances shall the authors, contributors, or copyright holders be liable for any claims, damages, or other liability arising from your use of or reliance on the tool's findings.

### Privacy & Data Processing
ClearLoad operates as a fully stateless service. We do not store search history, audit reports, or visitor details in any database or file on disk. To prevent service abuse and protect resources, we process client IP addresses transiently in-memory (RAM) for rate limiting. This security data is automatically discarded after 15 minutes and is never logged to disk or shared with third parties.

### User Responsibility
You are solely responsible for verifying the accuracy of the audit results and ensuring your website meets all applicable legal requirements. We strongly recommend consulting with a qualified legal professional to address your specific compliance needs.

---

## 📄 License

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. [See the GNU Affero General Public License for more details.](LICENSE)

---

## 🛠️ Built With (Open Source Credits)

ClearLoad is made possible by the following open-source software and libraries:

* **[Node.js](https://nodejs.org/)** (MIT License) - JavaScript runtime built on Chrome's V8 engine, executing the backend server code.
* **[Express](https://expressjs.com/)** (MIT License) - Fast, minimalist web framework for Node.js.
* **[express-rate-limit](https://github.com/express-rate-limit/express-rate-limit)** (MIT License) - Rate-limiting middleware for Express to prevent abuse.
* **[Helmet](https://helmetjs.github.io/)** (MIT License) - Security middleware that sets HTTP headers to protect against common web vulnerabilities.
* **[Playwright](https://playwright.dev/)** (Apache 2.0 License) - Headless browser automation library.
* **[open](https://github.com/sindresorhus/open)** (MIT License) - Cross-platform utility to open URLs in the default browser safely.
* **[FontAwesome Icons](https://fontawesome.com/)** (SIL OFL 1.1 / MIT / CC BY 4.0) - Modern vector icons, self-hosted locally to prevent third-party IP leakage.
* **[Outfit](https://github.com/Outfitio/Outfit-Fonts)** & **[Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans)** (SIL OFL 1.1) - Open-source typography designed by Rodrigo Fuenzalida and Tokotype, self-hosted locally for GDPR compliance.
