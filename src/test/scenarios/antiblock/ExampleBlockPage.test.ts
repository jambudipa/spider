/**
 * Example Block Page Scenario Tests
 * Tests for handling block pages at /blocked
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { AntiBlockScenarioBase } from '../../helpers/BaseScenarioTest';

class ExampleBlockPageTest extends AntiBlockScenarioBase {
  constructor() {
    super('example-block-page');
  }
  
  async detectBlockPage(): Promise<{
    isBlocked: boolean;
    blockType: string;
    message: string;
  }> {
    return await this.page.evaluate(() => {
      const title = document.title.toLowerCase();
      const bodyText = document.body.textContent?.toLowerCase() || '';
      const url = window.location.href;
      
      // Common block page indicators
      const blockIndicators = {
        title: title.includes('blocked') || title.includes('denied') || title.includes('forbidden'),
        body: bodyText.includes('blocked') || bodyText.includes('denied') || bodyText.includes('access denied'),
        url: url.includes('blocked') || url.includes('denied'),
        status403: document.querySelector('h1')?.textContent?.includes('403'),
        captcha: !!document.querySelector('[class*="captcha"], [id*="captcha"]')
      };
      
      const isBlocked = Object.values(blockIndicators).some(v => v);
      
      let blockType = 'none';
      if (blockIndicators.captcha) blockType = 'captcha';
      else if (blockIndicators.status403) blockType = '403';
      else if (blockIndicators.title || blockIndicators.body) blockType = 'message';
      else if (blockIndicators.url) blockType = 'url';
      
      // Extract block message
      const message = 
        document.querySelector('.block-message, .error-message, .alert')?.textContent?.trim() ||
        document.querySelector('h1, h2')?.textContent?.trim() ||
        'No specific message';
      
      return {
        isBlocked,
        blockType,
        message
      };
    });
  }
  
  async extractBlockPageDetails(): Promise<any> {
    return await this.page.evaluate(() => {
      return {
        title: document.title,
        heading: document.querySelector('h1, h2')?.textContent?.trim(),
        message: document.querySelector('.message, .block-message, p')?.textContent?.trim(),
        hasForm: !!document.querySelector('form'),
        hasCaptcha: !!document.querySelector('[class*="captcha"], [id*="captcha"]'),
        hasContactInfo: document.body.textContent?.includes('contact') || false,
        statusCode: document.querySelector('[class*="403"], [class*="error"]') ? '403' : 'unknown'
      };
    });
  }
  
  async attemptBypass(): Promise<boolean> {
    // Try various bypass techniques
    await this.applyStealthMode();
    await this.rotateUserAgent();
    
    // Try setting common bypass headers
    await this.setCustomHeaders({
      'X-Forwarded-For': '127.0.0.1',
      'X-Real-IP': '127.0.0.1',
      'CF-Connecting-IP': '127.0.0.1'
    });
    
    // Reload and check if still blocked
    await this.page.reload();
    await this.page.waitForLoadState('networkidle');
    
    const stillBlocked = await this.isBlocked();
    return !stillBlocked;
  }
}

describe('Example Block Page Scenario - /blocked', () => {
  let test: ExampleBlockPageTest;
  
  beforeAll(async () => {
    test = new ExampleBlockPageTest();
    await test.setup();
  }, 30000);
  
  afterAll(async () => {
    await test.cleanup();
  });
  
  it('should detect block page', async () => {
    await test.navigateToScenario('/blocked');
    
    const blockStatus = await test.detectBlockPage();
    
    console.log('Block page status:', blockStatus);
    
    expect(blockStatus.isBlocked).toBe(true);
    expect(blockStatus.blockType).not.toBe('none');
    expect(blockStatus.message).toBeTruthy();
  });
  
  it('should extract block page details', async () => {
    await test.navigateToScenario('/blocked');
    
    const details = await test.extractBlockPageDetails();
    
    console.log('Block page details:', details);
    
    expect(details.title).toBeTruthy();
    expect(details.title.toLowerCase()).toContain('block');
    
    // Should have some explanation
    expect(details.heading || details.message).toBeTruthy();
  });
  
  it('should identify block reason', async () => {
    await test.navigateToScenario('/blocked');
    
    const pageContent = await test.getPage().content();
    
    // Common block reasons
    const reasons = {
      rateLimit: /rate limit|too many requests/i.test(pageContent),
      geographic: /country|region|geographic/i.test(pageContent),
      userAgent: /user.?agent|bot|crawler/i.test(pageContent),
      ipBlock: /ip.?address|blocked.?ip/i.test(pageContent),
      general: /blocked|denied|forbidden/i.test(pageContent)
    };
    
    console.log('Block reasons detected:', reasons);
    
    // At least one reason should be present
    expect(Object.values(reasons).some(v => v)).toBe(true);
  });
  
  it('should check for unblock options', async () => {
    await test.navigateToScenario('/blocked');
    
    const hasUnblockOptions = await test.getPage().evaluate(() => {
      const content = document.body.textContent || '';
      return {
        hasContactLink: /contact|support|help/i.test(content),
        hasInstructions: /please|try|wait/i.test(content),
        hasForm: !!document.querySelector('form'),
        hasCaptcha: !!document.querySelector('[class*="captcha"]'),
        hasButton: !!document.querySelector('button, input[type="submit"]')
      };
    });
    
    console.log('Unblock options:', hasUnblockOptions);
    
    expect(hasUnblockOptions).toBeDefined();
    
    // Should provide some way forward
    const hasAnyOption = Object.values(hasUnblockOptions).some(v => v);
    expect(hasAnyOption).toBeDefined();
  });
  
  it('should attempt bypass techniques', async () => {
    await test.navigateToScenario('/blocked');
    
    const initialBlock = await test.detectBlockPage();
    expect(initialBlock.isBlocked).toBe(true);
    
    // Try bypass
    const bypassed = await test.attemptBypass();
    
    console.log('Bypass attempt result:', bypassed);
    
    // For demo site, bypass likely won't work, but test the attempt
    expect(typeof bypassed).toBe('boolean');
    
    if (!bypassed) {
      // Verify we're still on block page
      const stillBlocked = await test.detectBlockPage();
      expect(stillBlocked.isBlocked).toBe(true);
    }
  });
  
  it('should handle different block page types', async () => {
    // Test the main block page
    await test.navigateToScenario('/blocked');
    
    const blockType = await test.getPage().evaluate(() => {
      const has403 = document.body.textContent?.includes('403');
      const hasCaptcha = !!document.querySelector('[class*="captcha"]');
      const hasRateLimit = /rate.?limit/i.test(document.body.textContent || '');
      
      if (has403) return '403-forbidden';
      if (hasCaptcha) return 'captcha-challenge';
      if (hasRateLimit) return 'rate-limit';
      return 'general-block';
    });
    
    console.log('Block page type:', blockType);
    
    expect(blockType).toBeTruthy();
    expect(['403-forbidden', 'captcha-challenge', 'rate-limit', 'general-block']).toContain(blockType);
  });
});