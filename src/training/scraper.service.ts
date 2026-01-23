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
  async scrapeUrl(url: string): Promise<ScrapedPage> {
    const startTime = Date.now();
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    try {
      this.logger.debug(`Scraping: ${url}`);

      // Navigate with timeout and wait for network to settle
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Wait for main content to load
      await this.waitForContent(page);

      // Get page title
      const title = await page.title();

      // Extract clean text content
      const content = await this.extractContent(page);

      // Extract all links for crawling
      const links = await this.extractLinks(page, url);

      const loadTimeMs = Date.now() - startTime;

      this.logger.debug(
        `Scraped ${url}: ${content.length} chars in ${loadTimeMs}ms`,
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
      this.logger.error(`Failed to scrape ${url}: ${error.message}`);
      throw new Error(`Failed to scrape ${url}: ${error.message}`);
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
   * Scan a website and discover all pages (with crawling)
   */
  async scanWebsite(
    startUrl: string,
    maxPages: number = 50,
  ): Promise<ScanResult[]> {
    const visited = new Set<string>();
    const results: ScanResult[] = [];
    const queue: string[] = [startUrl];

    // Normalize start URL
    if (!startUrl.startsWith('http://') && !startUrl.startsWith('https://')) {
      queue[0] = 'https://' + startUrl;
    }

    const baseUrlObj = new URL(queue[0]);

    this.logger.log(`Starting website scan: ${queue[0]}`);

    while (queue.length > 0 && results.length < maxPages) {
      const url = queue.shift()!;

      // Skip if already visited
      const normalizedUrl = url.replace(/\/$/, '');
      if (visited.has(normalizedUrl)) continue;
      visited.add(normalizedUrl);

      try {
        const scraped = await this.scrapeUrl(url);

        results.push({
          url,
          title: scraped.title,
          status: 200,
        });

        // Add discovered links to queue
        for (const link of scraped.links) {
          const normalizedLink = link.replace(/\/$/, '');
          if (!visited.has(normalizedLink) && !queue.includes(link)) {
            // Only add links from the same domain
            try {
              const linkUrl = new URL(link);
              if (linkUrl.origin === baseUrlObj.origin) {
                queue.push(link);
              }
            } catch {
              // Invalid URL, skip
            }
          }
        }

        // Rate limiting - 1 second between requests
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        this.logger.warn(`Failed to scan ${url}: ${error.message}`);
        results.push({
          url,
          title: 'Error',
          status: 500,
        });
      }
    }

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
