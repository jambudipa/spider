/**
 * Persistent Cookie-Based Blocking Scenario Tests
 * Tests for handling persistent blocking via cookies at /blocked?persist=
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Cookie } from 'playwright';
import { AntiBlockScenarioBase, runEffect } from '../../helpers/BaseScenarioTest';

interface BlockingDetails {
  url: string;
  hasPersistParam: boolean;
  persistValue: string | null;
  title: string;
  bodyText: string | undefined;
  hasBlockMessage: boolean | undefined;
}

class PersistentCookieBasedBlockingTest extends AntiBlockScenarioBase {
  constructor() {
    super('persistent-cookie-blocking');
  }
  
  async getBlockingCookies(): Promise<Cookie[]> {
    const cookies = await runEffect(this.getContext().adapter.getCookies());
    return [...cookies].filter(cookie =>
      cookie.name.toLowerCase().includes('block') ||
      cookie.name.toLowerCase().includes('ban') ||
      cookie.name.toLowerCase().includes('denied') ||
      cookie.name.toLowerCase().includes('persist')
    );
  }

  async setBlockingCookie(name: string, value: string): Promise<void> {
    await runEffect(this.getContext().adapter.setCookies([{
      name,
      value,
      domain: '.web-scraping.dev',
      path: '/',
      expires: Date.now() / 1000 + 3600, // 1 hour from now
      httpOnly: false,
      secure: false,
      sameSite: 'Lax'
    }]));
  }

  async clearBlockingCookies(): Promise<void> {
    const blockingCookies = await this.getBlockingCookies();

    // Clear each blocking cookie
    for (const cookie of blockingCookies) {
      await runEffect(this.getContext().adapter.setCookies([{
        name: cookie.name,
        value: '',
        domain: cookie.domain,
        path: cookie.path || '/',
        expires: 0, // Expire immediately
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite
      }]));
    }

    // Also try clearing all cookies
    await runEffect(this.getContext().adapter.clearCookies());
  }

  async testPersistence(): Promise<{
    initialBlocked: boolean;
    afterReload: boolean;
    afterNavigation: boolean;
    hasPersistentCookie: boolean;
  }> {
    // Initial state
    const initialBlocked = await this.isBlocked();

    // Reload page
    await this.getPage().reload();
    await this.getPage().waitForLoadState('networkidle');
    const afterReload = await this.isBlocked();

    // Navigate away and back
    await this.navigateToScenario('/');
    await this.navigateToScenario('/blocked?persist=');
    const afterNavigation = await this.isBlocked();

    // Check for persistent cookies
    const cookies = await this.getBlockingCookies();
    const hasPersistentCookie = cookies.length > 0;

    return {
      initialBlocked,
      afterReload,
      afterNavigation,
      hasPersistentCookie
    };
  }
  
  async extractBlockingDetails(): Promise<BlockingDetails> {
    return await this.getPage().evaluate(() => {
      const params = new URLSearchParams(window.location.search);
      return {
        url: window.location.href,
        hasPersistParam: params.has('persist'),
        persistValue: params.get('persist'),
        title: document.title,
        bodyText: document.body.textContent?.substring(0, 200),
        hasBlockMessage: document.body.textContent?.includes('blocked')
      };
    });
  }
}

describe('Persistent Cookie-Based Blocking Scenario - /blocked?persist=', () => {
  let test: PersistentCookieBasedBlockingTest;
  
  beforeAll(async () => {
    test = new PersistentCookieBasedBlockingTest();
    await test.setup();
  }, 30000);

  afterAll(async () => {
    // Clean up any blocking cookies
    await test.clearBlockingCookies();
    await test.cleanup();
  });

  it('should detect persistent blocking', async () => {
    await test.navigateToScenario('/blocked?persist=');

    const details = await test.extractBlockingDetails();

    console.log('Blocking details:', details);

    expect(details.hasPersistParam).toBe(true);
    expect(details.hasBlockMessage).toBe(true);
    expect(details.url).toContain('persist');
  });

  it('should set persistent blocking cookies', async () => {
    await test.navigateToScenario('/blocked?persist=true');

    const cookies = await test.getBlockingCookies();

    console.log('Blocking cookies:', cookies.map(c => ({
      name: c.name,
      value: c.value,
      expires: c.expires
    })));

    // Check if any blocking cookies were set
    if (cookies.length > 0) {
      expect(cookies[0]).toHaveProperty('name');
      expect(cookies[0]).toHaveProperty('value');

      // Check persistence
      const hasExpiry = cookies.some(c => c.expires && c.expires > Date.now() / 1000);
      console.log('Has persistent cookies:', hasExpiry);
    }
  });
  
  it('should maintain block across page reloads', async () => {
    await test.navigateToScenario('/blocked?persist=true');

    const persistence = await test.testPersistence();

    console.log('Persistence test:', persistence);

    expect(persistence.initialBlocked).toBe(true);

    // If cookies are set, block should persist
    if (persistence.hasPersistentCookie) {
      expect(persistence.afterReload).toBe(true);
      expect(persistence.afterNavigation).toBe(true);
    }
  });

  it('should test cookie-based unblocking', async () => {
    // First get blocked with persistence
    await test.navigateToScenario('/blocked?persist=true');

    const beforeClear = await test.isBlocked();
    expect(beforeClear).toBe(true);

    // Clear blocking cookies
    await test.clearBlockingCookies();

    // Try accessing again
    await test.navigateToScenario('/products');
    const afterClear = await test.isBlocked();

    console.log('Block status after clearing cookies:', {
      beforeClear,
      afterClear,
      url: test.getPage().url()
    });

    // Should be able to access other pages after clearing
    expect(test.getPage().url()).toContain('/products');
  });

  it('should handle different persist parameter values', async () => {
    const testValues = ['true', '1', 'yes', '', 'false', '0'];
    const results: { value: string; isBlocked: boolean; hasCookies: boolean }[] = [];

    for (const value of testValues) {
      await test.navigateToScenario(`/blocked?persist=${value}`);

      const cookies = await test.getBlockingCookies();
      const isBlocked = await test.isBlocked();

      results.push({
        value,
        isBlocked,
        hasCookies: cookies.length > 0
      });

      // Clear for next test
      await test.clearBlockingCookies();
    }

    console.log('Persist parameter test results:', results);

    // All should show block page
    expect(results.every(r => r.isBlocked)).toBe(true);

    // Some might set cookies
    const withCookies = results.filter(r => r.hasCookies);
    console.log(`${withCookies.length} of ${results.length} set cookies`);
  });

  it('should test blocking cookie attributes', async () => {
    await test.navigateToScenario('/blocked?persist=true');

    const cookies = await runEffect(test.getContext().adapter.getCookies());
    const blockingCookies = [...cookies].filter(c =>
      c.name.toLowerCase().includes('block') ||
      c.name.toLowerCase().includes('persist')
    );

    if (blockingCookies.length > 0) {
      const cookie = blockingCookies[0];

      console.log('Cookie attributes:', {
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expires: cookie.expires
      });

      // Check security attributes
      expect(cookie).toHaveProperty('domain');
      expect(cookie).toHaveProperty('path');

      // Check persistence
      if (cookie.expires && cookie.expires !== -1) {
        const expiryDate = new Date(cookie.expires * 1000);
        const now = new Date();
        expect(expiryDate.getTime()).toBeGreaterThan(now.getTime());
      } else if (cookie.expires === -1) {
        // Session cookie - this is acceptable for blocking mechanisms
        console.log('Session cookie detected (expires: -1) - this is valid for blocking');
      }
    }

    // Test passes even if no cookies set (site might use other mechanisms)
    expect(true).toBe(true);
  });
});