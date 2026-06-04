# ClearLoad Developer & AI Agent Guidelines

This document provides critical context, design principles, and guidelines for developers and AI coding agents working on the ClearLoad codebase.

## Target Audience
The ClearLoad tool is primarily aimed at website administrators, CMS managers (WordPress, Webflow, Shopify), marketing operations teams, and general technical professionals.
* **Knowledge Assumption:** They understand websites and general IT concepts, but do **not** necessarily have in-depth experience with low-level browser network requests, browser execution contexts, or raw HTTP headers.
* **Terminology Guideline:** Always explain technical browser states and request types. Use hover tooltips for categories (e.g., SCRIPT, FETCH, XHR, CSS) to explain what they do in plain language.

## Design Constraints

1. **Stateless Architecture:** The application must remain completely stateless. Do not add database integrations (SQLite, PostgreSQL, etc.) or local file persistence for past scan reports. Audits must be run on-demand and served in-memory.
2. **Strict IP Leakage Policy:** Under GDPR and ePrivacy guidelines, connecting to *any* third-party domain before consent leaks the visitor's IP address. Therefore:
   - Any external connection must lead to a `NON-COMPLIANT` grading.
   - All third-party connections in the details tables must be colored **Red** (using the `marketing` badge color token) to denote a compliance violation.
3. **Curated CDNs List:** Do not classify generic vendor subdomains (like `cdn.text-sense.com` or `cdn.segment.com`) as generic CDNs. The CDN classification is reserved for general-purpose library mirrors (like `cdnjs`, `jsdelivr`, `unpkg`) configured in `PUBLIC_CDNS` in `audit.js` and loaded from `dictionaries/public_cdns.json`.
4. **Zero-Contact Local Self-Hosting:** To guarantee complete GDPR compliance and zero pre-consent IP leaks from the user's browser, all UI assets (such as FontAwesome icons, Outfit fonts, and Plus Jakarta Sans fonts) must be self-hosted locally. Do not load resources from external CDNs (like Google Fonts or external FontAwesome servers). Map them via the `/vendor/` endpoint in `server.js` using local packages from `node_modules`.
5. **Liability Legal Disclaimer:** To protect the project and maintainers from liability, the About modal, License modal, and footer must always display a clear, prominent legal disclaimer stating that ClearLoad is a technical diagnostic tool, does not constitute legal advice, carries no warranty, and all results must be verified independently.
6. **API Security & Concurrency Control:** To prevent denial-of-service (DoS) and scraping abuse on public deployments:
   - A stateless `apiSecurityGuard` must protect `/api/*` routes, permitting only Same-Origin requests (from the frontend on the same domain), local requests (localhost), or requests supplying a valid API key (configured in `API_KEY`).
   - Configurable IP-based rate limiting must be applied to public scans (exempting localhost and valid API keys).
   - A global concurrency guard (`MAX_CONCURRENT_SCANS`) must reject new audits with `503 Service Unavailable` if the server is processing its maximum limit of parallel Playwright browser sessions.
   - The JSON body parser is limited to 1KB (`express.json({ limit: '1kb' })`). If a future feature requires uploading larger payloads (e.g., sitemap.xml files), increase this limit or add a separate route with a higher limit for that specific endpoint.
7. **Version Management:** Never bump version numbers in `package.json` or create new release tags without explicit instruction from the maintainer. CI/CD workflow fixes, documentation updates, and other non-feature changes do not require version bumps. The maintainer decides when to increment versions and create releases.
8. **Release Process:** When creating a release, always create both a git tag AND a Codeberg release page entry with a proper description. Never create tags without releases. Releases should include a clear, descriptive message explaining what's new, what changed, and any important notes for users.

## Key Technical Systems & Implementation Rules

### 1. Crowdsourced Dictionaries
All rules for cookie definitions, CDNs, CMP mappings, tracking patterns, and widgets are located under `dictionaries/` as JSON files.
* **Validation:** Every change to these files must be validated alphabetically and structurally by running the `npm test` script (which executes `scripts/validate-dictionaries.js`).
* **Guidelines:** Domains and patterns must be lowercase, have no leading/trailing whitespace, and contain no duplicate entries.

### 2. SSL/TLS Encryption & HTTP Fallback
* **Port 80 to 443 Fallback:** The scanner queries port 80 (HTTP) first. If the connection is refused or fails, it automatically falls back to port 443 (HTTPS) and sets the `httpFailed` flag to `true` to alert the user that port 80 is unresponsive, indicating a failure to redirect HTTP traffic to HTTPS.
* **Certificate Security Audit:** Evaluates SSL protocol version (blocking SSL/TLS v1.0/v1.1), weak cipher suites (e.g., 3DES, RC4), HSTS headers, and certificate expiration times.

### 3. Compliance Diagnostics Master-Detail UI
The compliance report uses a Master-Detail sidebar layout divided into three distinct diagnostic chapters:
* **Security & Encryption:** SSL/TLS Encryption, Cookie Security & Policy.
* **Cookies & Local Storage:** Marketing Cookies, Analytics Cookies, Browser Storage.
* **External Connections:** Outbound Trackers, Third-Party Connections, Embedded Widgets.

Each diagnostic chapter maps to corresponding regulatory articles (e.g., GDPR Art 6, 25, 32, 44, or ePrivacy Art 5(3)) and highlights specific risk elaborations, violation incidents, and recommendations.

### 4. Consent Banner IP Leak Paradox
When a website loads third-party consent management platforms (CMPs) like Cookiebot or OneTrust prior to consent, it leaks visitor IP addresses to those CDNs. This is called the "Consent Banner IP Leak Paradox". The UI must specifically flag this scenario and advise hosting the scripts locally or proxying them.

### 5. UI & Styling Standards
* **Theme:** Glassmorphic dark mode styling using vanilla CSS variables.
* **Modals:** The About modal, License modal, and Dictionary guide modal must remain visually cohesive with the main design. Long documents (like licenses) must use a clean, scrollable box with clear typography instead of unstyled pre-formatted text. Close buttons and layout wrappers must follow the exact structure defined in `public/index.html` and `public/style.css`.
