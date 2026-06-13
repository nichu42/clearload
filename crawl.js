import { chromium } from 'playwright';
import { runAuditWithBrowser } from './audit.js';
import { RobotsTxt } from './lib/robots-parser.js';
import zlib from 'zlib';
import { promisify } from 'util';

const gunzip = promisify(zlib.gunzip);


function safeCloseBrowser(browser) {
  if (!browser) return Promise.resolve();
  return Promise.race([
    browser.close(),
    new Promise(resolve => setTimeout(resolve, 5000))
  ]).catch(() => {});
}

export function deriveScope(urlStr) {
  const url = new URL(urlStr);
  const hostname = url.hostname.toLowerCase();
  
  let wwwEquivalent = null;
  if (hostname.startsWith('www.')) {
    wwwEquivalent = hostname.substring(4);
  } else {
    wwwEquivalent = 'www.' + hostname;
  }

  let basePath = '/';
  const pathname = url.pathname;
  if (pathname.endsWith('/')) {
    basePath = pathname;
  } else {
    const parts = pathname.split('/');
    parts.pop();
    basePath = parts.join('/');
    if (!basePath.endsWith('/')) {
      basePath += '/';
    }
  }

  return {
    domain: hostname,
    basePath,
    wwwEquivalent
  };
}

export function normalizeUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    url.hash = '';
    url.search = '';
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    return `${url.protocol}//${url.host.toLowerCase()}${pathname}`;
  } catch (e) {
    return urlStr;
  }
}

export function isInScope(urlStr, scope) {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    
    const hostMatch = host === scope.domain.toLowerCase() || 
                      (scope.wwwEquivalent && host === scope.wwwEquivalent.toLowerCase());
    if (!hostMatch) return false;

    // Check path prefix
    const pathWithTrailing = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
    const normalizedBasePath = scope.basePath.endsWith('/') ? scope.basePath : scope.basePath + '/';
    if (!pathWithTrailing.startsWith(normalizedBasePath.toLowerCase())) {
      return false;
    }

    const excludedExtensions = new Set([
      'pdf', 'zip', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'css', 'js',
      'woff', 'woff2', 'ttf', 'eot', 'xml', 'json', 'mp3', 'mp4',
      'avi', 'mov', 'ics', 'ical', 'xlsx', 'xls', 'docx', 'doc', 'pptx',
      'ppt', 'txt', 'csv', 'rtf', 'webp', 'ico', 'rar', '7z', 'tar',
      'gz', 'exe', 'dmg', 'pkg', 'msi', 'odt', 'ods', 'odp', 'odg',
      'odf'
    ]);
    const lastSegment = url.pathname.split('/').pop();
    const ext = lastSegment.includes('.') ? lastSegment.split('.').pop().toLowerCase() : '';
    if (excludedExtensions.has(ext)) {
      return false;
    }

    return true;
  } catch (e) {
    return false;
  }
}

export function isHostAllowedForCrawl(host, scope) {
  if (!host || !scope.domain) return false;
  const h = host.toLowerCase();

  let baseDomain = scope.domain.toLowerCase();
  if (baseDomain.startsWith('www.')) {
    baseDomain = baseDomain.substring(4);
  }

  if (h === baseDomain || h.endsWith('.' + baseDomain)) {
    return true;
  }

  if (scope.wwwEquivalent) {
    let wwwBase = scope.wwwEquivalent.toLowerCase();
    if (wwwBase.startsWith('www.')) {
      wwwBase = wwwBase.substring(4);
    }
    if (h === wwwBase || h.endsWith('.' + wwwBase)) {
      return true;
    }
  }

  return false;
}

async function discoverViaSitemap(origin, scope, maxPages, robotsText = '', robotsTxtInstance = null) {
  const sitemapUrlsToFetch = new Set();
  const urlMetadataMap = new Map();
  let sitemapUrlUsed = null;
  let totalSitemapsFetched = 0;

  function addPageUrl(pageUrl, priority, lastmodTime) {
    if (isInScope(pageUrl, scope)) {
      const norm = normalizeUrl(pageUrl);
      if (robotsTxtInstance) {
        try {
          const parsed = new URL(norm);
          if (!robotsTxtInstance.isAllowed(parsed.pathname + parsed.search, 'clearload')) {
            return;
          }
        } catch (e) {
          return;
        }
      }

      const existing = urlMetadataMap.get(norm);
      if (!existing) {
        urlMetadataMap.set(norm, { priority, lastmodTime });
      } else {
        if (priority > existing.priority) {
          existing.priority = priority;
        }
        if (lastmodTime > existing.lastmodTime) {
          existing.lastmodTime = lastmodTime;
        }
      }
    }
  }

  if (robotsText) {
    const lines = robotsText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.toLowerCase().startsWith('sitemap:')) {
        const sUrl = trimmed.substring(8).trim();
        if (sUrl) sitemapUrlsToFetch.add(sUrl);
      }
    }
  } else {
    try {
      const robotsRes = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(10000) });
      if (robotsRes.ok) {
        const txt = await robotsRes.text();
        const lines = txt.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.toLowerCase().startsWith('sitemap:')) {
            const sUrl = trimmed.substring(8).trim();
            if (sUrl) sitemapUrlsToFetch.add(sUrl);
          }
        }
      }
    } catch (e) {
      // Ignore robots.txt errors
    }
  }

  if (sitemapUrlsToFetch.size === 0) {
    sitemapUrlsToFetch.add(`${origin}/sitemap.xml`);
  }

  const sitemapQueue = Array.from(sitemapUrlsToFetch).map(url => ({ url, depth: 0 }));

  while (sitemapQueue.length > 0 && totalSitemapsFetched < 10) {
    const { url, depth } = sitemapQueue.shift();
    if (depth > 5) continue;

    try {
      totalSitemapsFetched++;
      if (!sitemapUrlUsed) {
        sitemapUrlUsed = url;
      }
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;

      const reader = res.body.getReader();
      let totalBytes = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.length;
        if (totalBytes > 5 * 1024 * 1024) {
          throw new Error('Sitemap exceeds 5MB limit');
        }
        chunks.push(value);
      }
      
      const buffer = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }

      let xml;
      // Check for gzip magic bytes (0x1f, 0x8b) to robustly detect gzip payloads
      const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
      if (isGzip) {
        let decompressed;
        try {
          decompressed = await gunzip(buffer, { maxOutputLength: 5 * 1024 * 1024 });
        } catch (gzipErr) {
          if (gzipErr.code === 'ERR_BUFFER_TOO_LARGE' || gzipErr.code === 'Z_BUF_ERROR') {
            throw new Error('Decompressed sitemap exceeds 5MB limit');
          }
          throw gzipErr;
        }
        xml = new TextDecoder('utf-8').decode(decompressed);
      } else {
        xml = new TextDecoder('utf-8').decode(buffer);
      }

      const isSitemapIndex = /<sitemapindex/i.test(xml);

      if (isSitemapIndex) {
        const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
        let match;
        const extractedLocs = [];
        while ((match = locRegex.exec(xml)) !== null) {
          extractedLocs.push(match[1].trim());
        }
        for (const childUrl of extractedLocs) {
          sitemapQueue.push({ url: childUrl, depth: depth + 1 });
        }
      } else {
        const urlBlockRegex = /<url>([\s\S]*?)<\/url>/gi;
        let blockMatch;
        let parsedAnyUrls = false;

        while ((blockMatch = urlBlockRegex.exec(xml)) !== null) {
          const blockContent = blockMatch[1];
          const locMatch = /<loc>([\s\S]*?)<\/loc>/i.exec(blockContent);
          if (!locMatch) continue;
          const pageUrl = locMatch[1].trim();

          const priorityMatch = /<priority>([\s\S]*?)<\/priority>/i.exec(blockContent);
          let priority = 0.5;
          if (priorityMatch) {
            const parsedPriority = parseFloat(priorityMatch[1].trim());
            if (!isNaN(parsedPriority)) {
              priority = parsedPriority;
            }
          }

          const lastmodMatch = /<lastmod>([\s\S]*?)<\/lastmod>/i.exec(blockContent);
          let lastmodTime = 0;
          if (lastmodMatch) {
            const dateStr = lastmodMatch[1].trim();
            const parsedTime = Date.parse(dateStr);
            if (!isNaN(parsedTime)) {
              lastmodTime = parsedTime;
            }
          }

          parsedAnyUrls = true;
          addPageUrl(pageUrl, priority, lastmodTime);
        }

        if (!parsedAnyUrls) {
          const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
          let match;
          while ((match = locRegex.exec(xml)) !== null) {
            addPageUrl(match[1].trim(), 0.5, 0);
          }
        }
      }
    } catch (e) {
      // Ignore errors for individual sitemaps
    }
  }

  const urlsWithMetadata = Array.from(urlMetadataMap.entries()).map(([url, meta]) => ({
    url,
    priority: meta.priority,
    lastmodTime: meta.lastmodTime
  }));

  // Sort by priority (DESC), then lastmodTime (DESC)
  urlsWithMetadata.sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return b.lastmodTime - a.lastmodTime;
  });

  const urls = urlsWithMetadata.map(item => item.url);
  if (urls.length > 0) {
    return {
      found: true,
      sitemapUrl: sitemapUrlUsed,
      urls: urls.slice(0, maxPages),
      totalFound: urls.length,
      inScope: urls.length
    };
  }

  return { found: false };
}

export async function runCrawl(rootUrl, options = {}, progressCallback = () => {}) {
  const startTime = Date.now();
  let origin;
  try {
    origin = new URL(rootUrl).origin;
  } catch (e) {
    return {
      success: false,
      type: 'crawl',
      category: 'invalid_url',
      error: 'The provided URL could not be parsed by the crawl engine.'
    };
  }

  const scope = deriveScope(rootUrl);
  const queue = [];
  const enqueued = new Set();
  const scanned = new Set();
  const scanResults = [];
  let duplicateCount = 0;
  let externalRedirectCount = 0;
  let discoveryMethodUsed = 'crawl';
  let sitemapUrl = null;
  let sitemapTotalFound = 0;

  const respectRobotsTxt = options.respectRobotsTxt === true;
  let robotsTxtInstance = null;
  let robotsText = '';

  try {
    const robotsRes = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(10000) });
    if (robotsRes.ok) {
      robotsText = await robotsRes.text();
      robotsTxtInstance = new RobotsTxt(robotsText);
    }
  } catch (e) {
    // Ignore robots.txt errors
  }

  if (respectRobotsTxt && robotsTxtInstance) {
    try {
      const rootParsed = new URL(rootUrl);
      const rootPathToCheck = rootParsed.pathname + rootParsed.search;
      if (!robotsTxtInstance.isAllowed(rootPathToCheck, 'clearload')) {
        const errResult = {
          success: false,
          type: 'crawl',
          category: 'robots_disallowed',
          error: `The root URL is disallowed by the website's robots.txt policy.`
        };
        progressCallback({ event: 'crawl_failed', data: errResult });
        return errResult;
      }
    } catch (e) {
      // Ignore URL parsing errors
    }
  }

  // Emit crawl started
  progressCallback({ event: 'crawl_started', data: { rootUrl } });

  // Discovery phase
  const discoveryMethod = options.discoveryMethod || 'auto';
  if (discoveryMethod === 'auto' || discoveryMethod === 'sitemap') {
    const sitemapResult = await discoverViaSitemap(origin, scope, options.maxPages || 25, robotsText, respectRobotsTxt ? robotsTxtInstance : null);
    if (sitemapResult.found) {
      discoveryMethodUsed = 'sitemap';
      sitemapUrl = sitemapResult.sitemapUrl;
      sitemapTotalFound = sitemapResult.totalFound;

      progressCallback({
        event: 'discovery_method',
        data: {
          method: 'sitemap',
          sitemapUrl: sitemapResult.sitemapUrl,
          totalFound: sitemapResult.totalFound
        }
      });

      for (const url of sitemapResult.urls) {
        const norm = normalizeUrl(url);
        if (respectRobotsTxt && robotsTxtInstance) {
          try {
            const parsed = new URL(norm);
            if (!robotsTxtInstance.isAllowed(parsed.pathname + parsed.search, 'clearload')) {
              continue;
            }
          } catch (e) {
            continue;
          }
        }
        if (!enqueued.has(norm) && isInScope(norm, scope)) {
          queue.push({ url: norm, depth: 0 });
          enqueued.add(norm);
          progressCallback({ event: 'page_discovered', data: { url: norm, depth: 0 } });
        }
      }
    } else {
      if (discoveryMethod === 'sitemap') {
        const errResult = {
          success: false,
          type: 'crawl',
          category: 'no_sitemap',
          error: `No sitemap.xml found at ${origin}. Try using Auto-detect or Follow Links mode instead.`
        };
        progressCallback({ event: 'crawl_failed', data: errResult });
        return errResult;
      }
    }
  }

  if (discoveryMethodUsed === 'crawl') {
    progressCallback({
      event: 'discovery_method',
      data: {
        method: 'crawl'
      }
    });

    const rootNorm = normalizeUrl(rootUrl);
    queue.push({ url: rootNorm, depth: 0 });
    enqueued.add(rootNorm);
    progressCallback({ event: 'page_discovered', data: { url: rootNorm, depth: 0 } });
  }

  let browser;
  let cachedTlsResult = null;
  let cachedHttpFailed = false;
  let abortListener = null;

  try {
    if (options.signal) {
      abortListener = () => {
        if (browser) {
          safeCloseBrowser(browser);
        }
      };
      options.signal.addEventListener('abort', abortListener);
    }
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security'
      ]
    });

    if (options.signal?.aborted) {
      if (browser) {
        await safeCloseBrowser(browser);
      }
      throw new Error('Canceled');
    }

    const pageLimit = options.maxPages || 25;
    const concurrency = options.concurrency || 2;
    const maxDepth = options.maxDepth || 2;
    const isCrawlMode = (discoveryMethodUsed === 'crawl');

    // First page scan: Always scan rootUrl first to derive final scope & cache TLS
    const initialRootNorm = normalizeUrl(rootUrl);
    let rootQueueIndex = queue.findIndex(item => normalizeUrl(item.url) === initialRootNorm);
    let rootDepth = 0;
    if (rootQueueIndex !== -1) {
      rootDepth = queue[rootQueueIndex].depth;
      queue.splice(rootQueueIndex, 1);
    }
    enqueued.add(initialRootNorm);

    progressCallback({ event: 'page_scan_started', data: { url: rootUrl, depth: rootDepth } });

    let firstPageResult;
    try {
      firstPageResult = await runAuditWithBrowser(browser, rootUrl, {
        extractLinks: isCrawlMode && (rootDepth < maxDepth),
        crawlScope: scope,
        isRootPage: true,
        authUsername: options.authUsername,
        authPassword: options.authPassword,
        customHeaderName: options.customHeaderName,
        customHeaderValue: options.customHeaderValue
      });
    } catch (err) {
      firstPageResult = { success: false, url: rootUrl, error: err.message || 'Navigation failed' };
    }

    if (options.signal?.aborted) {
      throw new Error('Canceled');
    }

    if (firstPageResult.success) {
      const finalUrlParsed = new URL(firstPageResult.url);
      const finalHost = finalUrlParsed.hostname.toLowerCase();
      
      scope.domain = finalHost;
      if (finalHost.startsWith('www.')) {
        scope.wwwEquivalent = finalHost.substring(4);
      } else {
        scope.wwwEquivalent = 'www.' + finalHost;
      }
      
      const finalScope = deriveScope(firstPageResult.url);
      scope.basePath = finalScope.basePath;

      cachedTlsResult = firstPageResult.sslDetails;
      cachedHttpFailed = firstPageResult.httpFailed;

      const finalResolvedUrl = normalizeUrl(firstPageResult.url);
      scanned.add(finalResolvedUrl);
      enqueued.add(finalResolvedUrl);

      progressCallback({
        event: 'page_scan_completed',
        data: {
          url: rootUrl,
          resolvedUrl: finalResolvedUrl,
          depth: rootDepth,
          result: firstPageResult
        }
      });
      
      scanResults.push({
        url: rootUrl,
        resolvedUrl: finalResolvedUrl,
        depth: rootDepth,
        status: 'completed',
        redirected: normalizeUrl(rootUrl) !== finalResolvedUrl,
        result: firstPageResult
      });

      // Extract links if we're in link crawling mode
      if (firstPageResult.discoveredLinks && isCrawlMode && (rootDepth < maxDepth)) {
        for (const link of firstPageResult.discoveredLinks) {
          const normLink = normalizeUrl(link);
          if (respectRobotsTxt && robotsTxtInstance) {
            try {
              const parsed = new URL(normLink);
              if (!robotsTxtInstance.isAllowed(parsed.pathname + parsed.search, 'clearload')) {
                continue;
              }
            } catch (e) {
              continue;
            }
          }
          if (!enqueued.has(normLink) && isInScope(normLink, scope)) {
            queue.push({ url: normLink, depth: rootDepth + 1 });
            enqueued.add(normLink);
            progressCallback({ event: 'page_discovered', data: { url: normLink, depth: rootDepth + 1 } });
          }
        }
      }
    } else {
      progressCallback({
        event: 'page_scan_failed',
        data: {
          url: initialRootNorm,
          depth: rootDepth,
          error: firstPageResult.error
        }
      });

      scanResults.push({
        url: initialRootNorm,
        depth: rootDepth,
        status: 'failed',
        error: firstPageResult.error
      });
    }

    // Remaining pages BFS scan
    while (queue.length > 0 && scanResults.length < pageLimit) {
      if (options.signal?.aborted) {
        throw new Error('Canceled');
      }

      const batch = [];
      while (batch.length < concurrency && queue.length > 0 && (scanResults.length + batch.length) < pageLimit) {
        const nextItem = queue.shift();
        const norm = normalizeUrl(nextItem.url);
        if (scanned.has(norm)) {
          duplicateCount++;
          progressCallback({
            event: 'page_scan_completed',
            data: {
              url: nextItem.url,
              resolvedUrl: norm,
              depth: nextItem.depth,
              result: { success: true, duplicate: true }
            }
          });
          continue;
        }
        batch.push(nextItem);
      }

      if (batch.length === 0) continue;

      const promises = batch.map(async (entry) => {
        progressCallback({ event: 'page_scan_started', data: { url: entry.url, depth: entry.depth } });

        try {
          const result = await runAuditWithBrowser(browser, entry.url, {
            extractLinks: isCrawlMode && (entry.depth < maxDepth),
            crawlScope: scope,
            cachedTlsResult,
            skipHttpFallback: true,
            cachedHttpFailed,
            authUsername: options.authUsername,
            authPassword: options.authPassword,
            customHeaderName: options.customHeaderName,
            customHeaderValue: options.customHeaderValue
          });

          if (options.signal?.aborted) {
            throw new Error('Canceled');
          }

          if (result.success) {
            const finalResolvedUrl = normalizeUrl(result.url);

            let finalHost = '';
            try {
              finalHost = new URL(finalResolvedUrl).hostname;
            } catch (e) {}

            if (!isHostAllowedForCrawl(finalHost, scope)) {
              externalRedirectCount++;
              progressCallback({
                event: 'page_scan_completed',
                data: {
                  url: entry.url,
                  resolvedUrl: finalResolvedUrl,
                  depth: entry.depth,
                  result: { ...result, externalRedirect: true }
                }
              });
              return { status: 'external_redirect' };
            }

            if (scanned.has(finalResolvedUrl)) {
              duplicateCount++;
              progressCallback({
                event: 'page_scan_completed',
                data: {
                  url: entry.url,
                  resolvedUrl: finalResolvedUrl,
                  depth: entry.depth,
                  result: { ...result, duplicate: true }
                }
              });
              return { status: 'duplicate' };
            }
            scanned.add(finalResolvedUrl);
            enqueued.add(finalResolvedUrl);

            progressCallback({
              event: 'page_scan_completed',
              data: {
                url: entry.url,
                resolvedUrl: finalResolvedUrl,
                depth: entry.depth,
                result
              }
            });

            if (result.discoveredLinks && isCrawlMode && (entry.depth < maxDepth)) {
              for (const link of result.discoveredLinks) {
                const normLink = normalizeUrl(link);
                if (respectRobotsTxt && robotsTxtInstance) {
                  try {
                    const parsed = new URL(normLink);
                    if (!robotsTxtInstance.isAllowed(parsed.pathname + parsed.search, 'clearload')) {
                      continue;
                    }
                  } catch (e) {
                    continue;
                  }
                }
                if (!enqueued.has(normLink) && isInScope(normLink, scope)) {
                  queue.push({ url: normLink, depth: entry.depth + 1 });
                  enqueued.add(normLink);
                  progressCallback({ event: 'page_discovered', data: { url: normLink, depth: entry.depth + 1 } });
                }
              }
            }

            return {
              url: entry.url,
              resolvedUrl: finalResolvedUrl,
              depth: entry.depth,
              status: 'completed',
              redirected: normalizeUrl(entry.url) !== finalResolvedUrl,
              result
            };
          } else {
            progressCallback({
              event: 'page_scan_failed',
              data: {
                url: entry.url,
                depth: entry.depth,
                error: result.error
              }
            });

            return {
              url: entry.url,
              depth: entry.depth,
              status: 'failed',
              error: result.error
            };
          }
        } catch (err) {
          progressCallback({
            event: 'page_scan_failed',
            data: {
              url: entry.url,
              depth: entry.depth,
              error: err.message
            }
          });

          return {
            url: entry.url,
            depth: entry.depth,
            status: 'failed',
            error: err.message
          };
        }
      });

      const batchResults = await Promise.all(promises);
      const validResults = batchResults.filter(r => r && r.status !== 'duplicate' && r.status !== 'external_redirect');
      scanResults.push(...validResults);
    }

  } finally {
    if (options.signal && abortListener) {
      options.signal.removeEventListener('abort', abortListener);
    }
    if (browser) {
      await safeCloseBrowser(browser);
    }
  }

  // Aggregate results
  const totalPages = scanResults.length;
  const completedPages = scanResults.filter(r => r.status === 'completed').length;
  const failedPages = scanResults.filter(r => r.status === 'failed').length;
  const compliantPages = scanResults.filter(r => r.status === 'completed' && r.result?.compliant).length;
  const nonCompliantPages = completedPages - compliantPages;
  const unprocessedCount = queue.length;
  const detectedPages = totalPages + duplicateCount + externalRedirectCount + unprocessedCount;

  let totalCookies = 0;
  let totalThirdPartyRequests = 0;
  let totalTrackers = 0;

  const violationGroups = {};

  for (const pageScan of scanResults) {
    if (pageScan.status !== 'completed' || !pageScan.result) continue;
    const res = pageScan.result;
    
    totalCookies += res.summary?.totalCookies || 0;
    totalThirdPartyRequests += res.summary?.thirdPartyRequests || 0;
    totalTrackers += res.summary?.trackingRequests || 0;

    if (res.violations) {
      for (const v of res.violations) {
        const type = v.type;
        if (!violationGroups[type]) {
          violationGroups[type] = {
            type,
            message: v.message,
            pageCount: 0,
            pages: [],
            gdprArticles: v.gdprArticles || []
          };
        }
        violationGroups[type].pageCount++;
        violationGroups[type].pages.push(pageScan.url);
      }
    }
  }

  const topViolations = Object.values(violationGroups).sort((a, b) => b.pageCount - a.pageCount);
  const compliant = completedPages > 0 && nonCompliantPages === 0;

  const finalCrawlResult = {
    success: true,
    type: 'crawl',
    rootUrl,
    scope: { domain: scope.domain, basePath: scope.basePath },
    discovery: {
      method: discoveryMethodUsed,
      sitemapUrl,
      totalFound: sitemapTotalFound,
      inScope: sitemapTotalFound
    },
    settings: {
      discoveryMethod: options.discoveryMethod || 'auto',
      maxDepth: options.maxDepth || 2,
      maxPages: options.maxPages || 25,
      concurrency: options.concurrency || 2,
      respectRobotsTxt
    },
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    aggregate: {
      totalPages,
      detectedPages,
      completedPages,
      failedPages,
      compliantPages,
      nonCompliantPages,
      duplicateCount,
      externalRedirectCount,
      unprocessedCount,
      totalCookies,
      totalThirdPartyRequests,
      totalTrackers,
      topViolations,
      compliant
    },
    pages: scanResults
  };

  progressCallback({ event: 'crawl_completed', data: finalCrawlResult });
  return finalCrawlResult;
}
