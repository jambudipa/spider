/**
 * Test Helper Utilities
 * Common operations for web-scraping.dev scenarios
 */

import { Page } from 'playwright';
import * as cheerio from 'cheerio';
import { BrowserManager } from '../../browser/BrowserManager';
import { PlaywrightAdapter } from '../../browser/PlaywrightAdapter';

export interface ExtractedData {
  [key: string]: any;
}

export interface TestContext {
  browserManager: BrowserManager;
  adapter: PlaywrightAdapter;
  baseUrl: string;
  screenshotDir?: string;
}

export class TestHelper {
  private static BASE_URL = 'https://web-scraping.dev';
  
  /**
   * Create a test context with browser setup
   */
  static async createTestContext(scenarioName: string): Promise<TestContext> {
    const { Effect } = await import('effect');
    
    const browserManager = new BrowserManager({
      headless: process.env.CI === 'true' || process.env.HEADLESS === 'true',
      timeout: 30000,
      poolSize: 1
    });
    
    await browserManager.initialise();
    const adapter = new PlaywrightAdapter(browserManager, scenarioName);
    
    // Handle Effect-based initialisation
    const initResult = await Effect.runPromise(adapter.initialise());
    
    return {
      browserManager,
      adapter,
      baseUrl: this.BASE_URL,
      screenshotDir: `screenshots/${scenarioName}`
    };
  }
  
  /**
   * Clean up test context
   */
  static async cleanupTestContext(context: TestContext): Promise<void> {
    try {
      await context.adapter.close();
    } catch (error) {
      console.warn('Error closing adapter:', error);
    }
    
    try {
      await context.browserManager.close();
    } catch (error) {
      console.warn('Error closing browser manager:', error);
    }
  }
  
  /**
   * Take screenshot on failure
   */
  static async captureFailureScreenshot(
    page: Page, 
    testName: string, 
    error?: Error
  ): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `failure-${testName}-${timestamp}.png`;
    const path = `screenshots/${filename}`;
    
    try {
      await page.screenshot({ 
        path, 
        fullPage: true 
      });
      console.error(`Screenshot saved: ${path}`);
      if (error) {
        console.error(`Error: ${error.message}`);
      }
      return path;
    } catch (screenshotError) {
      console.error('Failed to capture screenshot:', screenshotError);
      return '';
    }
  }
  
  /**
   * Wait for content with retry
   */
  static async waitForContentWithRetry(
    page: Page,
    selector: string,
    retries: number = 3,
    delay: number = 1000
  ): Promise<boolean> {
    for (let i = 0; i < retries; i++) {
      try {
        await page.waitForSelector(selector, {
          state: 'visible',
          timeout: 5000
        });
        return true;
      } catch (error) {
        if (i === retries - 1) throw error;
        await page.waitForTimeout(delay);
      }
    }
    return false;
  }
  
  /**
   * Extract text content from selector
   */
  static async extractText(page: Page, selector: string): Promise<string> {
    return await page.textContent(selector) || '';
  }
  
  /**
   * Extract all text content from multiple elements
   */
  static async extractAllText(page: Page, selector: string): Promise<string[]> {
    return await page.$$eval(selector, elements => 
      elements.map(el => el.textContent?.trim() || '')
    );
  }
  
  /**
   * Extract attributes from elements
   */
  static async extractAttributes(
    page: Page, 
    selector: string, 
    attribute: string
  ): Promise<string[]> {
    return await page.$$eval(
      selector,
      (elements, attr) => elements.map(el => el.getAttribute(attr) || ''),
      attribute
    );
  }
  
  /**
   * Parse HTML with Cheerio
   */
  static parseHtml(html: string): cheerio.CheerioAPI {
    return cheerio.load(html);
  }
  
  /**
   * Extract structured data from JSON-LD
   */
  static async extractJsonLd(page: Page): Promise<any[]> {
    return await page.$$eval('script[type="application/ld+json"]', scripts =>
      scripts.map(script => {
        try {
          return JSON.parse(script.textContent || '{}');
        } catch {
          return null;
        }
      }).filter(Boolean)
    );
  }
  
  /**
   * Extract data attributes
   */
  static async extractDataAttributes(page: Page, selector: string): Promise<Record<string, string>[]> {
    return await page.$$eval(selector, elements =>
      elements.map(el => {
        const data: Record<string, string> = {};
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          if (attr.name.startsWith('data-')) {
            data[attr.name] = attr.value;
          }
        }
        return data;
      })
    );
  }
  
  /**
   * Validate extracted data structure
   */
  static validateDataStructure(
    data: any,
    requiredFields: string[]
  ): { valid: boolean; missing: string[] } {
    const missing: string[] = [];
    
    for (const field of requiredFields) {
      if (!(field in data) || data[field] === null || data[field] === undefined) {
        missing.push(field);
      }
    }
    
    return {
      valid: missing.length === 0,
      missing
    };
  }
  
  /**
   * Retry operation with exponential backoff
   */
  static async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    initialDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        const delay = initialDelay * Math.pow(2, i);
        console.warn(`Retry ${i + 1}/${maxRetries} after ${delay}ms:`, error);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError || new Error('Operation failed after retries');
  }
  
  /**
   * Check if element is visible
   */
  static async isVisible(page: Page, selector: string): Promise<boolean> {
    try {
      const element = await page.$(selector);
      if (!element) return false;
      return await element.isVisible();
    } catch {
      return false;
    }
  }
  
  /**
   * Scroll element into view
   */
  static async scrollIntoView(page: Page, selector: string): Promise<void> {
    await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, selector);
  }
  
  /**
   * Get computed style
   */
  static async getComputedStyle(
    page: Page, 
    selector: string, 
    property: string
  ): Promise<string> {
    return await page.evaluate((args: { sel: string; prop: string }) => {
      const element = document.querySelector(args.sel);
      if (!element) return '';
      return window.getComputedStyle(element).getPropertyValue(args.prop);
    }, { sel: selector, prop: property });
  }
}