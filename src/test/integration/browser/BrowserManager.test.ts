/**
 * Browser Manager Tests
 * Validates browser automation infrastructure
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserManager } from '../../../browser/BrowserManager';
import { PlaywrightAdapter } from '../../../browser/PlaywrightAdapter';

describe('BrowserManager', () => {
  let browserManager: BrowserManager;

  beforeAll(() => {
    browserManager = new BrowserManager({
      headless: true,
      poolSize: 2,
      timeout: 10000
    });
  });

  afterAll(async () => {
    await browserManager.close();
  });

  it('should initialise browser pool', async () => {
    await browserManager.initialise();
    const stats = browserManager.getStats();
    
    expect(stats.browsers).toBe(2);
    expect(stats.contexts).toBe(0);
  });

  it('should create and manage contexts', async () => {
    const context1 = await browserManager.getContext('test1');
    const context2 = await browserManager.getContext('test2');
    
    expect(context1).toBeDefined();
    expect(context2).toBeDefined();
    
    const stats = browserManager.getStats();
    expect(stats.contexts).toBe(2);
  });

  it('should create pages in contexts', async () => {
    const page = await browserManager.createPage('test1');
    
    expect(page).toBeDefined();
    expect(page.url()).toBe('about:blank');
    
    await page.close();
  });

  it('should close contexts properly', async () => {
    await browserManager.closeContext('test1');
    
    const stats = browserManager.getStats();
    expect(stats.contexts).toBe(1);
  });

  it('should handle multiple page creation', async () => {
    const pages = await Promise.all([
      browserManager.createPage('test2'),
      browserManager.createPage('test2'),
      browserManager.createPage('test2')
    ]);
    
    expect(pages).toHaveLength(3);
    
    const stats = browserManager.getStats();
    expect(stats.pages).toBeGreaterThanOrEqual(3);
    
    await Promise.all(pages.map(p => p.close()));
  });
});

describe('PlaywrightAdapter', () => {
  let browserManager: BrowserManager;
  let adapter: PlaywrightAdapter;

  beforeAll(async () => {
    browserManager = new BrowserManager({
      headless: true,
      timeout: 15000
    });
    adapter = new PlaywrightAdapter(browserManager, 'adapter-test');
  });

  afterAll(async () => {
    await adapter.close();
    await browserManager.close();
  });

  it('should initialise adapter with page', async () => {
    const page = await adapter.initialise();
    
    expect(page).toBeDefined();
    expect(adapter.getPage()).toBe(page);
  });

  it('should navigate to URL', async () => {
    const response = await adapter.goto('https://example.com');
    
    expect(response).toBeDefined();
    expect(response?.status()).toBe(200);
    
    const page = adapter.getPage();
    expect(page.url()).toContain('example.com');
  });

  it('should get page content', async () => {
    const content = await adapter.content();
    
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('Example Domain');
  });

  it('should evaluate JavaScript', async () => {
    const title = await adapter.evaluate(() => document.title);
    
    expect(title).toBe('Example Domain');
  });

  it('should check element existence', async () => {
    const exists = await adapter.exists('h1');
    const notExists = await adapter.exists('#non-existent-element');
    
    expect(exists).toBe(true);
    expect(notExists).toBe(false);
  });

  it('should handle cookies', async () => {
    // Clear cookies first
    await adapter.clearCookies();
    
    let cookies = await adapter.getCookies();
    expect(cookies).toHaveLength(0);
    
    // Set a cookie
    await adapter.setCookies([
      {
        name: 'test',
        value: 'cookie',
        domain: '.example.com',
        path: '/'
      }
    ]);
    
    cookies = await adapter.getCookies();
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies.find(c => c.name === 'test')).toBeDefined();
  });

  it('should intercept requests', async () => {
    const interceptedUrls: string[] = [];
    
    await adapter.interceptRequests((request) => {
      interceptedUrls.push(request.url());
    });
    
    await adapter.goto('https://example.com');
    
    expect(interceptedUrls.length).toBeGreaterThan(0);
    expect(interceptedUrls.some(url => url.includes('example.com'))).toBe(true);
  });

  it('should intercept responses', async () => {
    const responses: number[] = [];
    
    await adapter.interceptResponses((response) => {
      responses.push(response.status());
    });
    
    await adapter.goto('https://example.com');
    
    expect(responses.length).toBeGreaterThan(0);
    expect(responses).toContain(200);
  });
});

describe('Browser Pool Management', () => {
  it('should distribute contexts across browsers', async () => {
    const manager = new BrowserManager({ poolSize: 2 });
    
    try {
      await manager.initialise();
      
      // Create multiple contexts
      const contexts = await Promise.all([
        manager.getContext('ctx1'),
        manager.getContext('ctx2'),
        manager.getContext('ctx3'),
        manager.getContext('ctx4')
      ]);
      
      expect(contexts).toHaveLength(4);
      
      const stats = manager.getStats();
      expect(stats.browsers).toBe(2);
      expect(stats.contexts).toBe(4);
    } finally {
      await manager.close();
    }
  });

  it('should handle browser cleanup properly', async () => {
    const manager = new BrowserManager({ poolSize: 1 });
    
    try {
      await manager.initialise();
      
      const page1 = await manager.createPage('cleanup-test');
      const page2 = await manager.createPage('cleanup-test');
      
      let stats = manager.getStats();
      expect(stats.pages).toBe(2);
      
      await page1.close();
      await page2.close();
      
      await manager.closeContext('cleanup-test');
      
      stats = manager.getStats();
      expect(stats.contexts).toBe(0);
    } finally {
      await manager.close();
    }
  });
});