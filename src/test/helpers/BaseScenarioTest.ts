/**
 * Base Scenario Test Classes
 * Abstract base classes for different scenario types
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Page } from 'playwright';
import { BrowserManager } from '../../browser/BrowserManager';
import { PlaywrightAdapter } from '../../browser/PlaywrightAdapter';
import { TestHelper, TestContext } from './TestHelper';
import { DataExtractor } from './DataExtractor';

export abstract class BaseScenarioTest {
  protected context!: TestContext;
  protected page!: Page;
  protected scenarioName: string;
  protected baseUrl = 'https://web-scraping.dev';
  
  constructor(scenarioName: string) {
    this.scenarioName = scenarioName;
  }
  
  /**
   * Get the current page instance
   */
  getPage(): Page {
    return this.page;
  }
  
  /**
   * Get the test context
   */
  getContext(): TestContext {
    return this.context;
  }
  
  /**
   * Get the base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
  
  /**
   * Setup test context
   */
  async setup(): Promise<void> {
    this.context = await TestHelper.createTestContext(this.scenarioName);
    this.page = this.context.adapter.getPage();
  }
  
  /**
   * Cleanup test context
   */
  async cleanup(): Promise<void> {
    if (this.context) {
      await TestHelper.cleanupTestContext(this.context);
    }
  }
  
  /**
   * Handle test failure
   */
  async handleFailure(testName: string, error: Error): Promise<void> {
    if (this.page) {
      await TestHelper.captureFailureScreenshot(this.page, testName, error);
    }
    throw error;
  }
  
  /**
   * Navigate to scenario URL
   */
  async navigateToScenario(path: string): Promise<void> {
    const url = `${this.baseUrl}${path}`;
    const response = await this.context.adapter.goto(url);
    
    if (!response || response.status() >= 400) {
      throw new Error(`Failed to navigate to ${url}: ${response?.status()}`);
    }
  }
  
  /**
   * Abstract method for scenario-specific validation
   */
  abstract validateScenario(): Promise<void>;
}

export class StaticScenarioBase extends BaseScenarioTest {
  /**
   * Extract HTML content
   */
  async getHtmlContent(): Promise<string> {
    return await this.context.adapter.content();
  }
  
  /**
   * Parse HTML with Cheerio
   */
  parseHtml(html: string) {
    return TestHelper.parseHtml(html);
  }
  
  /**
   * Extract links from page
   */
  async extractLinks(selector: string = 'a'): Promise<string[]> {
    return await this.page.$$eval(selector, links =>
      links.map(link => (link as HTMLAnchorElement).href)
    );
  }
  
  /**
   * Default validation for static scenarios
   */
  async validateScenario(): Promise<void> {
    const html = await this.getHtmlContent();
    expect(html).toBeTruthy();
    expect(html.length).toBeGreaterThan(100);
  }
}

export class DynamicScenarioBase extends BaseScenarioTest {
  /**
   * Wait for dynamic content
   */
  async waitForContent(selector: string, timeout: number = 10000): Promise<void> {
    await this.page.waitForSelector(selector, {
      state: 'visible',
      timeout
    });
  }
  
  /**
   * Scroll to load content
   */
  async scrollToLoadContent(options?: {
    maxScrolls?: number;
    delay?: number;
  }): Promise<void> {
    await this.context.adapter.scrollToBottom({
      maxScrolls: options?.maxScrolls ?? 10,
      delay: options?.delay ?? 500
    });
  }
  
  /**
   * Click to load more content
   */
  async clickLoadMore(buttonSelector: string): Promise<void> {
    const hasButton = await this.context.adapter.exists(buttonSelector);
    if (!hasButton) {
      throw new Error(`Load more button not found: ${buttonSelector}`);
    }
    
    await this.context.adapter.clickAndWait(buttonSelector);
  }
  
  /**
   * Intercept network requests
   */
  async interceptRequests(
    pattern: string | RegExp,
    handler: (url: string, body: any) => void
  ): Promise<void> {
    await this.context.adapter.interceptResponses(async (response) => {
      const url = response.url();
      if (
        (typeof pattern === 'string' && url.includes(pattern)) ||
        (pattern instanceof RegExp && pattern.test(url))
      ) {
        try {
          const body = await response.json();
          handler(url, body);
        } catch {
          // Not JSON response
        }
      }
    });
  }
  
  /**
   * Default validation for dynamic scenarios
   */
  async validateScenario(): Promise<void> {
    // Check page loaded
    await this.waitForContent('body');
    
    // Check JavaScript is running
    const jsEnabled = await this.page.evaluate(() => true);
    expect(jsEnabled).toBe(true);
  }
}

export class AuthScenarioBase extends BaseScenarioTest {
  protected cookies: any[] = [];
  protected tokens: Map<string, string> = new Map();
  
  /**
   * Perform login
   */
  async login(username: string, password: string): Promise<void> {
    // Navigate to login page
    await this.navigateToScenario('/login');
    
    // Fill login form
    await this.context.adapter.fill('input[name="username"], #username', username);
    await this.context.adapter.fill('input[name="password"], #password', password);
    
    // Submit form
    await this.context.adapter.clickAndWait(
      'button[type="submit"], input[type="submit"]'
    );
    
    // Store cookies
    this.cookies = await this.context.adapter.getCookies();
  }
  
  /**
   * Check if authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    // Check for auth cookie
    const authCookie = this.cookies.find(c => 
      c.name.includes('session') || 
      c.name.includes('auth') ||
      c.name.includes('token')
    );
    
    return !!authCookie;
  }
  
  /**
   * Extract and store CSRF token
   */
  async extractCSRFToken(): Promise<string> {
    const token = await DataExtractor.extractCSRFToken(this.page);
    if (token) {
      this.tokens.set('csrf', token);
    }
    return token;
  }
  
  /**
   * Extract and store API token
   */
  async extractAPIToken(): Promise<string> {
    const token = await DataExtractor.extractAPIToken(this.page);
    if (token) {
      this.tokens.set('api', token);
    }
    return token;
  }
  
  /**
   * Set authentication headers
   */
  async setAuthHeaders(headers: Record<string, string>): Promise<void> {
    await this.page.setExtraHTTPHeaders(headers);
  }
  
  /**
   * Default validation for auth scenarios
   */
  async validateScenario(): Promise<void> {
    const authenticated = await this.isAuthenticated();
    expect(authenticated).toBe(true);
  }
}

export class AntiBlockScenarioBase extends BaseScenarioTest {
  /**
   * Apply stealth techniques
   */
  async applyStealthMode(): Promise<void> {
    // Remove automation indicators
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });
      
      // @ts-ignore
      window.chrome = {
        runtime: {}
      };
      
      // @ts-ignore
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
      
      // @ts-ignore
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      });
    });
  }
  
  /**
   * Set custom headers
   */
  async setCustomHeaders(headers: Record<string, string>): Promise<void> {
    await this.page.setExtraHTTPHeaders(headers);
  }
  
  /**
   * Rotate user agent
   */
  async rotateUserAgent(): Promise<void> {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
    ];
    
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
    await this.page.setExtraHTTPHeaders({
      'User-Agent': randomUA
    });
  }
  
  /**
   * Check if blocked
   */
  async isBlocked(): Promise<boolean> {
    const url = this.page.url();
    const content = await this.page.content();
    
    return url.includes('/blocked') || 
           content.includes('Access Denied') ||
           content.includes('403 Forbidden') ||
           content.includes('You have been blocked');
  }
  
  /**
   * Bypass block attempt
   */
  async bypassBlock(): Promise<void> {
    await this.applyStealthMode();
    await this.rotateUserAgent();
    
    // Clear cookies that might flag us
    await this.context.adapter.clearCookies();
    
    // Add legitimate-looking headers
    await this.setCustomHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });
  }
  
  /**
   * Default validation for anti-block scenarios
   */
  async validateScenario(): Promise<void> {
    const blocked = await this.isBlocked();
    expect(blocked).toBe(false);
  }
}