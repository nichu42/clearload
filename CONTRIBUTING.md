# Contributing to ClearLoad

Thank you for your interest in contributing to ClearLoad! We welcome community contributions, bug reports, and suggestions to help improve website privacy and security auditing.

By contributing to this project, you agree to abide by our design and architectural guidelines.

---

## 🛠️ Local Development Setup

To set up a local development environment:

1. **Prerequisites:** Ensure you have [Node.js](https://nodejs.org/) (v24 or later recommended) and [npm](https://www.npmjs.com/) installed.
2. **Clone the Repository:**
   ```bash
   git clone https://github.com/nichu42/clearload.git
   cd clearload
   ```
3. **Install Dependencies:**
   ```bash
   npm install
   ```
4. **Run the Application:**
   ```bash
   npm start
   ```
   Open your browser and navigate to `http://localhost:3000`.

---

## 📐 Core Architecture & Contribution Rules

ClearLoad has a strict set of design rules to ensure compliance with privacy laws and server security. Please adhere to these guidelines when making contributions:

### 1. Stateless Architecture
ClearLoad is designed to be fully stateless and in-memory. 
* Do **not** add database integrations (SQLite, PostgreSQL, etc.) or local file persistence for past scan reports.
* Audits must run on-demand and serve results in-memory.

### 2. Zero-Contact Local Self-Hosting UI Assets
Under GDPR and ePrivacy guidelines, connecting to any third-party domain prior to user consent leaks the visitor's IP address.
* Do **not** load external fonts, icons, or scripts from CDNs (e.g. Google Fonts or external FontAwesome servers).
* All frontend assets must be bundled or mapped locally via the `/vendor/` endpoint in `server.js` using local packages from `node_modules`.

### 3. Strict Compliance Grading
* Connecting to *any* third-party domain prior to consent constitutes a compliance violation.
* All third-party connections in detail tables must be highlighted using the `marketing` badge color token (Red) and lead to a `NON-COMPLIANT` overall grading.
* If a website loads a third-party Consent Management Platform (CMP) like Cookiebot or OneTrust prior to consent, it leaks visitor IP addresses to those CDNs. This scenario must be flagged specifically as the "Consent Banner IP Leak Paradox".

### 4. Crowdsourced Dictionaries
All rules for cookie definitions, CDNs, CMP mappings, tracking patterns, and widgets are located under `dictionaries/` as JSON files.
* Every change to these files must be validated alphabetically and structurally.
* Domains and patterns must be lowercase, contain no leading/trailing whitespace, and have no duplicate entries.
* Before submitting a pull request, always run the validation script:
  ```bash
  npm test
  ```

### 5. Server Routing Rules
* There is intentionally **no catch-all fallback route** in `server.js`.
* The server only responds to static assets in `public/`, vendor endpoints, and the API routes (`GET /api/status`, `GET /api/dictionaries`, `POST /api/scan`). All other routes must return a 404.

---

## 📬 Submitting a Pull Request

1. Fork the repository and create your branch from `master`.
2. Write clean code and keep style changes consistent with the existing codebase.
3. Ensure the test suite passes:
   ```bash
   npm test
   ```
4. Write a descriptive commit message and submit your PR. Never push release tags or bump version numbers in `package.json` manually; release bumps are managed by the maintainer.
