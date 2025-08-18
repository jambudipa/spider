/**
 * Playwright Adapter for Spider Integration
 * Provides high-level browser automation capabilities
 */

import { Page, Request, Response, Route } from 'playwright';
import { BrowserManager } from './BrowserManager';

export type RequestHandler = (request: Request) => void;
export type ResponseHandler = (response: Response) => void;

export interface WaitOptions {
  timeout?: number;
  state?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface ScrollOptions {
  delay?: number;
  maxScrolls?: number;
  scrollDistance?: number;
}

export class PlaywrightAdapter {
  private browserManager: BrowserManager;
  private page: Page | null = null;
  private contextId: string;
  private requestHandlers: RequestHandler[] = [];
  private responseHandlers: ResponseHandler[] = [];

  constructor(browserManager: BrowserManager, contextId: string) {
    this.browserManager = browserManager;
    this.contextId = contextId;
  }

  /**
   * Initialise the adapter with a new page
   */
  async initialise(): Promise<Page> {
    this.page = await this.browserManager.createPage(this.contextId);
    
    // Setup request/response interception
    this.page.on('request', request => {
      this.requestHandlers.forEach(handler => handler(request));
    });

    this.page.on('response', response => {
      this.responseHandlers.forEach(handler => handler(response));
    });

    return this.page;
  }

  /**
   * Get the current page instance
   */
  getPage(): Page {
    if (!this.page) {
      throw new Error('PlaywrightAdapter not initialised. Call initialise() first.');
    }
    return this.page;
  }

  /**
   * Navigate to a URL
   */
  async goto(url: string, options?: WaitOptions): Promise<Response | null> {
    const page = this.getPage();
    return await page.goto(url, {
      waitUntil: options?.state ?? 'networkidle',
      timeout: options?.timeout
    });
  }

  /**
   * Wait for dynamic content to load
   */
  async waitForDynamicContent(selector: string, options?: WaitOptions): Promise<void> {
    const page = this.getPage();
    await page.waitForSelector(selector, {
      state: 'visible',
      timeout: options?.timeout ?? 10000
    });
  }

  /**
   * Scroll to bottom progressively
   */
  async scrollToBottom(options?: ScrollOptions): Promise<void> {
    const page = this.getPage();
    const delay = options?.delay ?? 500;
    const maxScrolls = options?.maxScrolls ?? 50;
    const scrollDistance = options?.scrollDistance ?? 500;

    let previousHeight = 0;
    let currentHeight = await page.evaluate(() => document.body.scrollHeight);
    let scrollCount = 0;

    while (previousHeight !== currentHeight && scrollCount < maxScrolls) {
      previousHeight = currentHeight;
      
      await page.evaluate((distance) => {
        window.scrollBy(0, distance);
      }, scrollDistance);

      await page.waitForTimeout(delay);
      
      currentHeight = await page.evaluate(() => document.body.scrollHeight);
      scrollCount++;
    }

    // Final scroll to absolute bottom
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
  }

  /**
   * Click an element and wait for navigation or content
   */
  async clickAndWait(selector: string, waitFor?: string | WaitOptions): Promise<void> {
    const page = this.getPage();
    
    // Use force click to bypass event delegation issues
    const clickOptions = { force: true };
    
    if (typeof waitFor === 'string') {
      // Wait for specific selector after click
      await page.click(selector, clickOptions);
      await page.waitForSelector(waitFor, { state: 'visible' });
    } else {
      // Click and wait for network/DOM changes
      await page.click(selector, clickOptions);
      await page.waitForTimeout(1000); // Allow time for dynamic content
      
      // Wait for network idle if specified
      if (waitFor?.state === 'networkidle') {
        await page.waitForLoadState('networkidle', {
          timeout: waitFor?.timeout ?? 5000
        });
      }
    }
  }

  /**
   * Intercept requests
   */
  async interceptRequests(handler: RequestHandler): Promise<void> {
    this.requestHandlers.push(handler);
  }

  /**
   * Intercept responses
   */
  async interceptResponses(handler: ResponseHandler): Promise<void> {
    this.responseHandlers.push(handler);
  }

  /**
   * Route specific URLs
   */
  async route(pattern: string | RegExp, handler: (route: Route) => void): Promise<void> {
    const page = this.getPage();
    await page.route(pattern, handler);
  }

  /**
   * Execute JavaScript in page context
   */
  async evaluate<T>(fn: () => T): Promise<T> {
    const page = this.getPage();
    return await page.evaluate(fn);
  }

  /**
   * Take a screenshot
   */
  async screenshot(path: string): Promise<void> {
    const page = this.getPage();
    await page.screenshot({ path, fullPage: true });
  }

  /**
   * Get page content
   */
  async content(): Promise<string> {
    const page = this.getPage();
    return await page.content();
  }

  /**
   * Fill a form field
   */
  async fill(selector: string, value: string): Promise<void> {
    const page = this.getPage();
    await page.fill(selector, value);
  }

  /**
   * Select an option
   */
  async select(selector: string, value: string): Promise<void> {
    const page = this.getPage();
    await page.selectOption(selector, value);
  }

  /**
   * Check if element exists
   */
  async exists(selector: string): Promise<boolean> {
    const page = this.getPage();
    return await page.locator(selector).count() > 0;
  }

  /**
   * Wait for network idle
   */
  async waitForNetworkIdle(options?: WaitOptions): Promise<void> {
    const page = this.getPage();
    await page.waitForLoadState('networkidle', {
      timeout: options?.timeout
    });
  }

  /**
   * Handle new tabs/windows
   */
  async handleNewTab(callback: (newPage: Page) => Promise<void>): Promise<void> {
    const page = this.getPage();
    const context = page.context();

    const newPagePromise = context.waitForEvent('page');
    const newPage = await newPagePromise;
    
    await callback(newPage);
    await newPage.close();
  }

  /**
   * Get cookies
   */
  async getCookies(): Promise<any[]> {
    const page = this.getPage();
    return await page.context().cookies();
  }

  /**
   * Set cookies
   */
  async setCookies(cookies: any[]): Promise<void> {
    const page = this.getPage();
    await page.context().addCookies(cookies);
  }

  /**
   * Clear cookies
   */
  async clearCookies(): Promise<void> {
    const page = this.getPage();
    await page.context().clearCookies();
  }

  /**
   * Download file from URL
   */
  async downloadFile(url: string, filename?: string): Promise<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
  }> {
    const page = this.getPage();
    
    // Check if page is closed before proceeding
    if (page.isClosed()) {
      throw new Error('Page is already closed');
    }
    
    try {
      // Start waiting for download before navigating
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
      
      // If URL provided, navigate to it, otherwise expect it to be triggered
      if (url.startsWith('http')) {
        await page.goto(url, { timeout: 10000 });
      }
      
      const download = await downloadPromise;
      
      // Get download info
      const suggestedFilename = download.suggestedFilename();
      const finalFilename = filename || suggestedFilename;
      
      // Get the download as buffer
      const buffer = await download.createReadStream().then(stream => {
        return new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
      });
      
      return {
        buffer,
        filename: finalFilename,
        mimeType: 'application/octet-stream' // Default, could be detected
      };
    } catch (error) {
      // Handle page closure errors gracefully
      if (error instanceof Error && (
        error.message.includes('closed') ||
        error.message.includes('Target page') ||
        error.message.includes('browser has been closed')
      )) {
        throw new Error('Page was closed during download attempt');
      }
      throw error;
    }
  }

  /**
   * Trigger download by clicking element
   */
  async downloadFromClick(selector: string): Promise<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
  }> {
    const page = this.getPage();
    
    // Check if page is closed before proceeding
    if (page.isClosed()) {
      throw new Error('Page is already closed');
    }
    
    try {
      // Start waiting for download before clicking
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
      
      // Click the download trigger
      await page.click(selector);
      
      const download = await downloadPromise;
      
      // Get the download as buffer
      const buffer = await download.createReadStream().then(stream => {
        return new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
      });
      
      return {
        buffer,
        filename: download.suggestedFilename(),
        mimeType: 'application/octet-stream'
      };
    } catch (error) {
      // Handle page closure errors gracefully
      if (error instanceof Error && (
        error.message.includes('closed') ||
        error.message.includes('Target page') ||
        error.message.includes('browser has been closed')
      )) {
        throw new Error('Page was closed during download attempt');
      }
      throw error;
    }
  }

  /**
   * Close the page
   */
  async close(): Promise<void> {
    if (this.page) {
      try {
        if (!this.page.isClosed()) {
          await this.page.close();
        }
      } catch (error) {
        // Page may already be closed, ignore errors
        console.warn('Error closing page:', error);
      } finally {
        this.page = null;
      }
    }
  }
}