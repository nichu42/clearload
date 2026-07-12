# ClearLoad Crowdsourced Dictionaries

Help make ClearLoad smarter! When ClearLoad scans a page and flags a resource or cookie as **"Unknown"** or a generic **"Third-Party Connection"**, you can help the community by adding its classification rule to this repository.

No code experience is required to submit an update! You can do it directly on GitHub in a few clicks.

---

## 📖 Which dictionary should I update?

Choose the file that matches the type of asset you want to classify:

1. **[`tracking_patterns.json`](./tracking_patterns.json)**
   * **What goes here:** Hostnames of analytics trackers, marketing pixels, social widgets, ad platforms, and behavioral profiling scripts.
   * **Examples:** `doubleclick.net`, `google-analytics.com`, `bat.bing.com`.
   * **Format:** A sorted list of strings:
     ```json
     [
       "activecampaign.com",
       "adobedtm.com",
       "your-new-tracker-domain.com"
     ]
     ```

2. **[`cmp_mapping.json`](./cmp_mapping.json)**
   * **What goes here:** Consent Management Platform (CMP) cookie banner domains mapped to their official, readable names.
   * **Examples:** `cookiebot.com` mapped to `"Cookiebot"`, `cookielaw.org` mapped to `"OneTrust"`.
   * **Format:** A sorted key-value object (keys are domains, values are platform names):
     ```json
     {
       "cookiebot.com": "Cookiebot",
       "your-new-cmp-domain.com": "Name Of Consent Tool"
     }
     ```

3. **[`public_cdns.json`](./public_cdns.json)**
   * **What goes here:** General-purpose public CDN hosts serving open-source libraries or styling files (like jQuery, Bootstrap, FontAwesome mirrors).
   * **Examples:** `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com`.
   * **Format:** A sorted list of strings:
     ```json
     [
       "cdn.jsdelivr.net",
       "unpkg.com"
     ]
     ```

---

## 🚀 How to propose an addition on GitHub

You can submit your addition directly in your browser without setting up Git:

1. Sign in or create a free account on [GitHub](https://github.com).
2. Navigate to the dictionaries folder in this repository: https://github.com/nichu42/clearload/tree/main/dictionaries
3. Click the dictionary file you want to update (e.g. `tracking_patterns.json`).
3. Click the **Edit File** button (pencil icon) in the top-right toolbar.
4. Add your domain/mapping.
   > [!IMPORTANT]
   > * Entries should be inserted **alphabetically** to keep files clean.
   > * Use lowercase for all domains.
   > * Be sure to follow correct JSON formatting (e.g., ensure comma placement is correct).
5. Scroll down to **Commit Changes**.
6. Enter a descriptive title (e.g., `Add your-domain.com to tracking patterns`).
7. Keep **Create a new branch for this commit and start a pull request** selected, and click **Commit Changes**.
8. Click **New Pull Request** to submit!

Our automated test suite will verify your file's JSON formatting and sorting, and once approved by the project maintainers, your addition will be merged and deployed automatically!
