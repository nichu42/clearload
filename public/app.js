document.addEventListener('DOMContentLoaded', () => {
  const TYPE_EXPLANATIONS = {
    'SCRIPT': 'JavaScript file: Code executed by the browser to run interactive widgets, scripts, or track page views.',
    'FETCH': 'Data request (API): Modern browser fetch command used by scripts to load content or transmit data in the background.',
    'XHR': 'Data request (API): Older XMLHttpRequest background request used to load data dynamically without page reload.',
    'FONT': 'Web Font: Custom typography file loaded to display styled lettering (e.g. Google Fonts).',
    'STYLESHEET': 'CSS Stylesheet: Rules describing how the layout, fonts, and colors of page elements should be presented.',
    'CSS': 'CSS Stylesheet: Rules describing how the layout, fonts, and colors of page elements should be presented.',
    'IMAGE': 'Image file: Picture, graphic, logo, or icon loaded by the page.',
    'MEDIA': 'Media file: Audio or video asset playing on the page.',
    'DOCUMENT': 'HTML Document: Main page layout or a nested iframe document containing another page.',
    'IFRAME': 'Iframe Document: A nested web page inside a frame, often containing external widgets.',
    'PING': 'Beacon ping: Small background request used specifically for logging page views and user tracking.',
    'OTHER': 'Other Resource: Generic network request for custom extensions, manifests, or unknown assets.'
  };

  const ARTICLE_URLS = {
    'GDPR Art 6': 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679',
    'GDPR Art 25': 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679',
    'GDPR Art 44': 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679',
    'ePrivacy Art 5(3)': 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32002L0058'
  };

  const scanForm = document.getElementById('scanForm');
  const targetUrlInput = document.getElementById('targetUrl');
  const scanBtn = document.getElementById('scanBtn');
  
  // Advanced options selectors
  const toggleAdvancedBtn = document.getElementById('toggleAdvancedBtn');
  const advancedOptionsPanel = document.getElementById('advancedOptionsPanel');
  const authUsernameInput = document.getElementById('authUsername');
  const authPasswordInput = document.getElementById('authPassword');
  const customHeaderNameInput = document.getElementById('customHeaderName');
  const customHeaderValueInput = document.getElementById('customHeaderValue');
  const apiKeyInput = document.getElementById('apiKey');

  // Toggle Advanced Options Panel
  toggleAdvancedBtn.addEventListener('click', () => {
    advancedOptionsPanel.classList.toggle('hidden');
  });

  // Return to main screen on logo click (fresh load without parameters)
  const logoLink = document.getElementById('logoLink');
  if (logoLink) {
    logoLink.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = window.location.pathname;
    });
  }

  // Guide Modal close behavior
  const guideModal = document.getElementById('guideModal');
  const closeGuideModalBtn = document.getElementById('closeGuideModalBtn');
  if (closeGuideModalBtn && guideModal) {
    closeGuideModalBtn.addEventListener('click', () => {
      guideModal.classList.add('hidden');
    });
    guideModal.addEventListener('click', (e) => {
      if (e.target === guideModal) {
        guideModal.classList.add('hidden');
      }
    });
  }
  
  const loaderSection = document.getElementById('loaderSection');
  const loaderStatus = document.getElementById('loaderStatus');
  const progressBar = document.getElementById('progressBar');
  
  const errorSection = document.getElementById('errorSection');
  const errorMessage = document.getElementById('errorMessage');
  const retryBtn = document.getElementById('retryBtn');
  
  const dashboardSection = document.getElementById('dashboardSection');
  
  // Tab Elements
  const tabButtons = document.querySelectorAll('.details-card > .tab-nav > .tab-btn');
  const tabContents = document.querySelectorAll('.details-card .tab-content');
  
  // Dashboard Metrics
  const complianceCard = document.getElementById('complianceCard');
  const statusBadge = document.getElementById('statusBadge');
  const statusIcon = document.getElementById('statusIcon');
  const statusText = document.getElementById('statusText');
  const statusExplanation = document.getElementById('statusExplanation');
  const scannedUrlText = document.getElementById('scannedUrlText');
  const scannedUrlTextLink = document.getElementById('scannedUrlTextLink');
  const scanTimeText = document.getElementById('scanTimeText');
  
  const cookieBadgeCount = document.getElementById('cookieBadgeCount');
  const connBadgeCount = document.getElementById('connBadgeCount');
  
  // Data state
  let currentScanData = null;
  let activeCookieFilter = 'all';
  let activeConnFilter = 'all';
  
  // Tab Switching
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.add('hidden'));
      
      btn.classList.add('active');
      document.getElementById(tabId).classList.remove('hidden');
    });
  });

  // Core Audit Scan Executor
  async function runAuditScan(url) {
    // Standardize URL input value
    targetUrlInput.value = url;
    
    const authUsername = authUsernameInput.value.trim();
    const authPassword = authPasswordInput.value.trim();
    const customHeaderName = customHeaderNameInput.value.trim();
    const customHeaderValue = customHeaderValueInput.value.trim();
    const apiKey = apiKeyInput.value.trim();

    // Update address bar with URL parameter for shareability
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('url', url);

    if (customHeaderName) searchParams.set('hdr_name', customHeaderName);
    else searchParams.delete('hdr_name');

    if (customHeaderValue) searchParams.set('hdr_val', customHeaderValue);
    else searchParams.delete('hdr_val');

    const newRelativePathQuery = window.location.pathname + '?' + searchParams.toString();
    window.history.pushState(null, '', newRelativePathQuery);

    startScanLoading();
    
    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {})
        },
        body: JSON.stringify({ 
          url,
          authUsername,
          authPassword,
          customHeaderName,
          customHeaderValue
        })
      });
      
      let errorMsg = 'The audit scan failed. Please check that the website is online and publicly reachable.';
      try {
        const data = await response.json();
        if (response.ok && data.success) {
          currentScanData = data;
          renderDashboard(data);
          showDashboard();
          return;
        }
        errorMsg = data.error || errorMsg;
      } catch (jsonErr) {
        // Fallback to HTTP status codes if JSON parsing fails
        if (response.status === 400) {
          errorMsg = 'Please provide a valid website domain name (e.g., yourwebsite.com).';
        } else if (response.status === 429) {
          errorMsg = 'Too many audits have been requested from your IP address. Please wait a few minutes before trying again.';
        } else if (response.status === 503) {
          errorMsg = 'The server is currently busy processing audits for other websites. Please wait a few seconds and try again.';
        } else if (response.status === 403 || response.status === 401) {
          errorMsg = 'Access denied. This server\'s scan API is restricted to authorized requests.';
        }
      }
      showError(errorMsg);
    } catch (err) {
      showError('Could not communicate with the scanner backend. Please check your network connection.');
    }
  }

  // Domain Sanitization and Validation
  function cleanAndValidateDomain(str) {
    let input = str.trim();
    if (!input) return null;

    // Strip any leading http:// or https:// if typed
    input = input.replace(/^https?:\/\//i, '');

    // Remove any paths, queries, or trailing slashes (keep only host part)
    input = input.split('/')[0];

    // Basic domain structure check (must contain a dot, valid characters, and end with a TLD or port)
    // Allows subdomains and localhost or IP addresses as hosts
    const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z0-9-]{2,}(:\d+)?$/;
    const localhostRegex = /^localhost(:\d+)?$/;
    const ipRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/;

    if (domainRegex.test(input) || localhostRegex.test(input) || ipRegex.test(input)) {
      return input;
    }
    return null;
  }

  // Form Submit (Audit Trigger)
  scanForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const rawInput = targetUrlInput.value.trim();
    if (!rawInput) return;

    const cleanedDomain = cleanAndValidateDomain(rawInput);
    if (!cleanedDomain) {
      showError('Please provide a valid website domain name (e.g., yourwebsite.com).');
      return;
    }

    // Update input value with cleaned domain for visual feedback
    targetUrlInput.value = cleanedDomain;
    runAuditScan(cleanedDomain);
  });

  retryBtn.addEventListener('click', () => {
    errorSection.classList.add('hidden');
    const savedApiKey = sessionStorage.getItem('clearload_api_key') || '';
    scanForm.reset();
    if (savedApiKey) {
      apiKeyInput.value = savedApiKey;
    }
    // Clear URL query parameters on retry
    const newRelativePathQuery = window.location.pathname;
    window.history.pushState(null, '', newRelativePathQuery);
    targetUrlInput.focus();
  });

  // Share Button Action (Clipboard Copy)
  const shareBtn = document.getElementById('shareBtn');
  shareBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      
      // Visual feedback: change button text and icon
      const icon = shareBtn.querySelector('i');
      const text = shareBtn.querySelector('span');
      
      const originalIconClass = icon.className;
      const originalText = text.innerText;
      
      icon.className = 'fa-solid fa-check';
      text.innerText = 'Link Copied!';
      shareBtn.classList.add('copied');
      
      setTimeout(() => {
        icon.className = originalIconClass;
        text.innerText = originalText;
        shareBtn.classList.remove('copied');
      }, 2000);
    } catch (err) {
      alert('Could not copy link to clipboard. Please copy the URL from the browser address bar.');
    }
  });

  // Setup live loading animations & steps
  let loadingInterval;
  
  const STEP_NAMES = {
    1: 'Spawning sandboxed browser',
    2: 'HTTPS upgrade check',
    3: 'Cookie security audit',
    4: 'Marketing cookies audit',
    5: 'Analytics cookies audit',
    6: 'Browser storage audit',
    7: 'Outbound trackers scan',
    8: 'Third-party connections scan',
    9: 'Embedded widgets scan'
  };

  function getStepName(stepNum) {
    return STEP_NAMES[stepNum] || '';
  }

  function getLoaderStatusMsg(stepNum) {
    if (stepNum === 1) return 'Initializing isolated Chromium context...';
    if (stepNum === 2) return 'Checking SSL/TLS certificate configuration...';
    if (stepNum === 3) return 'Evaluating cookie HttpOnly/Secure flags...';
    if (stepNum === 4) return 'Analyzing page for pre-consent marketing cookies...';
    if (stepNum === 5) return 'Analyzing page for pre-consent analytics cookies...';
    if (stepNum === 6) return 'Auditing LocalStorage & SessionStorage keys...';
    if (stepNum === 7) return 'Scanning network traffic for tracking scripts...';
    if (stepNum === 8) return 'Identifying third-party network connections...';
    if (stepNum === 9) return 'Detecting embedded third-party iframe widgets...';
    return 'Auditing website privacy compliance...';
  }

  function startScanLoading() {
    // Hide previous UI sections
    dashboardSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    loaderSection.classList.remove('hidden');
    
    // Disable inputs
    targetUrlInput.disabled = true;
    scanBtn.disabled = true;
    
    // Reset steps
    const stepsCount = 9;
    for (let i = 1; i <= stepsCount; i++) {
      const el = document.getElementById(`step${i}`);
      if (el) {
        el.className = 'step';
        el.innerHTML = i === 1 
          ? `<i class="fa-solid fa-circle-notch fa-spin"></i> ${getStepName(i)}`
          : `<i class="fa-regular fa-circle"></i> ${getStepName(i)}`;
      }
    }
    const step1 = document.getElementById('step1');
    if (step1) step1.classList.add('active');
    
    progressBar.style.width = '5%';
    loaderStatus.innerText = getLoaderStatusMsg(1);
    
    let elapsedSeconds = 0;
    
    loadingInterval = setInterval(() => {
      elapsedSeconds += 0.5;
      
      // Calculate visual percentage up to 92% (stays there until server responds)
      let pct = 5 + (elapsedSeconds * 4.5);
      if (pct > 92) pct = 92;
      progressBar.style.width = `${pct}%`;
      
      // Step triggers based on 1.5 second intervals
      if (elapsedSeconds === 1.5) {
        markStepDone('step1', getStepName(1));
        activateStep('step2', getStepName(2));
        loaderStatus.innerText = getLoaderStatusMsg(2);
      } else if (elapsedSeconds === 3.0) {
        markStepDone('step2', getStepName(2));
        activateStep('step3', getStepName(3));
        loaderStatus.innerText = getLoaderStatusMsg(3);
      } else if (elapsedSeconds === 4.5) {
        markStepDone('step3', getStepName(3));
        activateStep('step4', getStepName(4));
        loaderStatus.innerText = getLoaderStatusMsg(4);
      } else if (elapsedSeconds === 6.0) {
        markStepDone('step4', getStepName(4));
        activateStep('step5', getStepName(5));
        loaderStatus.innerText = getLoaderStatusMsg(5);
      } else if (elapsedSeconds === 7.5) {
        markStepDone('step5', getStepName(5));
        activateStep('step6', getStepName(6));
        loaderStatus.innerText = getLoaderStatusMsg(6);
      } else if (elapsedSeconds === 9.0) {
        markStepDone('step6', getStepName(6));
        activateStep('step7', getStepName(7));
        loaderStatus.innerText = getLoaderStatusMsg(7);
      } else if (elapsedSeconds === 10.5) {
        markStepDone('step7', getStepName(7));
        activateStep('step8', getStepName(8));
        loaderStatus.innerText = getLoaderStatusMsg(8);
      } else if (elapsedSeconds === 12.0) {
        markStepDone('step8', getStepName(8));
        activateStep('step9', getStepName(9));
        loaderStatus.innerText = getLoaderStatusMsg(9);
      }
    }, 500);
  }

  function activateStep(id, text) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('active');
      el.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${text}`;
    }
  }

  function markStepDone(id, text) {
    const el = document.getElementById(id);
    if (el) {
      el.className = 'step done';
      el.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${text}`;
    }
  }

  function finishLoading() {
    clearInterval(loadingInterval);
    progressBar.style.width = '100%';
    
    const stepsCount = 9;
    for (let i = 1; i <= stepsCount; i++) {
      const el = document.getElementById(`step${i}`);
      if (el) {
        el.className = 'step done';
        el.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${getStepName(i)}`;
      }
    }
    
    setTimeout(() => {
      loaderSection.classList.add('hidden');
      targetUrlInput.disabled = false;
      scanBtn.disabled = false;
    }, 400);
  }

  function showError(msg) {
    clearInterval(loadingInterval);
    loaderSection.classList.add('hidden');
    errorSection.classList.remove('hidden');
    errorMessage.innerText = msg;
    
    targetUrlInput.disabled = false;
    scanBtn.disabled = false;
  }

  function showDashboard() {
    finishLoading();
    setTimeout(() => {
      dashboardSection.classList.remove('hidden');
      // Scroll to dashboard
      dashboardSection.scrollIntoView({ behavior: 'smooth' });
    }, 500);
  }

  // Dashboard Renderer
  function renderDashboard(data) {
    // 1. Basic Info
    scannedUrlText.innerText = data.url;

    // Handle Redirect info display
    const redirectContainer = document.getElementById('redirectInfoContainer');
    const redirectText = document.getElementById('redirectInfoText');
    if (redirectContainer && redirectText) {
      if (data.redirected) {
        redirectContainer.classList.remove('hidden');
        redirectText.innerHTML = `Redirected from <strong>${escapeHtml(data.domain)}</strong> to <strong>${escapeHtml(data.url)}</strong>. Legitimate domain redirects are GDPR-compliant, and requests to the redirected domain are classified as first-party.`;
      } else {
        redirectContainer.classList.add('hidden');
      }
    }

    // Handle unresponsive HTTP (port 80) display
    const httpInfoContainer = document.getElementById('httpInfoContainer');
    const httpInfoText = document.getElementById('httpInfoText');
    if (httpInfoContainer && httpInfoText) {
      if (data.httpFailed) {
        httpInfoContainer.classList.remove('hidden');
        httpInfoText.innerHTML = `The server for <strong>${escapeHtml(data.domain)}</strong> is unresponsive on HTTP (port 80). The scanner successfully fell back to HTTPS (port 443) to perform the audit. Standard web practice is to keep port 80 open and return a permanent redirect (301) to HTTPS, ensuring all visitors are securely upgraded.`;
      } else {
        httpInfoContainer.classList.add('hidden');
      }
    }
    
    // Respect Basic Auth credentials if set
    const authUsername = authUsernameInput.value.trim();
    const authPassword = authPasswordInput.value.trim();
    if (authUsername && authPassword) {
      try {
        const urlObj = new URL(data.url);
        urlObj.username = encodeURIComponent(authUsername);
        urlObj.password = encodeURIComponent(authPassword);
        scannedUrlTextLink.href = urlObj.toString();
      } catch (e) {
        scannedUrlTextLink.href = data.url;
      }
    } else {
      scannedUrlTextLink.href = data.url;
    }
    
    scanTimeText.innerText = `Audited on ${new Date(data.timestamp).toLocaleString()}`;
    
    // 2. Compliance Status Banner
    const hasWarnings = data.warnings && data.warnings.length > 0;
     if (!data.compliant) {
      statusBadge.className = 'status-badge status-non-compliant';
      statusIcon.className = 'fa-solid fa-circle-xmark';
      statusText.innerText = 'NON-COMPLIANT';
      
      const reasons = [];
      if (data.summary.marketingCookies > 0) reasons.push('marketing cookies');
      if (data.summary.analyticsCookies > 0) reasons.push('analytics cookies');
      if (data.summary.trackingRequests > 0) reasons.push('ad trackers');
      const otherThirdPartyCount = data.connections.filter(r => r.isThirdParty && !r.isTracker).length;
      if (otherThirdPartyCount > 0) reasons.push('third-party hosts');
      
      statusExplanation.innerText = `GDPR risks detected: ${reasons.join(', ')}. Action required to secure compliance.`;
      complianceCard.className = 'glass-card compliance-status-card non-compliant-card';
    } else if (hasWarnings) {
      statusBadge.className = 'status-badge status-warning';
      statusIcon.className = 'fa-solid fa-circle-question';
      statusText.innerText = 'UNKNOWN';
      statusExplanation.innerText = 'Some items require manual audit. Verify unknown cookies/storage keys and secure cookie flags to confirm compliance.';
      complianceCard.className = 'glass-card compliance-status-card warning-card';
    } else {
      statusBadge.className = 'status-badge status-compliant';
      statusIcon.className = 'fa-solid fa-circle-check';
      statusText.innerText = 'COMPLIANT';
      statusExplanation.innerText = 'This website meets all audited GDPR & ePrivacy compliance standards.';
      complianceCard.className = 'glass-card compliance-status-card compliant-card';
    }
    
    // 3. Update Badge Totals
    cookieBadgeCount.innerText = data.summary.totalCookies + (data.summary.totalStorage || 0);
    connBadgeCount.innerText = data.summary.totalRequests;
    
    // 4. Setup Master-Detail Compliance Diagnostics
    setupDiagnosticsMasterDetail(data);
    
    // 5. Tables Reset and Populators
    activeCookieFilter = 'all';
    activeConnFilter = 'all';
    
    // Reset filters active state
    document.querySelectorAll('#cookieFilters .chip').forEach(c => c.classList.remove('active'));
    document.querySelector('#cookieFilters [data-filter="all"]').classList.add('active');
    
    document.querySelectorAll('#connFilters .chip').forEach(c => c.classList.remove('active'));
    document.querySelector('#connFilters [data-filter="all"]').classList.add('active');
    
    document.getElementById('cookieSearch').value = '';
    document.getElementById('connSearch').value = '';
    
    renderCookiesTable();
    renderConnectionsTable();

    // Reset main report tabs to show Compliance Overview by default
    tabButtons.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.add('hidden'));
    
    const overviewBtn = document.querySelector('.details-card > .tab-nav > .tab-btn[data-tab="overviewTab"]');
    const overviewContent = document.getElementById('overviewTab');
    if (overviewBtn) overviewBtn.classList.add('active');
    if (overviewContent) overviewContent.classList.remove('hidden');
  }

  function setupDiagnosticsMasterDetail(data) {
    if (!data.storage) data.storage = [];
    if (!data.iframes) data.iframes = [];

    const list = document.getElementById('diagnosticList');
    list.innerHTML = '';
    
    const chapters = [
      {
        id: 'ssl_tls',
        title: 'SSL/TLS Encryption',
        desc: 'Security audit of connection encryption, certificate validity, and TLS protocols.',
        articles: ['GDPR Art 32'],
        riskElaboration: 'GDPR Article 32 requires technical measures to ensure the security of data in transit. Operating without HTTPS, using an invalid/expired certificate, or utilizing outdated TLS protocol versions and weak ciphers exposes user communications (such as logins, cookies, and session identifiers) to interception, modification, and eavesdropping (man-in-the-middle attacks).',
        getItems: () => {
          const items = [];
          const sslViolations = (data.violations || []).filter(v => v.type.includes('SSL') || v.type.includes('Unencrypted Connection') || v.type.includes('TLS'));
          const sslWarnings = (data.warnings || []).filter(w => w.type.includes('SSL') || w.type.includes('Cipher'));
          
          sslViolations.forEach(v => {
            items.push({ name: v.type, details: v.message, isViolation: true });
          });
          sslWarnings.forEach(w => {
            items.push({ name: w.type, details: w.message, isViolation: false });
          });

          // Informational SSL details
          if (data.sslDetails && data.sslDetails.supported) {
            items.push({
              name: 'Negotiated Protocol',
              details: `${data.sslDetails.protocol || 'Unknown'} (Cipher: ${data.sslDetails.cipher || 'Unknown'})`,
              isViolation: false,
              isInfo: true,
              badgeText: 'Secure',
              badgeStatus: 'secure'
            });
            if (data.sslDetails.issuer) {
              items.push({
                name: 'Certificate Issuer',
                details: data.sslDetails.issuer,
                isViolation: false,
                isInfo: true,
                badgeText: 'Info',
                badgeStatus: 'info'
              });
            }
            if (data.sslDetails.daysToExpiration !== null) {
              items.push({
                name: 'Certificate Expiry',
                details: `Expires in ${data.sslDetails.daysToExpiration} days (on ${new Date(data.sslDetails.validTo * 1000).toLocaleDateString()})`,
                isViolation: false,
                isInfo: true,
                badgeText: 'Valid',
                badgeStatus: 'secure'
              });
            }
            items.push({
              name: 'Strict Transport Security (HSTS)',
              details: data.sslDetails.hstsEnabled ? 'Enabled' : 'Disabled',
              isViolation: false,
              isInfo: true,
              badgeText: data.sslDetails.hstsEnabled ? 'Active' : 'Off',
              badgeStatus: data.sslDetails.hstsEnabled ? 'secure' : 'off'
            });
          }
          return items;
        },
        getItemName: (item) => item.name,
        getItemDetails: (item) => item.details,
        getRecommendations: () => {
          const recs = [];
          if (!data.url.toLowerCase().startsWith('https://')) {
            recs.push('Install a valid SSL/TLS certificate and configure a global redirect from HTTP to HTTPS.');
          }
          if (data.sslDetails) {
            if (!data.sslDetails.authorized) {
              recs.push(`Resolve certificate issue: ${data.sslDetails.error || 'untrusted authority'}. Ensure the certificate matches the domain.`);
            }
            const protocol = data.sslDetails.protocol || '';
            if (protocol.includes('1.0') || protocol.includes('1.1') || protocol.toLowerCase().includes('ssl')) {
              recs.push('Disable legacy/deprecated protocols (TLS 1.0, TLS 1.1) in your server configurations and enforce TLS 1.2 or TLS 1.3.');
            }
            const cipher = data.sslDetails.cipher || '';
            if (cipher.includes('RC4') || cipher.includes('3DES') || cipher.includes('DES') || cipher.includes('MD5') || cipher.includes('NULL') || cipher.includes('EXPORT')) {
              recs.push('Disable legacy and weak ciphers (RC4, 3DES, DES, MD5, NULL) on your web server and configure modern secure cipher suites.');
            }
            if (!data.sslDetails.hstsEnabled && data.url.toLowerCase().startsWith('https://')) {
              recs.push('Consider upgrading your server configuration to enforce HTTP Strict Transport Security (HSTS) headers.');
            }
          }
          if (recs.length === 0) {
            recs.push('Maintain auto-renewal configuration for your SSL certificates to prevent unexpected expiration.');
          }
          return recs;
        }
      },
      {
        id: 'cookie_security',
        title: 'Cookie Security & Policy',
        desc: 'Insecure cookie attributes or cookies with unknown purposes set before consent.',
        articles: ['GDPR Art 25', 'ePrivacy Art 5(3)'],
        riskElaboration: 'Cookies without HttpOnly and Secure flags are highly vulnerable to XSS theft and interception over unencrypted networks. Furthermore, storing unclassified cookies on initial page load violates GDPR\'s Data Protection by Design principles, which require all active assets to be secure and verified.',
        getItems: () => data.cookies.filter(c => (c.securityIssues && c.securityIssues.length > 0) || c.category === 'Unknown'),
        getItemName: (c) => c.name,
        getItemDetails: (c) => {
          const warnings = [];
          if (c.category === 'Unknown') warnings.push('Unknown purpose');
          if (c.securityIssues && c.securityIssues.length > 0) warnings.push(...c.securityIssues);
          return `Domain: ${c.domain} | Warnings: ${warnings.join('; ')}`;
        },
        getRecommendations: () => [
          'Audit and classify all cookies set on page load. Block any non-essential cookies until the user explicitly consents.',
          'Configure session cookies with HttpOnly=true and Secure=true to protect against scripting and transmission vulnerabilities.',
          'Set SameSite to Lax or Strict to guard cookies against Cross-Site Request Forgery (CSRF).',
          'Help the community keep cookie definitions accurate: if you recognize an unclassified cookie, add it to our <a href="https://codeberg.org/nichu42/ClearLoad/src/branch/main/dictionaries" target="_blank" rel="noopener noreferrer" style="color: var(--accent-color); font-weight: 600;">Codeberg Repository</a>.'
        ]
      },
      {
        id: 'marketing_cookies',
        title: 'Marketing Cookies',
        desc: 'Cookies set for marketing and behavioral profiling on initial load.',
        articles: ['ePrivacy Art 5(3)', 'GDPR Art 6'],
        riskElaboration: 'Marketing and tracking cookies collect browsing habits to build behavioral profiles. Under the ePrivacy Directive and GDPR, setting these cookies on a visitor\'s device before acquiring their active, informed consent is a critical violation. Visitors must have a real choice before they are tracked.',
        getItems: () => data.cookies.filter(c => c.category === 'Marketing/Advertising'),
        getItemName: (c) => c.name,
        getItemDetails: (c) => `Domain: ${c.domain} | Expiry: ${c.session ? 'Session' : formatDate(c.expires)}`,
        getRecommendations: () => [
          'Block all marketing, conversion, and retargeting pixels (e.g. Meta Pixel, Google Ads, TikTok Pixel) from loading until the user explicitly consents via your cookie banner.',
          'Review Tag Manager triggers to ensure marketing tags are never fired on page load by default.'
        ]
      },
      {
        id: 'analytics_cookies',
        title: 'Analytics Cookies',
        desc: 'Cookies set for statistical measurement and page-view tracking on initial load.',
        articles: ['ePrivacy Art 5(3)'],
        riskElaboration: 'Analytics cookies measure visitor counts and site usage. While useful, they still track user behavior across sessions. Under ePrivacy rules, statistics cookies require active consent before placement. Setting them on initial load without user consent constitutes a major compliance violation.',
        getItems: () => data.cookies.filter(c => c.category === 'Analytics'),
        getItemName: (c) => c.name,
        getItemDetails: (c) => `Domain: ${c.domain} | Expiry: ${c.session ? 'Session' : formatDate(c.expires)}`,
        getRecommendations: () => [
          'Prevent analytics scripts (like Google Analytics, Hotjar, Clarity) from writing cookies on initial load.',
          'Delay script loading or run analytics in cookie-less / anonymous mode by default.'
        ]
      },
      {
        id: 'browser_storage',
        title: 'Browser Storage',
        desc: 'Client-side storage keys (LocalStorage/SessionStorage) written on initial load.',
        articles: ['ePrivacy Art 5(3)'],
        riskElaboration: 'Under the ePrivacy Directive (often called the Cookie Law), write or read access to client storage (like LocalStorage or SessionStorage) requires active, informed consent before execution—regardless of whether it is a traditional cookie. Using local storage keys to track user preferences or state without consent is a direct compliance loophole violation.',
        getItems: () => data.storage.filter(s => s.category !== 'Strictly Necessary'),
        getItemName: (s) => s.name,
        getItemDetails: (s) => `Type: ${s.storageType} | Domain: ${s.domain} | Value Preview: ${s.value}`,
        getRecommendations: () => [
          'Audit client-side storage keys and configure scripts to only write keys (e.g. user IDs, tracker state) after consent.',
          'Defer loading of analytics, tracking, or functional widgets that make use of LocalStorage and SessionStorage on initial load.'
        ]
      },
      {
        id: 'outbound_trackers',
        title: 'Outbound Trackers',
        desc: 'Network requests opened to third-party ad networks and trackers.',
        articles: ['GDPR Art 6', 'GDPR Art 44'],
        riskElaboration: 'Initiating connections to third-party ad networks (like Facebook Pixel or DoubleClick) before consent automatically transmits the visitor\'s IP address and browser metadata to third-party servers. GDPR rules strictly forbid this data transfer without a lawful processing basis or consent.',
        getItems: () => {
          const trackerRequests = data.connections.filter(r => r.isTracker);
          const uniqueHosts = [...new Set(trackerRequests.map(r => r.host))];
          return uniqueHosts.map(host => {
            const hostRequests = trackerRequests.filter(r => r.host === host);
            const types = [...new Set(hostRequests.map(r => r.resourceType.toUpperCase()))];
            return {
              host,
              count: hostRequests.length,
              types,
              sampleRequest: hostRequests[0],
              requests: hostRequests
            };
          });
        },
        getItemName: (item) => item.count > 1 ? `${item.host} (${item.count} requests)` : item.host,
        getItemDetails: (item) => {
          const typeLabel = item.types.length > 1 ? `Types: ${item.types.join(', ')}` : `Type: ${item.types[0]}`;
          return `${typeLabel} | Sample URL: ${item.sampleRequest.url}`;
        },
        getRecommendations: () => [
          'Prevent third-party tracking scripts from executing requests on initial page load.',
          'Review Google Tag Manager or hardcoded tracking tags and delay their trigger bindings.'
        ]
      },
      {
        id: 'third_party_hosts',
        title: 'Third-Party Connections',
        desc: 'Connections established to third-party domains on page load, leaking user IP addresses.',
        articles: ['GDPR Art 6'],
        riskElaboration: 'Every connection to an external host (like Google Fonts or external widgets) forces the visitor\'s browser to send their IP address and device headers to a third party. Under GDPR, this constitutes an unauthorized transfer of personal data (the IP address) without the user\'s prior consent.',
        getItems: () => {
          const generalThirdPartyRequests = data.connections.filter(r => r.isThirdParty && !r.isTracker);
          const uniqueHosts = [...new Set(generalThirdPartyRequests.map(r => r.host))];
          return uniqueHosts.map(host => {
            const hostRequests = generalThirdPartyRequests.filter(r => r.host === host);
            const types = [...new Set(hostRequests.map(r => r.resourceType.toUpperCase()))];
            return {
              host,
              count: hostRequests.length,
              types,
              sampleRequest: hostRequests[0],
              requests: hostRequests
            };
          });
        },
        getItemName: (item) => item.count > 1 ? `${item.host} (${item.count} requests)` : item.host,
        getItemDetails: (item) => {
          const typeLabel = item.types.length > 1 ? `Types: ${item.types.join(', ')}` : `Type: ${item.types[0]}`;
          return `${typeLabel} | Sample URL: ${item.sampleRequest.url}`;
        },
        getRecommendations: () => {
          const recs = [];
          if (data.detectedCMPs && data.detectedCMPs.length > 0) {
            const cmpNames = data.detectedCMPs.map(c => c.name).join(', ');
            recs.push(`<strong>Self-host or proxy your consent banner:</strong> You are loading banner assets from ${escapeHtml(cmpNames)}'s third-party domain. Download their script files, verify them, and host them directly on your server or configure a first-party proxy (e.g. <code>consent.yourdomain.com</code>).`);
          }
          recs.push('Self-host static resources (fonts, libraries, icons) directly on your own servers to prevent user IP address leakage.');
          recs.push('For third-party APIs and functional widgets (like translation tools or chatbots), defer loading their scripts and initializing connections until the user explicitly opts in.');
          recs.push('Help grow our database: identify trackers or CDNs in this list and submit classifications to our <a href="https://codeberg.org/nichu42/ClearLoad/src/branch/main/dictionaries" target="_blank" rel="noopener noreferrer" style="color: var(--accent-color); font-weight: 600;">Codeberg Repository</a>.');
          return recs;
        }
      },
      {
        id: 'embedded_widgets',
        title: 'Embedded Widgets & Iframes',
        desc: 'Third-party iframe embeds loaded on initial load.',
        articles: ['GDPR Art 6'],
        riskElaboration: 'Third-party iframes automatically load content from external services (like YouTube, Vimeo, or Google Maps). Doing so transmits the user\'s IP address and browser headers to these external hosts before any user action. Under GDPR, this constitutes an unauthorized data transfer that must be blocked until the user consents.',
        getItems: () => data.iframes.filter(i => i.isThirdParty),
        getItemName: (i) => i.type,
        getItemDetails: (i) => `Host: ${i.host} | Source: ${i.src || 'N/A'}`,
        getRecommendations: (items) => {
          const recs = [];
          const types = new Set((items || []).map(i => i.type));
          
          if (types.has('YouTube Video')) {
            recs.push('For YouTube embeds, use a privacy-compliant wrapper (such as a thumbnail placeholder that loads the video iframe only upon clicking) or load via the privacy-enhanced domain <code>youtube-nocookie.com</code> if tracking is disabled.');
          }
          if (types.has('Google Maps')) {
            recs.push('For Google Maps embeds, replace the interactive iframe with a static map image link, or delay loading the maps widget until explicit user opt-in.');
          }
          if (types.has('Vimeo Video')) {
            recs.push('For Vimeo embeds, set the <code>dnt=1</code> query parameter on the iframe source URL to block tracking, or defer loading until consent is captured.');
          }
          
          recs.push('Defer loading all third-party widget iframes until the user accepts cookie/marketing consent. Use placeholder cards with local thumbnail images to maintain page aesthetics before consent.');
          return recs;
        }
      }
    ];

    function resolveChapterStatus(ch, items) {
      let hasRed = false;
      let hasOrange = false;
      
      if (ch.id === 'ssl_tls') {
        items.forEach(item => {
          if (item.isViolation) hasRed = true;
          else if (!item.isInfo) hasOrange = true;
        });
      } else if (ch.id === 'cookie_security') {
        if (items.length > 0) hasOrange = true;
      } else if (ch.id === 'browser_storage') {
        items.forEach(s => {
          if (s.category === 'Marketing/Advertising' || s.category === 'Analytics') {
            hasRed = true;
          } else if (s.category === 'Unknown') {
            hasOrange = true;
          }
        });
      } else if (ch.id === 'marketing_cookies' || ch.id === 'analytics_cookies' || ch.id === 'outbound_trackers' || ch.id === 'third_party_hosts' || ch.id === 'embedded_widgets') {
        if (items.length > 0) hasRed = true;
      }
      
      if (hasRed) return 'fail';
      if (hasOrange) return 'warn';
      return 'pass';
    }

    const groups = [
      {
        name: 'Security & Encryption',
        icon: 'fa-shield-halved',
        iconColor: 'var(--info)',
        chapterIds: ['ssl_tls', 'cookie_security']
      },
      {
        name: 'Cookies & Local Storage',
        icon: 'fa-cookie-bite',
        iconColor: 'var(--warning)',
        chapterIds: ['marketing_cookies', 'analytics_cookies', 'browser_storage']
      },
      {
        name: 'External Connections',
        icon: 'fa-network-wired',
        iconColor: 'var(--error)',
        chapterIds: ['outbound_trackers', 'third_party_hosts', 'embedded_widgets']
      }
    ];

    const chapterMap = {};
    chapters.forEach(ch => {
      chapterMap[ch.id] = ch;
    });

    let firstActiveNode = null;
    
    groups.forEach(group => {
      const headerEl = document.createElement('div');
      headerEl.className = 'diag-group-header';
      headerEl.innerHTML = `<i class="fa-solid ${group.icon}" style="color: ${group.iconColor};"></i><span>${group.name}</span>`;
      list.appendChild(headerEl);

      group.chapterIds.forEach(id => {
        const ch = chapterMap[id];
        if (!ch) return;

        const items = ch.getItems();
        const count = items.filter(item => !item.isInfo).length;
        
        const itemEl = document.createElement('div');
        itemEl.className = 'diag-item';
        
        const status = resolveChapterStatus(ch, items);
        
        let iconClass = 'fa-circle-check pass';
        if (status === 'fail') {
          iconClass = 'fa-circle-xmark fail';
        } else if (status === 'warn') {
          iconClass = 'fa-circle-exclamation warn';
        }
        
        itemEl.innerHTML = `
          <div class="diag-item-left">
            <i class="fa-solid ${iconClass} diag-icon"></i>
            <div class="diag-details">
              <h4>${ch.title}</h4>
              <p>${ch.desc}</p>
            </div>
          </div>
          <div class="diag-counter ${status}">${count}</div>
        `;
        
        itemEl.addEventListener('click', () => {
          document.querySelectorAll('#diagnosticList .diag-item').forEach(el => el.classList.remove('active'));
          itemEl.classList.add('active');
          renderChapterDetail(ch, items, status);
        });
        
        list.appendChild(itemEl);
        
        // Select the first non-compliant chapter automatically, or fallback to the first one
        if (count > 0 && !firstActiveNode) {
          firstActiveNode = { node: itemEl, ch, items, status };
        }
      });
    });
    
    // Auto-click first item to show details
    if (firstActiveNode) {
      firstActiveNode.node.classList.add('active');
      renderChapterDetail(firstActiveNode.ch, firstActiveNode.items, firstActiveNode.status);
    } else {
      const firstDiagItem = list.querySelector('.diag-item');
      if (firstDiagItem) {
        firstDiagItem.click();
      }
    }
  }

  function renderChapterDetail(ch, items, status) {
    const detailPanel = document.getElementById('diagnosticDetail');
    detailPanel.innerHTML = '';
    
    const hasIssues = items.length > 0;
    
    let riskText = ch.riskElaboration;
    if (hasIssues) {
      if (ch.id === 'cookie_security') {
        const hasUnknown = items.some(c => c.category === 'Unknown');
        const hasInsecure = items.some(c => c.securityIssues && c.securityIssues.length > 0);
        if (hasUnknown && hasInsecure) {
          riskText = 'The auditor detected cookies with an unknown purpose along with insecure sensitive cookies. Because cookies do not contain self-describing metadata, the scanner cannot automatically verify if their use is legitimate. Website administrators must review and classify these cookies. Additionally, sensitive cookies lacking HttpOnly and Secure flags are highly vulnerable to XSS theft and interception.';
        } else if (hasUnknown) {
          riskText = 'The auditor detected cookies with an unknown purpose set on initial load. Because cookies do not store self-describing metadata, the scanner cannot automatically verify if their use is legitimate. Under GDPR (Article 25), it is the website administrator\'s responsibility to audit these cookies to ensure they are strictly necessary; otherwise, they must be blocked until consent is given.';
        } else if (hasInsecure) {
          riskText = 'Sensitive session cookies without HttpOnly and Secure flags are highly vulnerable to XSS theft and eavesdropping over unencrypted networks. Under GDPR Article 32, secure flag configurations are required to ensure data processing is safe.';
        }
      } else if (ch.id === 'browser_storage') {
        const hasTracking = items.some(s => s.category === 'Marketing/Advertising' || s.category === 'Analytics');
        const hasUnknown = items.some(s => s.category === 'Unknown');
        if (hasTracking && hasUnknown) {
          riskText = 'Under the ePrivacy Directive, client-side storage keys used for tracking or analytics require active user consent. The auditor also detected storage keys with unknown purposes. It is the website administrator\'s responsibility to verify if these unknown keys are strictly necessary, as the scanner cannot determine their legitimacy automatically.';
        } else if (hasTracking) {
          riskText = 'Using client-side storage (LocalStorage/SessionStorage) for tracking or analytics before consent violates ePrivacy rules. Active user opt-in is required before scripts write tracking identifiers to the visitor\'s browser.';
        } else if (hasUnknown) {
          riskText = 'The auditor detected storage keys with an unknown purpose in LocalStorage or SessionStorage. Because the scanner cannot determine if their use is legitimate, website administrators must review these keys to ensure they are strictly necessary and do not store tracking or preference data without consent.';
        }
      } else if (ch.id === 'third_party_hosts') {
        if (currentScanData && currentScanData.detectedCMPs && currentScanData.detectedCMPs.length > 0) {
          const cmpNames = currentScanData.detectedCMPs.map(c => c.name).join(', ');
          riskText = `Every connection to an external host (like Google Fonts or external widgets) forces the visitor's browser to send their IP address and device headers to a third party. Under GDPR, this constitutes an unauthorized transfer of personal data (the IP address) without the user's prior consent.<br><br><strong>Consent Banner IP Leak Paradox:</strong> We detected that this website loaded third-party consent banner script(s) from <strong>${escapeHtml(cmpNames)}</strong> before consent was given. Although a consent banner is legally required, fetching it from a third-party CDN leaks the visitor's IP address on load, which is itself a compliance violation. To fix this, you should self-host these banner assets or load them via a first-party reverse proxy.`;
        }
      }
    }
    
    let iconClass = 'fa-circle-check pass';
    if (status === 'fail') {
      iconClass = 'fa-circle-xmark fail';
    } else if (status === 'warn') {
      iconClass = 'fa-circle-exclamation warn';
    }
    
    const tagHTML = ch.articles.map(art => {
      const artClass = status === 'fail' ? 'critical' : (status === 'warn' ? 'high' : 'pass');
      const url = ARTICLE_URLS[art] || '#';
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="article-tag clickable-tag ${artClass}" title="Read official text for ${escapeHtml(art)}">${escapeHtml(art)} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.55rem; margin-left: 0.15rem;"></i></a>`;
    }).join(' ');

    const detailHeader = `
      <div class="detail-header-row">
        <div class="detail-title-area">
          <h4>${ch.title}</h4>
          <p>${ch.desc}</p>
          <div class="detail-articles">${tagHTML}</div>
        </div>
      </div>
    `;

    let bodyHTML = '';
    if (hasIssues) {
      function renderSingleItemBubble(ch, item) {
        const name = ch.getItemName(item);
        const details = ch.getItemDetails(item);
        
        let warnHTML = '';
        if (ch.id === 'cookie_security') {
          if (item.category === 'Unknown' && item.securityIssues && item.securityIssues.length > 0) {
            warnHTML = `<span class="sec-warn warn"><i class="fa-solid fa-triangle-exclamation"></i> Insecure &amp; Unknown</span>`;
          } else if (item.category === 'Unknown') {
            warnHTML = `<span class="sec-warn warn"><i class="fa-solid fa-circle-question"></i> Unknown</span>`;
          } else if (item.securityIssues && item.securityIssues.length > 0) {
            warnHTML = `<span class="sec-warn warn"><i class="fa-solid fa-triangle-exclamation"></i> Insecure Flag</span>`;
          }
        } else if (ch.id === 'browser_storage') {
          if (item.category === 'Marketing/Advertising' || item.category === 'Analytics') {
            warnHTML = `<span class="sec-warn font-bold fail"><i class="fa-solid fa-circle-xmark"></i> Non-Compliant</span>`;
          } else if (item.category === 'Unknown') {
            warnHTML = `<span class="sec-warn font-bold warn"><i class="fa-solid fa-circle-question"></i> Unknown</span>`;
          }
        } else if (ch.id === 'ssl_tls') {
          if (item.isViolation) {
            warnHTML = `<span class="sec-warn font-bold fail"><i class="fa-solid fa-circle-xmark"></i> Critical</span>`;
          } else if (item.isInfo) {
            if (item.badgeStatus === 'secure') {
              warnHTML = `<span class="sec-warn font-bold pass"><i class="fa-solid fa-circle-check"></i> ${item.badgeText}</span>`;
            } else if (item.badgeStatus === 'info') {
              warnHTML = `<span class="sec-warn font-bold info"><i class="fa-solid fa-circle-info"></i> ${item.badgeText}</span>`;
            } else {
              warnHTML = `<span class="sec-warn font-bold neutral"><i class="fa-solid fa-circle-minus"></i> ${item.badgeText}</span>`;
            }
          } else {
            warnHTML = `<span class="sec-warn font-bold warn"><i class="fa-solid fa-triangle-exclamation"></i> Warning</span>`;
          }
        } else if (ch.id === 'marketing_cookies' || ch.id === 'analytics_cookies' || ch.id === 'outbound_trackers' || ch.id === 'third_party_hosts' || ch.id === 'embedded_widgets') {
          warnHTML = `<span class="sec-warn font-bold fail"><i class="fa-solid fa-circle-xmark"></i> Non-Compliant</span>`;
        }

        let detailsHTML = '';
        let bubbleTitle = '';
        if (ch.id === 'outbound_trackers' || ch.id === 'third_party_hosts') {
          const typeSpans = item.types.map(t => {
            const exp = TYPE_EXPLANATIONS[t.toUpperCase()] || 'External connection request';
            return `<span class="type-tooltip" title="${escapeHtml(exp)}">${escapeHtml(t)}</span>`;
          });
          const typeLabel = item.types.length > 1 ? `Types: ${typeSpans.join(', ')}` : `Type: ${typeSpans[0]}`;
          
          let shortUrl = item.sampleRequest.url;
          if (shortUrl.length > 90) {
            shortUrl = shortUrl.substring(0, 87) + '...';
          }
          
          detailsHTML = `${typeLabel} | Sample URL: <span class="font-mono text-secondary">${escapeHtml(shortUrl)}</span>`;
          bubbleTitle = item.sampleRequest.url;
        } else {
          let rawDetails = details;
          if (rawDetails.length > 100) {
            rawDetails = rawDetails.substring(0, 97) + '...';
          }
          detailsHTML = escapeHtml(rawDetails);
          bubbleTitle = details;
        }

        let isExpandable = false;
        let incidentsHTML = '';
        if ((ch.id === 'outbound_trackers' || ch.id === 'third_party_hosts') && item.requests && item.requests.length > 0) {
          isExpandable = true;
          incidentsHTML = `
            <div class="incidents-list hidden">
              ${item.requests.map((req, idx) => {
                let reqUrl = req.url;
                return `
                  <div class="incident-row">
                    <div class="incident-info">
                      <span class="font-mono">
                        <span class="incident-number">[${idx + 1}]</span>
                        <a href="${escapeHtml(reqUrl)}" target="_blank" rel="noopener noreferrer" class="incident-url">${escapeHtml(reqUrl)}</a>
                      </span>
                    </div>
                    <div class="incident-meta">
                      <span class="font-mono incident-method">${escapeHtml(req.method)}</span>
                      <span class="type-tooltip incident-type-tag" title="${escapeHtml(TYPE_EXPLANATIONS[req.resourceType.toUpperCase()] || 'External connection request')}">${escapeHtml(req.resourceType)}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `;
        }

        if (isExpandable) {
          return `
            <div class="detail-item-bubble expandable" data-ch-id="${ch.id}" title="${escapeHtml(bubbleTitle)}">
              <div class="bubble-header">
                <div>
                  <strong>${escapeHtml(name)}</strong>
                  <div class="bubble-details">${detailsHTML}</div>
                </div>
                <div class="bubble-actions">
                  ${warnHTML}
                  <i class="fa-solid fa-chevron-right toggle-icon"></i>
                </div>
              </div>
              ${incidentsHTML}
            </div>
          `;
        } else {
          return `
            <div class="detail-item-bubble" title="${escapeHtml(bubbleTitle)}">
              <div>
                <strong>${escapeHtml(name)}</strong>
                <div class="bubble-details">${detailsHTML}</div>
              </div>
              ${warnHTML}
            </div>
          `;
        }
      }

      let itemsHTML = '';
      if (ch.id === 'browser_storage') {
        const nonCompliantItems = items.filter(s => s.category === 'Marketing/Advertising' || s.category === 'Analytics');
        const unknownItems = items.filter(s => s.category === 'Unknown');
        
        let storageHTML = '';
        if (nonCompliantItems.length > 0) {
          storageHTML += `<div class="findings-subheading fail"><i class="fa-solid fa-circle-xmark"></i> Non-Compliant Keys (Consent Required)</div>`;
          nonCompliantItems.forEach(item => {
            storageHTML += renderSingleItemBubble(ch, item);
          });
        }
        if (unknownItems.length > 0) {
          storageHTML += `<div class="findings-subheading warn"><i class="fa-solid fa-circle-question"></i> Unknown Keys (Needs Verification)</div>`;
          unknownItems.forEach(item => {
            storageHTML += renderSingleItemBubble(ch, item);
          });
        }
        itemsHTML = storageHTML;
      } else if (ch.id === 'cookie_security') {
        const unknownItems = items.filter(c => c.category === 'Unknown');
        const insecureItems = items.filter(c => c.securityIssues && c.securityIssues.length > 0 && c.category !== 'Unknown');
        
        let cookieHTML = '';
        if (unknownItems.length > 0) {
          cookieHTML += `<div class="findings-subheading warn"><i class="fa-solid fa-circle-question"></i> Unknown Cookies (Needs Verification)</div>`;
          unknownItems.forEach(item => {
            cookieHTML += renderSingleItemBubble(ch, item);
          });
        }
        if (insecureItems.length > 0) {
          cookieHTML += `<div class="findings-subheading warn"><i class="fa-solid fa-triangle-exclamation"></i> Insecure Cookie Flags (Warnings)</div>`;
          insecureItems.forEach(item => {
            cookieHTML += renderSingleItemBubble(ch, item);
          });
        }
        itemsHTML = cookieHTML;
      } else {
        items.forEach(item => {
          itemsHTML += renderSingleItemBubble(ch, item);
        });
      }

      let recsHTML = '';
      ch.getRecommendations(items).forEach(rec => {
        recsHTML += `
          <div class="rec-card-item">
            <i class="fa-solid fa-lightbulb"></i>
            <p>${rec}</p>
          </div>
        `;
      });

      let guideButtonHTML = '';
      if (ch.id === 'cookie_security' || ch.id === 'browser_storage') {
        guideButtonHTML = `
          <button id="openGuideModalBtn" class="secondary-btn guide-trigger-btn">
            <i class="fa-solid fa-circle-question"></i>
            Guide: What are Legitimate Cookies &amp; GDPR Rules?
          </button>
        `;
      }

      const issueCount = items.filter(item => !item.isInfo).length;
      const findingsTitle = ch.id === 'ssl_tls' && status === 'pass' 
        ? 'Connection Security Details' 
        : `Audit Findings (${issueCount} issue(s) detected)`;
      const titleIcon = ch.id === 'ssl_tls' && status === 'pass'
        ? 'fa-shield-halved'
        : 'fa-bug';

      let riskExplanationHTML = '';
      if (status !== 'pass') {
        const panelClass = status === 'fail' ? 'risk-explanation-panel fail' : 'risk-explanation-panel warn';
        riskExplanationHTML = `
          <div class="${panelClass}">
            <strong>
              <i class="fa-solid fa-triangle-exclamation"></i> ${status === 'fail' ? 'Why this is a violation:' : 'Why this is a security risk:'}
            </strong>
            <p>${riskText}</p>
          </div>
        `;
      }

      bodyHTML = `
        <div class="detail-body-section">
          <div>
            <div class="detail-findings-title">
              <i class="fa-solid ${titleIcon}"></i>
              <span>${findingsTitle}</span>
            </div>
            <div class="detail-items-container">
              ${itemsHTML}
            </div>
          </div>
          <div class="detail-recs-panel">
            ${riskExplanationHTML}
            ${guideButtonHTML}
            <h5>Remediation Guidelines</h5>
            <div class="rec-card-list">
              ${recsHTML}
            </div>
          </div>
        </div>
      `;
    } else {
      bodyHTML = `
        <div class="empty-detail-state" style="padding: 4rem 1rem;">
          <i class="fa-solid fa-circle-check" style="color: var(--success); font-size: 3rem;"></i>
          <h4 style="margin-top: 0.5rem; font-family: var(--font-display); font-weight: 700; color: var(--text-primary);">Fully Compliant</h4>
          <p>No issues detected! Your website meets all audited requirements in this category.</p>
        </div>
      `;
    }

    detailPanel.innerHTML = detailHeader + bodyHTML;

    // Bind expandable bubbles click events
    const expandableBubbles = detailPanel.querySelectorAll('.detail-item-bubble.expandable');
    expandableBubbles.forEach(bubble => {
      bubble.addEventListener('click', (e) => {
        // If clicking a link inside the bubble, don't toggle
        if (e.target.closest('a')) {
          return;
        }
        
        bubble.classList.toggle('expanded');
        const list = bubble.querySelector('.incidents-list');
        if (list) {
          list.classList.toggle('hidden');
        }
      });
    });

    // Bind guide modal trigger if present
    const openGuideBtn = document.getElementById('openGuideModalBtn');
    if (openGuideBtn) {
      openGuideBtn.addEventListener('click', () => {
        const guideModal = document.getElementById('guideModal');
        if (guideModal) {
          guideModal.classList.remove('hidden');
        }
      });
    }
  }

  // --- COOKIE TAB RENDERING & FILTERS ---
  const cookieSearch = document.getElementById('cookieSearch');
  const cookieFilters = document.getElementById('cookieFilters');
  
  cookieSearch.addEventListener('input', renderCookiesTable);
  cookieFilters.addEventListener('click', (e) => {
    if (!e.target.classList.contains('chip')) return;
    
    document.querySelectorAll('#cookieFilters .chip').forEach(c => c.classList.remove('active'));
    e.target.classList.add('active');
    activeCookieFilter = e.target.getAttribute('data-filter');
    renderCookiesTable();
  });

  function renderCookiesTable() {
    if (!currentScanData) return;
    const tbody = document.querySelector('#cookiesTable tbody');
    tbody.innerHTML = '';
    
    const searchVal = cookieSearch.value.toLowerCase().trim();
    
    const cookies = (currentScanData.cookies || []).map(c => ({ ...c, isCookie: true }));
    const storage = (currentScanData.storage || []).map(s => ({ ...s, isCookie: false }));
    let allItems = [...cookies, ...storage];
    
    // Apply Category Filter
    if (activeCookieFilter === 'insecure') {
      allItems = allItems.filter(c => c.isCookie && c.securityIssues && c.securityIssues.length > 0);
    } else if (activeCookieFilter !== 'all') {
      allItems = allItems.filter(c => c.category === activeCookieFilter);
    }
    
    // Apply Search Filter
    if (searchVal) {
      allItems = allItems.filter(c => 
        c.name.toLowerCase().includes(searchVal) || 
        c.domain.toLowerCase().includes(searchVal)
      );
    }
    
    const noCookiesMsg = document.getElementById('noCookiesMsg');
    if (allItems.length === 0) {
      noCookiesMsg.classList.remove('hidden');
      document.getElementById('cookiesTable').classList.add('hidden');
      return;
    }
    
    noCookiesMsg.classList.add('hidden');
    document.getElementById('cookiesTable').classList.remove('hidden');
    
    allItems.forEach(c => {
      const tr = document.createElement('tr');
      
      const catClass = c.category === 'Strictly Necessary' ? 'necessary' 
        : (c.category === 'Unknown' ? 'warning' : 'marketing');
      
      const storageClass = 'unclassified';
      const storageTypeLabel = c.isCookie ? 'Cookie' : (c.storageType === 'LocalStorage' ? 'LocalStorage' : 'SessionStorage');
      

      let expiresText = 'N/A';
      if (c.isCookie) {
        expiresText = c.session ? 'Session' : formatDate(c.expires);
      }
      
      const httpOnlyHTML = c.isCookie 
        ? `<i class="fa-solid ${c.httpOnly ? 'fa-circle-check active' : 'fa-circle-xmark inactive'} flag-icon"></i>` 
        : `<span style="color: var(--text-muted); font-size: 0.8rem;">—</span>`;
        
      const secureHTML = c.isCookie 
        ? `<i class="fa-solid ${c.secure ? 'fa-circle-check active' : 'fa-circle-xmark inactive'} flag-icon"></i>` 
        : `<span style="color: var(--text-muted); font-size: 0.8rem;">—</span>`;
        
      const sameSiteHTML = c.isCookie 
        ? `<span class="samesite-val">${c.sameSite}</span>` 
        : `<span style="color: var(--text-muted); font-size: 0.8rem;">—</span>`;
      
      tr.innerHTML = `
        <td class="font-bold" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</td>
        <td title="${escapeHtml(c.domain)}">${escapeHtml(c.domain)}</td>
        <td><span class="cat-badge ${storageClass}">${storageTypeLabel}</span></td>
        <td>
          <div class="cat-badge-container" style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span class="cat-badge ${catClass}">${c.category}</span>
            ${c.category === 'Unknown' ? `
              <a href="https://codeberg.org/nichu42/ClearLoad/src/branch/main/dictionaries" target="_blank" rel="noopener noreferrer" class="contrib-link" title="Help us classify this on Codeberg">
                <i class="fa-solid fa-code-fork"></i> Classify
              </a>
            ` : ''}
          </div>
        </td>
        <td class="center font-mono">${expiresText}</td>
        <td class="center">${httpOnlyHTML}</td>
        <td class="center">${secureHTML}</td>
        <td class="center">${sameSiteHTML}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // --- CONNECTIONS TAB RENDERING & FILTERS ---
  const connSearch = document.getElementById('connSearch');
  const connFilters = document.getElementById('connFilters');
  
  connSearch.addEventListener('input', renderConnectionsTable);
  connFilters.addEventListener('click', (e) => {
    if (!e.target.classList.contains('chip')) return;
    
    document.querySelectorAll('#connFilters .chip').forEach(c => c.classList.remove('active'));
    e.target.classList.add('active');
    activeConnFilter = e.target.getAttribute('data-filter');
    renderConnectionsTable();
  });

  function renderConnectionsTable() {
    if (!currentScanData) return;
    const tbody = document.querySelector('#connectionsTable tbody');
    tbody.innerHTML = '';
    
    const searchVal = connSearch.value.toLowerCase().trim();
    
    let filteredConns = currentScanData.connections;
    
    // Apply Category Filter
    if (activeConnFilter === 'tracker') {
      filteredConns = filteredConns.filter(r => r.isTracker);
    } else if (activeConnFilter === 'third-party') {
      filteredConns = filteredConns.filter(r => r.isThirdParty);
    } else if (activeConnFilter === 'first-party') {
      filteredConns = filteredConns.filter(r => !r.isThirdParty);
    }
    
    // Apply Search Filter
    if (searchVal) {
      filteredConns = filteredConns.filter(r => 
        r.host.toLowerCase().includes(searchVal) || 
        r.url.toLowerCase().includes(searchVal)
      );
    }
    
    const noConnsMsg = document.getElementById('noConnsMsg');
    if (filteredConns.length === 0) {
      noConnsMsg.classList.remove('hidden');
      document.getElementById('connectionsTable').classList.add('hidden');
      return;
    }
    
    noConnsMsg.classList.add('hidden');
    document.getElementById('connectionsTable').classList.remove('hidden');
    
    filteredConns.forEach(r => {
      const tr = document.createElement('tr');
      
      const badgeClass = r.isThirdParty ? 'marketing' : 'necessary';
        
      const cleanCategory = r.isTracker ? 'Third-Party Tracker' 
        : (r.isThirdParty ? 'Third-Party Connection' : 'First-Party');

      const isUnclassifiedThirdParty = r.isThirdParty && !r.isTracker;

      // Cut extremely long URLs for rendering
      let shortUrl = r.url;
      if (shortUrl.length > 90) {
        shortUrl = shortUrl.substring(0, 87) + '...';
      }
      
      tr.innerHTML = `
        <td class="font-bold">${escapeHtml(r.host)}</td>
        <td>
          <div class="cat-badge-container" style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span class="cat-badge ${badgeClass}">${cleanCategory}</span>
            ${isUnclassifiedThirdParty ? `
              <a href="https://codeberg.org/nichu42/ClearLoad/src/branch/main/dictionaries" target="_blank" rel="noopener noreferrer" class="contrib-link" title="Add this domain to our dictionaries on Codeberg">
                <i class="fa-solid fa-code-fork"></i> Contribute
              </a>
            ` : ''}
          </div>
        </td>
        <td class="font-mono" style="font-size: 0.8rem;" title="${escapeHtml(r.url)}">${escapeHtml(shortUrl)}</td>
        <td class="center font-bold" style="text-transform: uppercase; font-size: 0.75rem; cursor: help;" title="${escapeHtml(TYPE_EXPLANATIONS[r.resourceType.toUpperCase()] || 'External connection request')}">${escapeHtml(r.resourceType)}</td>
        <td class="center font-mono">${escapeHtml(r.method)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // --- UTIL HELPERS ---
  function formatDate(epoch) {
    if (!epoch || epoch === -1) return 'Session';
    try {
      const d = new Date(epoch * 1000);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return 'Expiry Unknown';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
  }

  // Check for URL query parameter on load and run scan immediately
  const urlParams = new URLSearchParams(window.location.search);
  const queryUrl = urlParams.get('url');
  
  const queryHdrName = urlParams.get('hdr_name');
  const queryHdrVal = urlParams.get('hdr_val');

  let showAdvanced = false;
  if (queryHdrName) {
    customHeaderNameInput.value = queryHdrName;
    showAdvanced = true;
  }
  if (queryHdrVal) {
    customHeaderValueInput.value = queryHdrVal;
    showAdvanced = true;
  }

  // Load API Key from sessionStorage
  const savedApiKey = sessionStorage.getItem('clearload_api_key') || '';
  if (savedApiKey) {
    apiKeyInput.value = savedApiKey;
    showAdvanced = true;
  }

  // Save API Key to sessionStorage on change
  apiKeyInput.addEventListener('input', () => {
    sessionStorage.setItem('clearload_api_key', apiKeyInput.value.trim());
  });

  if (showAdvanced) {
    advancedOptionsPanel.classList.remove('hidden');
  }

  if (queryUrl) {
    runAuditScan(queryUrl);
  }

  function parseMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    
    // Bold: **text** or __text__
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    
    // Italic: *text* or _text_
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
    
    // Standard link: [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
      let targetUrl = url.trim();
      if (targetUrl.startsWith('javascript:')) {
        targetUrl = '#';
      } else if (!/^https?:\/\//i.test(targetUrl) && !targetUrl.startsWith('/') && !targetUrl.startsWith('#')) {
        targetUrl = 'https://' + targetUrl;
      }
      // URL-encode so that spaces, ampersands, and other unsafe characters
      // never produce a structurally invalid href. Without this, some browsers
      // (notably stricter desktop engines) refuse to render the <a> tag entirely
      // when the href contains unencoded spaces or entities like &amp;.
      targetUrl = encodeURI(targetUrl);
      return `<a href="${targetUrl}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-color); text-decoration: none; font-weight: 500; transition: var(--transition-smooth);">${linkText}</a>`;
    });

    // Swapped link: (text)[url]
    html = html.replace(/\(([^)]+)\)\[([^\]]+)\]/g, (match, linkText, url) => {
      let targetUrl = url.trim();
      if (targetUrl.startsWith('javascript:')) {
        targetUrl = '#';
      } else if (!/^https?:\/\//i.test(targetUrl) && !targetUrl.startsWith('/') && !targetUrl.startsWith('#')) {
        targetUrl = 'https://' + targetUrl;
      }
      // URL-encode so that spaces, ampersands, and other unsafe characters
      // never produce a structurally invalid href. Without this, some browsers
      // (notably stricter desktop engines) refuse to render the <a> tag entirely
      // when the href contains unencoded spaces or entities like &amp;.
      targetUrl = encodeURI(targetUrl);
      return `<a href="${targetUrl}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-color); text-decoration: none; font-weight: 500; transition: var(--transition-smooth);">${linkText}</a>`;
    });
    
    // Convert newlines to <br>
    html = html.replace(/\r?\n/g, '<br>');
    
    return html;
  }

  // Load and display version from the backend status endpoint
  async function loadAppVersion() {
    try {
      const response = await fetch('/api/status');
      const data = await response.json();
      if (data && data.version) {
        const versionEl = document.getElementById('appVersion');
        if (versionEl) {
          versionEl.innerText = `v${data.version}`;
        }
        const creditsVersionEl = document.getElementById('creditsVersion');
        if (creditsVersionEl) {
          creditsVersionEl.innerText = `v${data.version}`;
        }
      }
      if (data && data.footerText !== undefined) {
        const footerCustomEl = document.getElementById('footerCustomText');
        if (footerCustomEl) {
          footerCustomEl.innerHTML = parseMarkdown(data.footerText);
        }
      }
      if (data && data.legalLink) {
        const link = document.getElementById('legalLink');
        const wrapper = document.getElementById('legalLinkWrapper');
        if (link && wrapper) {
          link.href = data.legalLink;
          wrapper.style.display = '';
        }
      }
    } catch (e) {
      console.warn('Failed to load application version from backend status endpoint.');
    }
  }

  loadAppVersion();

  // About & Credits Modal Behavior
  const creditsModal = document.getElementById('creditsModal');
  const openCreditsBtn = document.getElementById('openCreditsBtn');
  const closeCreditsModalBtn = document.getElementById('closeCreditsModalBtn');
  if (openCreditsBtn && creditsModal && closeCreditsModalBtn) {
    openCreditsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      creditsModal.classList.remove('hidden');
    });
    closeCreditsModalBtn.addEventListener('click', () => {
      creditsModal.classList.add('hidden');
    });
    creditsModal.addEventListener('click', (e) => {
      if (e.target === creditsModal) {
        creditsModal.classList.add('hidden');
      }
    });
  }

  // License Modal Behavior
  const licenseModal = document.getElementById('licenseModal');
  const openLicenseBtn = document.getElementById('openLicenseBtn');
  const creditsLicenseLink = document.getElementById('creditsLicenseDetailsLink');
  const closeLicenseModalBtn = document.getElementById('closeLicenseModalBtn');

  function openLicense(e) {
    e.preventDefault();
    if (creditsModal) creditsModal.classList.add('hidden'); // Close credits modal if open
    if (licenseModal) licenseModal.classList.remove('hidden');
  }

  if (licenseModal) {
    if (openLicenseBtn) openLicenseBtn.addEventListener('click', openLicense);
    if (creditsLicenseLink) creditsLicenseLink.addEventListener('click', openLicense);
    if (closeLicenseModalBtn) {
      closeLicenseModalBtn.addEventListener('click', () => {
        licenseModal.classList.add('hidden');
      });
    }
    licenseModal.addEventListener('click', (e) => {
      if (e.target === licenseModal) {
        licenseModal.classList.add('hidden');
      }
    });
  }

  // Disclaimer Modal Behavior
  const disclaimerModal = document.getElementById('disclaimerModal');
  const openDisclaimerBtn = document.getElementById('openDisclaimerBtn');
  const creditsDisclaimerLink = document.getElementById('creditsDisclaimerLink');
  const closeDisclaimerModalBtn = document.getElementById('closeDisclaimerModalBtn');

  function openDisclaimer(e) {
    e.preventDefault();
    if (creditsModal) creditsModal.classList.add('hidden'); // Close credits modal if open
    if (disclaimerModal) disclaimerModal.classList.remove('hidden');
  }

  if (disclaimerModal) {
    if (openDisclaimerBtn) openDisclaimerBtn.addEventListener('click', openDisclaimer);
    if (creditsDisclaimerLink) creditsDisclaimerLink.addEventListener('click', openDisclaimer);
    if (closeDisclaimerModalBtn) {
      closeDisclaimerModalBtn.addEventListener('click', () => {
        disclaimerModal.classList.add('hidden');
      });
    }
    disclaimerModal.addEventListener('click', (e) => {
      if (e.target === disclaimerModal) {
        disclaimerModal.classList.add('hidden');
      }
    });
  }

  // --- Dictionaries Modal Behavior & Data Logic ---
  const dictsModal = document.getElementById('dictsModal');
  const openDictsBtn = document.getElementById('openDictsBtn');
  const closeDictsModalBtn = document.getElementById('closeDictsModalBtn');
  
  let dictsCache = null;
  let activeDictTab = 'tracking';
  
  if (openDictsBtn && dictsModal && closeDictsModalBtn) {
    openDictsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      dictsModal.classList.remove('hidden');
      if (!dictsCache) {
        fetchDictionaries();
      } else {
        renderActiveDictionary();
      }
    });
    
    closeDictsModalBtn.addEventListener('click', () => {
      dictsModal.classList.add('hidden');
    });
    
    dictsModal.addEventListener('click', (e) => {
      if (e.target === dictsModal) {
        dictsModal.classList.add('hidden');
      }
    });
  }
  
  const dictSearchInput = document.getElementById('dictSearchInput');
  const dictTabNav = document.getElementById('dictTabNav');
  const dictRetryBtn = document.getElementById('dictRetryBtn');
  
  if (dictSearchInput) {
    dictSearchInput.addEventListener('input', () => {
      renderActiveDictionary();
    });
  }
  
  if (dictTabNav) {
    dictTabNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      
      document.querySelectorAll('#dictTabNav .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeDictTab = btn.getAttribute('data-dict-tab');
      renderActiveDictionary();
    });
  }
  
  if (dictRetryBtn) {
    dictRetryBtn.addEventListener('click', () => {
      fetchDictionaries();
    });
  }
  
  async function fetchDictionaries() {
    const loadingState = document.getElementById('dictLoadingState');
    const errorState = document.getElementById('dictErrorState');
    const dataContainer = document.getElementById('dictDataContainer');
    
    if (loadingState) loadingState.classList.remove('hidden');
    if (errorState) errorState.classList.add('hidden');
    if (dataContainer) dataContainer.classList.add('hidden');
    
    try {
      const res = await fetch('/api/dictionaries');
      const data = await res.json();
      
      if (data && data.success) {
        dictsCache = data;
        
        // Update Tab Counts
        const cmpCount = Object.keys(data.cmp_mapping || {}).length;
        const trackingCount = (data.tracking_patterns || []).length;
        const cdnCount = (data.public_cdns || []).length;
        const cookieCount = Object.keys(data.cookie_definitions || {}).length;
        const widgetCount = Object.keys(data.widget_mappings || {}).length;
        let heuristicsCount = 0;
        if (data.classification_rules) {
          Object.values(data.classification_rules).forEach(catRules => {
            Object.values(catRules).forEach(arr => {
              if (Array.isArray(arr)) {
                heuristicsCount += arr.length;
              }
            });
          });
        }
        
        const cmpCountEl = document.getElementById('dictCmpCount');
        const trackingCountEl = document.getElementById('dictTrackingCount');
        const cdnCountEl = document.getElementById('dictCdnCount');
        const cookieCountEl = document.getElementById('dictCookieCount');
        const widgetCountEl = document.getElementById('dictWidgetCount');
        const heuristicsCountEl = document.getElementById('dictHeuristicsCount');
        
        if (cmpCountEl) cmpCountEl.innerText = cmpCount;
        if (trackingCountEl) trackingCountEl.innerText = trackingCount;
        if (cdnCountEl) cdnCountEl.innerText = cdnCount;
        if (cookieCountEl) cookieCountEl.innerText = cookieCount;
        if (widgetCountEl) widgetCountEl.innerText = widgetCount;
        if (heuristicsCountEl) heuristicsCountEl.innerText = heuristicsCount;
        
        if (loadingState) loadingState.classList.add('hidden');
        if (dataContainer) dataContainer.classList.remove('hidden');
        
        renderActiveDictionary();
      } else {
        throw new Error(data.error || 'Invalid server response');
      }
    } catch (err) {
      console.error('Failed to load dictionaries:', err);
      if (loadingState) loadingState.classList.add('hidden');
      if (errorState) {
        errorState.classList.remove('hidden');
        const errorMsg = document.getElementById('dictErrorMessage');
        if (errorMsg) errorMsg.innerText = `Failed to load dictionaries: ${err.message}`;
      }
    }
  }
  
  function updateTabCounts(searchVal) {
    if (!dictsCache) return;
    
    let cmpMatchCount = 0;
    Object.entries(dictsCache.cmp_mapping || {}).forEach(([domain, name]) => {
      if (!searchVal || domain.toLowerCase().includes(searchVal) || name.toLowerCase().includes(searchVal)) {
        cmpMatchCount++;
      }
    });
    
    let trackingMatchCount = 0;
    (dictsCache.tracking_patterns || []).forEach(pattern => {
      if (!searchVal || pattern.toLowerCase().includes(searchVal)) {
        trackingMatchCount++;
      }
    });
    
    let cdnMatchCount = 0;
    (dictsCache.public_cdns || []).forEach(cdn => {
      if (!searchVal || cdn.toLowerCase().includes(searchVal)) {
        cdnMatchCount++;
      }
    });
 
    let cookieMatchCount = 0;
    Object.entries(dictsCache.cookie_definitions || {}).forEach(([cookie, info]) => {
      if (!searchVal || cookie.toLowerCase().includes(searchVal) || info.description.toLowerCase().includes(searchVal) || info.category.toLowerCase().includes(searchVal)) {
        cookieMatchCount++;
      }
    });
 
    let widgetMatchCount = 0;
    Object.entries(dictsCache.widget_mappings || {}).forEach(([pattern, info]) => {
      if (!searchVal || pattern.toLowerCase().includes(searchVal) || info.name.toLowerCase().includes(searchVal) || info.category.toLowerCase().includes(searchVal)) {
        widgetMatchCount++;
      }
    });

    let heuristicsMatchCount = 0;
    if (dictsCache.classification_rules) {
      Object.entries(dictsCache.classification_rules).forEach(([category, catRules]) => {
        Object.entries(catRules).forEach(([matchType, patterns]) => {
          if (Array.isArray(patterns)) {
            const matchTypeLabel = matchType === 'domains' ? 'Domain Match'
              : matchType === 'exact' ? 'Exact Match'
              : matchType === 'includes' ? 'Includes'
              : matchType === 'starts_with' ? 'Starts With'
              : matchType;
            patterns.forEach(pattern => {
              if (!searchVal || pattern.toLowerCase().includes(searchVal) || matchTypeLabel.toLowerCase().includes(searchVal) || category.toLowerCase().includes(searchVal)) {
                heuristicsMatchCount++;
              }
            });
          }
        });
      });
    }
    
    const cmpCountEl = document.getElementById('dictCmpCount');
    const trackingCountEl = document.getElementById('dictTrackingCount');
    const cdnCountEl = document.getElementById('dictCdnCount');
    const cookieCountEl = document.getElementById('dictCookieCount');
    const widgetCountEl = document.getElementById('dictWidgetCount');
    const heuristicsCountEl = document.getElementById('dictHeuristicsCount');
    
    if (cmpCountEl) cmpCountEl.innerText = cmpMatchCount;
    if (trackingCountEl) trackingCountEl.innerText = trackingMatchCount;
    if (cdnCountEl) cdnCountEl.innerText = cdnMatchCount;
    if (cookieCountEl) cookieCountEl.innerText = cookieMatchCount;
    if (widgetCountEl) widgetCountEl.innerText = widgetMatchCount;
    if (heuristicsCountEl) heuristicsCountEl.innerText = heuristicsMatchCount;
  }
  
  function renderActiveDictionary() {
    if (!dictsCache) return;
    
    const tableHeader = document.getElementById('dictTableHeader');
    const tableBody = document.getElementById('dictTableBody');
    const noResults = document.getElementById('dictNoResults');
    const tableEl = document.getElementById('dictTable');
    const searchInput = document.getElementById('dictSearchInput');
    const searchVal = searchInput ? searchInput.value.toLowerCase().trim() : '';
    
    // Update tab counts with search results
    updateTabCounts(searchVal);
    
    if (!tableHeader || !tableBody || !noResults || !tableEl) return;
    
    tableBody.innerHTML = '';
    
    let entries = [];
    let headersHTML = '';
    
    if (activeDictTab === 'cmp') {
      headersHTML = `
        <th>Domain</th>
        <th>Consent Management Platform (CMP)</th>
        <th class="center" style="width: 220px;">Classification</th>
      `;
      
      // Filter & Format
      Object.entries(dictsCache.cmp_mapping || {}).forEach(([domain, name]) => {
        if (!searchVal || domain.toLowerCase().includes(searchVal) || name.toLowerCase().includes(searchVal)) {
          entries.push({ key: domain, val: name, badge: 'badge-non-compliant', label: 'Consent CMP' });
        }
      });
    } else if (activeDictTab === 'tracking') {
      headersHTML = `
        <th>Tracker Hostname Pattern</th>
        <th class="center" style="width: 220px;">Classification</th>
      `;
      
      (dictsCache.tracking_patterns || []).forEach(pattern => {
        if (!searchVal || pattern.toLowerCase().includes(searchVal)) {
          entries.push({ key: pattern, badge: 'badge-non-compliant', label: 'Tracker / Marketing' });
        }
      });
    } else if (activeDictTab === 'cdn') {
      headersHTML = `
        <th>CDN Hostname Pattern</th>
        <th class="center" style="width: 220px;">Classification</th>
      `;
      
      (dictsCache.public_cdns || []).forEach(cdn => {
        if (!searchVal || cdn.toLowerCase().includes(searchVal)) {
          entries.push({ key: cdn, badge: 'badge-non-compliant', label: 'Public CDN / Assets' });
        }
      });
    } else if (activeDictTab === 'cookie') {
      headersHTML = `
        <th>Cookie / Storage Key</th>
        <th>Category</th>
        <th>Purpose / Description</th>
      `;
      
      Object.entries(dictsCache.cookie_definitions || {}).forEach(([cookie, info]) => {
        if (!searchVal || cookie.toLowerCase().includes(searchVal) || info.description.toLowerCase().includes(searchVal) || info.category.toLowerCase().includes(searchVal)) {
          const badgeClass = info.category === 'Strictly Necessary' ? 'badge-compliant' 
            : (info.category === 'Unknown' || info.category === 'Needs Verification' ? 'badge-warning' : 'badge-non-compliant');
          
          entries.push({ 
            key: cookie, 
            val: info.category, 
            desc: info.description, 
            badge: badgeClass, 
            label: info.category 
          });
        }
      });
    } else if (activeDictTab === 'widget') {
      headersHTML = `
        <th>Source Pattern</th>
        <th>Widget Provider</th>
        <th class="center" style="width: 220px;">Classification</th>
      `;
      
      Object.entries(dictsCache.widget_mappings || {}).forEach(([pattern, info]) => {
        if (!searchVal || pattern.toLowerCase().includes(searchVal) || info.name.toLowerCase().includes(searchVal) || info.category.toLowerCase().includes(searchVal)) {
          entries.push({ 
            key: pattern, 
            val: info.name, 
            badge: 'badge-non-compliant', 
            label: info.category 
          });
        }
      });
    } else if (activeDictTab === 'heuristics') {
      headersHTML = `
        <th>Pattern / Rule</th>
        <th>Match Type</th>
        <th class="center" style="width: 220px;">Target Classification</th>
      `;
      
      if (dictsCache.classification_rules) {
        Object.entries(dictsCache.classification_rules).forEach(([category, catRules]) => {
          Object.entries(catRules).forEach(([matchType, patterns]) => {
            if (Array.isArray(patterns)) {
              const matchTypeLabel = matchType === 'domains' ? 'Domain Match'
                : matchType === 'exact' ? 'Exact Match'
                : matchType === 'includes' ? 'Includes'
                : matchType === 'starts_with' ? 'Starts With'
                : matchType;
                
              patterns.forEach(pattern => {
                if (!searchVal || pattern.toLowerCase().includes(searchVal) || matchTypeLabel.toLowerCase().includes(searchVal) || category.toLowerCase().includes(searchVal)) {
                  const badgeClass = category === 'Strictly Necessary' ? 'badge-compliant'
                    : (category === 'Unknown' || category === 'Needs Verification' ? 'badge-warning' : 'badge-non-compliant');
                  
                  entries.push({
                    key: pattern,
                    matchType: matchTypeLabel,
                    badge: badgeClass,
                    label: category
                  });
                }
              });
            }
          });
        });
      }
    }
    
    tableHeader.innerHTML = headersHTML;
    
    if (entries.length === 0) {
      noResults.classList.remove('hidden');
      tableEl.classList.add('hidden');
      return;
    }
    
    noResults.classList.add('hidden');
    tableEl.classList.remove('hidden');
    
    // Sort entries alphabetically by domain/pattern key
    entries.sort((a, b) => a.key.localeCompare(b.key));
    
    entries.forEach(entry => {
      const tr = document.createElement('tr');
      if (activeDictTab === 'cmp') {
        tr.innerHTML = `
          <td class="font-bold">${escapeHtml(entry.key)}</td>
          <td>${escapeHtml(entry.val)}</td>
          <td class="center"><span class="${entry.badge}">${escapeHtml(entry.label)}</span></td>
        `;
      } else if (activeDictTab === 'cookie') {
        tr.innerHTML = `
          <td class="font-bold">${escapeHtml(entry.key)}</td>
          <td><span class="${entry.badge}">${escapeHtml(entry.label)}</span></td>
          <td style="max-width: 450px; word-break: break-word;">${escapeHtml(entry.desc)}</td>
        `;
      } else if (activeDictTab === 'widget') {
        tr.innerHTML = `
          <td class="font-bold">${escapeHtml(entry.key)}</td>
          <td>${escapeHtml(entry.val)}</td>
          <td class="center"><span class="${entry.badge}">${escapeHtml(entry.label)}</span></td>
        `;
      } else if (activeDictTab === 'heuristics') {
        tr.innerHTML = `
          <td class="font-bold">${escapeHtml(entry.key)}</td>
          <td>${escapeHtml(entry.matchType)}</td>
          <td class="center"><span class="${entry.badge}">${escapeHtml(entry.label)}</span></td>
        `;
      } else {
        tr.innerHTML = `
          <td class="font-bold">${escapeHtml(entry.key)}</td>
          <td class="center"><span class="${entry.badge}">${escapeHtml(entry.label)}</span></td>
        `;
      }
      tableBody.appendChild(tr);
    });
  }
});
