import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { chromium, Browser, Page } from 'playwright';
import * as cheerio from 'cheerio';

export interface ScrapedPage {
  url: string;
  title: string;
  content: string;
  links: string[];
  metadata: {
    scrapedAt: Date;
    contentLength: number;
    loadTimeMs: number;
  };
}

export interface ScanResult {
  url: string;
  title: string;
  status: number;
}

@Injectable()
export class ScraperService implements OnModuleDestroy {
  private readonly logger = new Logger(ScraperService.name);
  private browser: Browser | null = null;
  private browserPromise: Promise<Browser> | null = null;

  /**
   * Get or create a shared browser instance
   */
  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    // Prevent multiple browser launches
    if (this.browserPromise) {
      return this.browserPromise;
    }

    this.browserPromise = chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    this.browser = await this.browserPromise;
    this.browserPromise = null;

    this.logger.log('Browser instance launched');
    return this.browser;
  }

  /**
   * Clean up browser on module destroy
   */
  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close();
      this.logger.log('Browser instance closed');
    }
  }

  /**
   * Scrape a single URL and extract clean text content
   */
  /**
   * Scrape a single URL with "Fast Path" first, then Playwright fallback
   */
  async scrapeUrl(url: string): Promise<ScrapedPage> {
    // 1. Try Fast Path first (Raw HTTP)
    try {
      this.logger.debug(`Attempting fast scrape: ${url}`);
      const fastResult = await this.fastScrapeUrl(url);

      // If we got significant content, return it
      // A threshold of 1000 chars is usually safe for "real" content vs "Enable JS" placeholders
      if (fastResult.content.length > 1000) {
        this.logger.debug(`Fast scrape successful for ${url}`);
        return fastResult;
      }
      this.logger.debug(
        `Fast scrape returned low content (${fastResult.content.length} chars) for ${url}, falling back to Playwright`,
      );
    } catch (error) {
      this.logger.debug(`Fast scrape failed for ${url}: ${error.message}`);
      // If it's a 404, we skip entirely and don't try Playwright
      if (error.message.includes('status: 404')) {
        this.logger.warn(`Skipping 404 URL: ${url}`);
        throw error;
      }
    }

    // 2. Playwright fallback
    return this.scrapeWithPlaywright(url);
  }

  /**
   * Scrape a single URL and return all internal links found on it (Shallow scan)
   * Returns objects with url and title (discovered from link text)
   */
  async discoverLinks(url: string): Promise<{ url: string; title: string }[]> {
    try {
      this.logger.debug(`Discovering links on: ${url}`);
      // Use raw fetch for speed since we only need links
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      const baseUrlObj = new URL(url);
      const discovered: Map<string, string> = new Map();

      // Basic normalization and filtering
      $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().replace(/\s+/g, ' ').trim();
        if (!href) return;
        try {
          const fullUrl = new URL(href, url);
          if (fullUrl.origin !== baseUrlObj.origin) return;
          if (fullUrl.hash && fullUrl.pathname === baseUrlObj.pathname) return;
          if (
            /\.(jpg|jpeg|png|gif|pdf|css|js|zip|exe|dmg|svg|ico)$/i.test(
              fullUrl.pathname,
            )
          )
            return;
          if (fullUrl.protocol !== 'http:' && fullUrl.protocol !== 'https:')
            return;

          fullUrl.hash = '';
          const normalizedUrl = fullUrl.toString().replace(/\/$/, '');

          // Prefer better titles if we find the same URL twice
          const existingTitle = discovered.get(normalizedUrl);
          if (
            !existingTitle ||
            (text &&
              text.length >
                (existingTitle === 'Untitled' ? 0 : existingTitle.length))
          ) {
            discovered.set(normalizedUrl, text || 'Untitled');
          }
        } catch {}
      });

      // Add the original URL as well if it's not there
      const originalNormalized = url.replace(/\/$/, '');
      if (
        !discovered.has(originalNormalized) ||
        discovered.get(originalNormalized) === 'Untitled'
      ) {
        const pageTitle = $('title').text().trim() || 'Home';
        discovered.set(originalNormalized, pageTitle);
      }

      return Array.from(discovered.entries()).map(([url, title]) => ({
        url,
        title,
      }));
    } catch (error) {
      this.logger.error(`Failed to discover links on ${url}: ${error.message}`);
      // Fallback to playwright if fetch fails (could be a SPA)
      try {
        this.logger.debug(`Falling back to Playwright for discovery: ${url}`);
        const scraped = await this.scrapeWithPlaywright(url);
        const results = scraped.links.map((link) => ({
          url: link,
          title: 'Untitled', // Playwright fallback primarily returns URLs
        }));

        // Add the main page
        if (!scraped.links.includes(url.replace(/\/$/, ''))) {
          results.push({ url: url.replace(/\/$/, ''), title: scraped.title });
        }
        return results;
      } catch (pwError) {
        this.logger.error(
          `Playwright fallback also failed for discovery: ${pwError.message}`,
        );
        throw pwError;
      }
    }
  }

  /**
   * Fast Path: Scrape using raw HTTP and Cheerio
   */
  private async fastScrapeUrl(url: string): Promise<ScrapedPage> {
    const startTime = Date.now();
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(15000), // 15s timeout for fast path
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove unwanted elements
    $(
      'script, style, noscript, iframe, nav, footer, header, aside, .cookie-banner, .ad, .ads',
    ).remove();

    const title = $('title').text() || 'Untitled';
    const content = $('body')
      .text()
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    const baseUrlObj = new URL(url);
    const links: Set<string> = new Set();

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;
      try {
        const fullUrl = new URL(href, url);
        if (fullUrl.origin !== baseUrlObj.origin) return;
        if (fullUrl.hash && fullUrl.pathname === baseUrlObj.pathname) return;
        if (
          /\.(jpg|jpeg|png|gif|pdf|css|js|zip|exe|dmg)$/i.test(fullUrl.pathname)
        )
          return;
        if (fullUrl.protocol !== 'http:' && fullUrl.protocol !== 'https:')
          return;

        fullUrl.hash = '';
        const normalizedUrl = fullUrl.toString().replace(/\/$/, '');
        links.add(normalizedUrl);
      } catch {}
    });

    const loadTimeMs = Date.now() - startTime;

    return {
      url,
      title,
      content,
      links: Array.from(links),
      metadata: {
        scrapedAt: new Date(),
        contentLength: content.length,
        loadTimeMs,
      },
    };
  }

  /**
   * Optimized Playwright scraping with resource blocking
   */
  private async scrapeWithPlaywright(url: string): Promise<ScrapedPage> {
    const startTime = Date.now();
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    // Speed up: Block media and unnecessary resources
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    try {
      this.logger.debug(`Scraping with Playwright: ${url}`);

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await this.waitForContent(page);

      const title = await page.title();
      const content = await this.extractContent(page);
      const links = await this.extractLinks(page, url);

      const loadTimeMs = Date.now() - startTime;

      this.logger.debug(
        `Scraped (Playwright) ${url}: ${content.length} chars in ${loadTimeMs}ms`,
      );

      return {
        url,
        title: title || 'Untitled',
        content,
        links,
        metadata: {
          scrapedAt: new Date(),
          contentLength: content.length,
          loadTimeMs,
        },
      };
    } catch (error) {
      this.logger.warn(
        `Failed to scrape ${url} with Playwright: ${error.message}`,
      );
      // Instead of throwing, return a "failed" ScrapedPage structure if needed,
      // or re-throw if the caller expects to catch it.
      // Given scanWebsite catches it, we can keep throwing but with clearer context.
      throw error;
    } finally {
      await context.close();
    }
  }

  /**
   * Wait for main content elements to appear
   */
  private async waitForContent(page: Page): Promise<void> {
    try {
      // Wait for common content selectors
      await Promise.race([
        page.waitForSelector('main', { timeout: 5000 }),
        page.waitForSelector('article', { timeout: 5000 }),
        page.waitForSelector('.content', { timeout: 5000 }),
        page.waitForSelector('#content', { timeout: 5000 }),
        page.waitForSelector('[role="main"]', { timeout: 5000 }),
        new Promise((resolve) => setTimeout(resolve, 3000)), // Fallback timeout
      ]);
    } catch {
      // Content selectors not found, continue anyway
    }
  }

  /**
   * Extract clean text content from the page
   */
  private async extractContent(page: Page): Promise<string> {
    const content = await page.evaluate(() => {
      // Clone body to avoid modifying the page
      const clone = document.body.cloneNode(true) as HTMLElement;

      // Remove unwanted elements
      const selectorsToRemove = [
        'script',
        'style',
        'noscript',
        'iframe',
        'nav',
        'footer',
        'header',
        'aside',
        '.nav',
        '.navigation',
        '.menu',
        '.sidebar',
        '.footer',
        '.header',
        '.cookie-banner',
        '.cookie-consent',
        '.advertisement',
        '.ad',
        '.ads',
        '.social-share',
        '.comments',
        '[role="navigation"]',
        '[role="banner"]',
        '[role="contentinfo"]',
        '[aria-hidden="true"]',
      ];

      selectorsToRemove.forEach((selector) => {
        clone.querySelectorAll(selector).forEach((el) => el.remove());
      });

      // Get text content
      let text = clone.innerText || clone.textContent || '';

      // Clean up whitespace
      text = text
        .replace(/\s+/g, ' ') // Multiple spaces to single
        .replace(/\n\s*\n/g, '\n\n') // Multiple newlines to double
        .trim();

      return text;
    });

    return content;
  }

  /**
   * Extract all internal links from the page
   */
  private async extractLinks(page: Page, baseUrl: string): Promise<string[]> {
    const html = await page.content();
    const $ = cheerio.load(html);
    const baseUrlObj = new URL(baseUrl);
    const links: Set<string> = new Set();

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;

      try {
        // Resolve relative URLs
        const fullUrl = new URL(href, baseUrl);

        // Only include internal links (same origin)
        if (fullUrl.origin !== baseUrlObj.origin) return;

        // Skip anchors, files, and special URLs
        if (fullUrl.hash && fullUrl.pathname === baseUrlObj.pathname) return;
        if (
          /\.(jpg|jpeg|png|gif|pdf|css|js|zip|exe|dmg)$/i.test(fullUrl.pathname)
        )
          return;
        if (fullUrl.protocol !== 'http:' && fullUrl.protocol !== 'https:')
          return;

        // Normalize URL (remove trailing slash, fragment)
        fullUrl.hash = '';
        const normalizedUrl = fullUrl.toString().replace(/\/$/, '');

        links.add(normalizedUrl);
      } catch {
        // Invalid URL, skip
      }
    });

    return Array.from(links);
  }

  /**
   * Scan a website and discover all pages with parallel crawling
   */
  async scanWebsite(
    startUrl: string,
    maxPages: number = 20,
    concurrency: number = 5,
  ): Promise<ScanResult[]> {
    const visited = new Set<string>();
    const results: ScanResult[] = [];
    const queue: string[] = [];

    // Normalize start URL
    let initialUrl = startUrl;
    if (!startUrl.startsWith('http://') && !startUrl.startsWith('https://')) {
      initialUrl = 'https://' + startUrl;
    }
    queue.push(initialUrl);

    const baseUrlObj = new URL(initialUrl);
    this.logger.log(`Starting parallel website scan: ${initialUrl}`);

    // Create fixed number of workers that process the queue
    const workers: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(
        (async () => {
          while (queue.length > 0 && results.length < maxPages) {
            const url = queue.shift();
            if (!url) break;

            const normalizedUrl = url.replace(/\/$/, '');
            // We mark as visited before scraping to avoid duplicate queueing
            if (visited.has(normalizedUrl)) continue;
            visited.add(normalizedUrl);

            try {
              const scraped = await this.scrapeUrl(url);

              if (results.length < maxPages) {
                results.push({
                  url,
                  title: scraped.title,
                  status: 200,
                });

                // Add discovered links to queue
                for (const link of scraped.links) {
                  const normalizedLink = link.replace(/\/$/, '');
                  if (!visited.has(normalizedLink) && !queue.includes(link)) {
                    try {
                      const linkUrl = new URL(link);
                      if (linkUrl.origin === baseUrlObj.origin) {
                        queue.push(link);
                      }
                    } catch {}
                  }
                }
              }
            } catch (error) {
              this.logger.warn(`Failed to scan ${url}: ${error.message}`);
              results.push({ url, title: 'Error', status: 500 });
            }
          }
        })(),
      );
    }

    await Promise.all(workers);

    this.logger.log(
      `Website scan complete: ${results.length} pages discovered`,
    );

    return results;
  }

  /**
   * Scrape multiple URLs in parallel with concurrency limit
   */
  async scrapeUrls(
    urls: string[],
    concurrency: number = 3,
  ): Promise<ScrapedPage[]> {
    const results: ScrapedPage[] = [];
    const queue = [...urls];

    const worker = async () => {
      while (queue.length > 0) {
        const url = queue.shift();
        if (!url) break;

        try {
          const scraped = await this.scrapeUrl(url);
          results.push(scraped);
        } catch (error) {
          this.logger.error(`Failed to scrape ${url}: ${error.message}`);
        }

        // Rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    };

    // Run workers in parallel
    const workers = Array(Math.min(concurrency, urls.length))
      .fill(null)
      .map(() => worker());

    await Promise.all(workers);

    return results;
  }
}
