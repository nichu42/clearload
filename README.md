# 🫧 ClearLoad

ClearLoad is an on-demand website privacy, cookie, and security compliance auditor. It helps website administrators, CMS managers (WordPress, Webflow, Shopify), and marketing operations teams instantly identify if their site is violating GDPR or ePrivacy regulations.

Simply enter any URL, and ClearLoad launches a sandboxed headless browser to capture exactly what cookies, storage keys, iframe widgets, and network connections are loaded **before** a visitor has granted consent.

<p align="left">
  <a href="https://clearload.42bit.io"><img src="https://img.shields.io/badge/Live_Demo-clearload.42bit.io-7C3AED?style=for-the-badge&logo=windowsterminal&logoColor=white" alt="Live Demo" /></a>
</p>

## Why use ClearLoad?

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

## Technical Browser Request Types

To make compliance details easy to understand for website administrators and CMS managers, ClearLoad categorizes page items and provides explanations:
* **Script:** Executable JavaScript files. If loaded from third parties before consent, they may track users or drop cookies.
* **Fetch / XHR:** Network requests made by JavaScript scripts. If sent to third-party domains (e.g., analytics or advertising servers), they leak the user's IP address and browsing data.
* **CSS:** Stylesheets loaded to design the website.
* **Third-Party CDN / Static Resource:** Public general-purpose library mirrors (like `cdnjs`, `jsdelivr`, `unpkg`) used to load common JavaScript/CSS frameworks. Note that generic vendor-specific subdomains (like Segment or Klaviyo) are treated as third-party connections, not general CDNs.

---

## Key Features

- **Automated Chromium-Based Scanning:** Crawls target sites using Playwright headless Chromium in an isolated context.
- **SSL/TLS Security Audit & HTTP Fallback:**
  - Evaluates SSL protocol version (blocking TLS v1.0/v1.1), weak cipher suites (e.g., 3DES, RC4), HSTS headers, and certificate expiration.
  - Queries HTTP (port 80) first and falls back to HTTPS (port 443) if unresponsive, alerting the user about missing HTTP-to-HTTPS redirects.
- **GDPR & ePrivacy Master-Detail Sidebar Diagnostics:**
  - Automatically maps findings and provides detailed recommendations aligned with regulatory compliance (e.g., GDPR Art 6, 25, 32, 44, or ePrivacy Art 5(3)).
  - Groups diagnostics into three clear chapters:
    1. **Security & Encryption:** SSL/TLS details and Cookie Security & Policy (checking HttpOnly, Secure, and SameSite flags).
    2. **Cookies & Local Storage:** Pre-consent Analytics cookies, Marketing/Advertising cookies, and non-essential Browser Storage (LocalStorage/SessionStorage).
    3. **External Connections:** Outbound trackers, general third-party connection IP leaks, and embedded iframe widgets (YouTube, Vimeo, Google Maps, Spotify).
- **Consent Banner IP Leak Paradox Detection:** Identifies and flags if a site loads its third-party Consent Management Platform (CMP) like Cookiebot or OneTrust prior to consent, leaking visitor IP addresses.
- **Cookie & Storage Key Classification:** Compares cookies and keys against known definition rules.
- **Third-Party Embed Detection:** Checks for third-party iframe widgets (YouTube, Google Maps, Facebook widgets, Vimeo, Spotify).
- **Network Call Inspection:** Tracks all HTTP/S requests made on load, including request methods, resource types, and hosts.

---

## 📚 Crowdsourced Scanner Dictionaries

To classify cookies, identify outbound tracking, and recognize static CDNs, ClearLoad relies on community-driven dictionary files located in the `dictionaries/` directory:
* **`tracking_patterns.json`**: Hostnames of analytics, marketing, and advertising scripts.
* **`cmp_mapping.json`**: Mappings of cookie banners to their platform names.
* **`public_cdns.json`**: Public mirrors serving open-source libraries.
* **`cookie_definitions.json`**: Known cookies, their classifications, and standard descriptions.
* **`widget_mappings.json`**: Mappings of iframe sources to interactive widget names.
* **`classification_rules.json`**: General heuristic matching rules for categorizing items.

If you spot `Unknown` cookies or unclassified `Third-Party Connections` in your audit reports, you can help improve the scanner for everyone! Check our **[Dictionaries Guide](./dictionaries/README.md)** to add classifications directly on Codeberg with a few clicks. Every dictionary change is automatically checked by our built-in validation script.

---

## Running Locally

### One-Command Instant Startup
You can launch ClearLoad instantly without manually cloning the repository. Open your terminal and run the command matching your operating system:

* **Linux / macOS:**
  ```bash
  curl -fsSL https://codeberg.org/nichu42/clearload/raw/branch/main/run.sh | bash
  ```
* **Windows (PowerShell):**
  ```powershell
  irm https://codeberg.org/nichu42/clearload/raw/branch/main/run.ps1 | iex
  ```

---

### Manual Setup

#### Prerequisites
* **[Node.js](https://nodejs.org/)** (v20 or higher)
* **npm** (bundled with Node.js)

#### Installation & Run
1. Clone the repository and navigate to the directory:
   ```bash
   git clone https://codeberg.org/nichu42/clearload.git
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

## Docker & Self-Hosting

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

## Deployment Options

### 1. Deploy the Pre-built Public Image (Easiest & Recommended)
Because this project automatically publishes public, pre-built container images, you do not need to build the project from source or set up Git pipelines. You can deploy the app to any container hosting platform (like Bunny.net Magic Containers, Portainer, or Railway) by pointing it directly to:

* **Docker Hub:** `nichu42/clearload:latest`
* **Codeberg Registry:** `codeberg.org/nichu42/clearload:latest`
* **Port:** `3000`

*(Note: You can substitute the `latest` tag with any specific release tag, such as `v1.0.0`.)*

No registry account or authentication is required to pull these public images.

### 2. Build and Deploy from Git
If you want to build the container from source directly:
1. Paste the public repository HTTP clone URL into your hosting platform's Git import tool.
2. The platform will automatically detect the `Dockerfile` in the root, build the `linux/amd64` container, and run it on port `3000`.

---

## Scaling for Production & SaaS

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
| `API_KEY` | Comma or semicolon-separated list of authorized keys. When set, external API calls must supply a matching key in the `x-api-key` header. Same-origin browser requests and localhost calls are automatically exempted. | *Not set* (restricted to same-origin/localhost) |
| `FOOTER_TEXT` | Custom branding or text to display in the web application's footer. Supports basic markdown/markup formatting (bold, italics, links, and newlines). | `presented by (42bit.io)[42bit.io]` |
| `LEGAL_LINK` | Optional URL to your Imprint / Legal Notice / Privacy Policy page. When set, a "Legal Notice & Privacy Policy" link is rendered in the footer between `Disclaimer` and `License`, opening in a new tab. When unset, the link (and its ` • ` separator) are hidden. | *Not set* (link hidden) |
| `LOG_LEVEL` | Minimum log level for startup and runtime messages. `debug` includes the full environment variable table and per-scan lifecycle events; `info` shows standard startup and rate limit messages; `warn` shows security-relevant events (SSRF blocks, API denials) and operational issues (concurrency rejections); `error` shows only critical failures. No personally identifiable information (PII) is ever logged. | `info` |
| `MAX_CONCURRENT_SCANS` | The maximum number of browser audits running in parallel on the server to prevent CPU/RAM exhaustion. | `2` |
| `OPEN_BROWSER` | When set to `true`, the application attempts to automatically open the app URL in the default system browser on server startup. | *Not set* |
| `PORT` | The port on which the Express application server listens. | `3000` |
| `RATE_LIMIT_MAX` | The maximum number of scan requests allowed per IP address in the window. Set to `0` to disable rate limiting entirely. | `3` |
| `RATE_LIMIT_WINDOW_SEC` | The tracking window in seconds for IP rate limiting. | `900` (15 minutes) |
| `SCAN_TIMEOUT_MS` | Maximum duration in milliseconds for a single audit scan. If the target website is unresponsive or extremely slow, the scan is aborted and the browser session is force-closed to prevent resource exhaustion. | `90000` (90 seconds) |
| `STATS_INTERVAL_MIN` | Interval in minutes for logging aggregated scan statistics (started, completed, errored, crashed, rate-limited, concurrency-denied, SSRF-blocked, API-denied). Set to `0` to disable. | `0` (disabled) |
| `TRUSTED_PROXY` | Tells Express which reverse proxies to trust when reading the `X-Forwarded-For` header (so the original client IP is used for rate limiting and security checks). Accepts the standard Express formats: `false` (disable trust), `true` (insecure, trusts all), an integer hop count (e.g. `1`), a named preset (`loopback`, `linklocal`, `uniquelocal`), a single IP/CIDR (e.g. `10.0.0.0/8`), or a comma-separated list of any of the above. | `1` (one reverse-proxy hop) |
| `TRUSTED_HOST` | The trusted hostname for same-origin checks. When set, the server compares incoming `Origin` and `Referer` headers against this value instead of the `Host` header from the request. This prevents Host header spoofing attacks in production deployments behind reverse proxies. **Format:** a single bare hostname (e.g. `clearload.42bit.io`) — no scheme, no port, no path. Must match the `Host` header browsers send for your deployment. Only one value is supported; for multiple hostnames, set this to the canonical host and ensure all clients use it. | *Not set* (uses `Host` header from request) |

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

**Note:** the localhost API bypass always uses the real TCP socket address (not the `X-Forwarded-For` header), so it stays unforgeable regardless of how `TRUSTED_PROXY` is set. A local nginx in front of the app is *not* considered "local" — set `TRUSTED_HOST` or supply an `API_KEY` for it.

### Production Hardening

ClearLoad's built-in rate limiter (default: 3 scans per 15 minutes per IP) is the primary security boundary, but it is not a substitute for edge protection. For any public deployment, place the app behind a WAF, CDN, or reverse proxy that provides:

- DDoS protection and bot detection
- TLS termination
- IP-based blocklists (e.g. Spamhaus, firehol)
- Edge rate limiting as a second layer

Examples that work well: Cloudflare (free tier covers this), Bunny.net (the project's recommended host), AWS CloudFront + WAF, or a self-hosted nginx with the `modsecurity` + `fail2ban` stack. The `TRUSTED_PROXY` setting must be adjusted to match the number of trusted hops in your chain (see above).

### Key Length & Format Constraints
* API keys must be between **32 and 128 characters** long.
* Keys must contain only alphanumeric characters, underscores, and hyphens (matching the regex `/^[a-zA-Z0-9_-]+$/`).
* The server will validate keys at startup and exit immediately if any configured key fails these requirements.

### Generating a Secure 64-Character API Key
To create a strong, cryptographically secure 64-character hexadecimal key (by generating 32 random bytes), run the command matching your operating system in your terminal:

* **Linux / macOS (OpenSSL):**
  ```bash
  openssl rand -hex 32
  ```
* **Windows (PowerShell):**
  ```powershell
  $bytes = [Byte[]]::new(32); [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); -join ($bytes | % { $_.ToString("x2") })
  ```

---

## Maintainer Guide: Automated CI/CD Releases
If you fork this project or want to maintain your own release registry (e.g. pushing automated updates to Bunny.net Magic Containers on release tags), you can use the pre-configured workflow file at `.forgejo/workflows/release.yml`:

1. **Registry Authentication:**
   * Create a **Personal Access Token (PAT)** on Codeberg with package read/write permissions.
   * Add `codeberg.org` as a private image registry in your Bunny.net dashboard using your Codeberg username and PAT.
2. **Configure Action Secrets:**
   * In your Codeberg Repository Settings, add the secrets `BUNNY_API_KEY` (your Bunny.net API Access Key) and `BUNNY_APP_ID` (your Magic Containers Application ID).
3. **Triggering Deployments:**
   * Pushing a release tag starting with `v` (e.g. `v1.0.0`) will automatically build, tag, and push the image to your Codeberg Package Registry, and trigger a rolling update on Bunny.net.

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

---

## ☕ Support the Developer

ClearLoad is developed with love as an open-source project. If you are happy with the app and would like to support its ongoing development, please consider donating:

<p align="left">
  <a href="https://ko-fi.com/nichu42"><img src="https://img.shields.io/badge/Support_on_Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Support on Ko-fi" /></a>
  <a href="https://liberapay.com/nichu42"><img src="https://img.shields.io/badge/Donate_via_Liberapay-F6C915?style=for-the-badge&logo=liberapay&logoColor=black" alt="Donate via Liberapay" /></a>
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

## License

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. [See the GNU Affero General Public License for more details.](LICENSE)
