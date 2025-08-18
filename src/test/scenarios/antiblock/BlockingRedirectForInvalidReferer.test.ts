/**
 * Blocking Redirect for Invalid Referer Scenario Tests
 * Tests for handling referer-based access control at /credentials
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { AntiBlockScenarioBase } from '../../helpers/BaseScenarioTest';

class BlockingRedirectForInvalidRefererTest extends AntiBlockScenarioBase {
  constructor() {
    super('blocking-redirect-invalid-referer');
  }
  
  async navigateWithReferer(url: string, referer: string): Promise<void> {
    await this.page.setExtraHTTPHeaders({
      'Referer': referer
    });
    
    await this.page.goto(url, {
      waitUntil: 'networkidle'
    });
  }
  
  async detectRedirect(originalUrl: string): Promise<{
    wasRedirected: boolean;
    finalUrl: string;
    isBlocked: boolean;
  }> {
    const finalUrl = this.page.url();
    const wasRedirected = finalUrl !== originalUrl;
    const isBlocked = finalUrl.includes('blocked') || 
                     await this.isBlocked();
    
    return {
      wasRedirected,
      finalUrl,
      isBlocked
    };
  }
  
  async extractCredentials(): Promise<{
    hasCredentials: boolean;
    content: string;
  }> {
    return await this.page.evaluate(() => {
      const bodyText = document.body.textContent || '';
      const hasCredentials = 
        bodyText.includes('username') ||
        bodyText.includes('password') ||
        bodyText.includes('credentials') ||
        bodyText.includes('api') ||
        bodyText.includes('key');
      
      return {
        hasCredentials,
        content: bodyText.substring(0, 500)
      };
    });
  }
  
  async testRefererAccess(referer: string): Promise<{
    referer: string;
    allowed: boolean;
    finalUrl: string;
  }> {
    const targetUrl = `${this.baseUrl}/credentials`;
    
    await this.navigateWithReferer(targetUrl, referer);
    
    const redirect = await this.detectRedirect(targetUrl);
    const credentials = await this.extractCredentials();
    
    return {
      referer,
      allowed: !redirect.isBlocked && credentials.hasCredentials,
      finalUrl: redirect.finalUrl
    };
  }
}

describe('Blocking Redirect for Invalid Referer Scenario - /credentials', () => {
  let test: BlockingRedirectForInvalidRefererTest;
  
  beforeAll(async () => {
    test = new BlockingRedirectForInvalidRefererTest();
    await test.setup();
  }, 30000);
  
  afterAll(async () => {
    await test.cleanup();
  });
  
  it('should redirect to blocked page without referer', async () => {
    // Navigate without setting referer - based on manual validation, this redirects to /blocked
    await test.navigateToScenario('/credentials');
    
    const redirect = await test.detectRedirect(`https://web-scraping.dev/credentials`);
    
    console.log('Redirect without referer:', redirect);
    console.log('Final URL:', redirect.finalUrl);
    
    // Based on manual validation: /credentials redirects to https://web-scraping.dev/blocked
    expect(redirect.wasRedirected).toBe(true);
    expect(redirect.isBlocked).toBe(true);
    expect(redirect.finalUrl).toContain('/blocked');
  });
  
  it('should test access with different referers', async () => {
    const referers = [
      '', // No referer
      'https://web-scraping.dev', // Same origin
      'https://web-scraping.dev/products', // Same origin different path
      'https://google.com', // External
      'https://example.com' // Another external
    ];
    
    const results = [];
    
    for (const referer of referers) {
      const result = await test.testRefererAccess(referer);
      results.push(result);
      console.log(`Referer "${referer}": ${result.allowed ? 'Allowed' : 'Blocked'} (Final URL: ${result.finalUrl})`);
    }
    
    // Based on manual validation, all should redirect to /blocked
    expect(results.every(r => !r.allowed)).toBe(true);
    expect(results.every(r => r.finalUrl.includes('/blocked'))).toBe(true);
    
    console.log('All referer tests resulted in blocks, as expected from manual validation');
  });
  
  it('should detect blocked page content', async () => {
    // Access /credentials - based on manual validation, redirects to /blocked
    await test.navigateToScenario('/credentials');
    
    const pageContent = await test.getPage().evaluate(() => {
      return {
        title: document.title,
        heading: document.querySelector('h1, h2')?.textContent,
        hasBlockMessage: document.body.textContent?.toLowerCase().includes('blocked'),
        url: window.location.href
      };
    });
    
    console.log('Blocked page content:', pageContent);
    
    // Should be on the blocked page
    expect(pageContent.url).toContain('/blocked');
    expect(pageContent.hasBlockMessage).toBe(true);
    expect(pageContent.title).toBeTruthy();
  });
  
  it('should test with valid referer patterns', async () => {
    // Try different valid-looking referers
    const validPatterns = [
      `${test.getBaseUrl()}/products`,
      `${test.getBaseUrl()}/login`,
      `${test.getBaseUrl()}/`
    ];
    
    for (const referer of validPatterns) {
      await test.navigateWithReferer(`${test.getBaseUrl()}/credentials`, referer);
      
      const result = await test.getPage().evaluate(() => {
        return {
          url: window.location.href,
          hasCredentials: document.body.textContent?.includes('credentials'),
          isBlocked: window.location.href.includes('blocked')
        };
      });
      
      console.log(`With referer ${referer}:`, result);
      
      // Document the behavior
      if (!result.isBlocked) {
        expect(result.url).toContain('credentials');
      }
    }
  });
  
  it('should preserve referer across redirects', async () => {
    const referer = `${test.getBaseUrl()}/products`;
    
    // Set referer and navigate
    await test.getPage().setExtraHTTPHeaders({
      'Referer': referer
    });
    
    // Monitor network requests
    const requests: string[] = [];
    test.getPage().on('request', request => {
      const headers = request.headers();
      if (headers['referer']) {
        requests.push(`${request.url()} - Referer: ${headers['referer']}`);
      }
    });
    
    await test.navigateToScenario('/credentials');
    
    console.log('Request referers:', requests);
    
    // Referer should be maintained
    expect(requests.length).toBeGreaterThan(0);
  });
  
  it('should handle direct access vs referred access', async () => {
    // Direct access (no referer) - based on manual validation, redirects to /blocked
    await test.getPage().setExtraHTTPHeaders({});
    await test.navigateToScenario('/credentials');
    
    const directAccess = {
      url: test.getPage().url(),
      isBlocked: await test.isBlocked()
    };
    
    // Referred access - still should be blocked based on manual validation
    await test.navigateWithReferer(
      `${test.getBaseUrl()}/credentials`,
      `${test.getBaseUrl()}/products`
    );
    
    const referredAccess = {
      url: test.getPage().url(),
      isBlocked: await test.isBlocked()
    };
    
    console.log('Direct access:', directAccess);
    console.log('Referred access:', referredAccess);
    
    // Based on manual validation, both should be blocked
    expect(directAccess.isBlocked).toBe(true);
    expect(directAccess.url).toContain('/blocked');
    
    expect(referredAccess.isBlocked).toBe(true);
    expect(referredAccess.url).toContain('/blocked');
    
    console.log('Both direct and referred access blocked as expected');
  });
});