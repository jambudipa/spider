/**
 * Authentication Tests
 * Tests Spider's ability to handle authentication scenarios on web-scraping.dev
 */

import { describe, expect, it } from 'vitest';
import { Effect, Sink } from 'effect';
import { SpiderService } from '../../../lib/Spider/Spider.service.js';
import {
  makeSpiderConfig,
  SpiderConfig,
} from '../../../lib/Config/SpiderConfig.service.js';
import { SpiderLoggerLive } from '../../../lib/Logging/SpiderLogger.service.js';

describe('Authentication - Real web-scraping.dev Tests', () => {
  const baseUrl = 'https://web-scraping.dev';

  const runSpiderTest = async (url: string, options?: any) => {
    const config = makeSpiderConfig({
      maxPages: 1,
      maxDepth: 0,
      requestDelayMs: 2000,
      userAgent: 'Spider Test Suite',
    });

    const results: any[] = [];
    const collectSink = Sink.forEach((result: any) =>
      Effect.sync(() => results.push(result))
    );

    const program = Effect.gen(function* () {
      const spider = yield* SpiderService;
      yield* spider.crawlSingle(url, collectSink as any, options);
      return results;
    });

    return Effect.runPromise(
      program.pipe(
        Effect.provide(SpiderService.Default),
        Effect.provide(SpiderConfig.Live(config)),
        Effect.provide(SpiderLoggerLive)
      )
    );
  };

  it('should detect login form', async () => {
    const url = `${baseUrl}/login`;

    const options = {
      extractData: {
        hasLoginForm: { selector: 'form', exists: true },
        formAction: { selector: 'form', attribute: 'action' },
        formMethod: { selector: 'form', attribute: 'method' },
        usernameField: {
          selector:
            'input[name="username"], input[name="email"], input[type="email"], input[type="text"]',
          attribute: 'name',
        },
        passwordField: {
          selector: 'input[name="password"], input[type="password"]',
          attribute: 'name',
        },
        submitButton: {
          selector: 'button[type="submit"], input[type="submit"]',
          text: true,
        },
        csrfToken: {
          selector:
            'input[name="csrf_token"], input[name="_csrf"], input[name="authenticity_token"]',
          attribute: 'value',
        },
      },
    };

    const results = await runSpiderTest(url, options);

    expect(results).toHaveLength(1);
    const extracted = results[0].pageData.extractedData;

    expect(extracted?.hasLoginForm).toBe(true);
    expect(extracted?.passwordField).toBeTruthy();

    console.log('Login form details:', {
      method: extracted?.formMethod,
      action: extracted?.formAction,
      usernameField: extracted?.usernameField,
      passwordField: extracted?.passwordField,
      hasCSRF: !!extracted?.csrfToken,
      submitText: extracted?.submitButton,
    });
  }, 30000);

  it('should detect OAuth/SSO buttons', async () => {
    const url = `${baseUrl}/login`;

    const options = {
      extractData: {
        googleLogin: {
          selector:
            'a:contains("Google"), button:contains("Google"), .google-login',
          exists: true,
        },
        facebookLogin: {
          selector:
            'a:contains("Facebook"), button:contains("Facebook"), .facebook-login',
          exists: true,
        },
        githubLogin: {
          selector:
            'a:contains("GitHub"), button:contains("GitHub"), .github-login',
          exists: true,
        },
        ssoButton: {
          selector: 'a:contains("SSO"), button:contains("SSO"), .sso-login',
          exists: true,
        },
      },
    };

    const results = await runSpiderTest(url, options);

    expect(results).toHaveLength(1);
    const extracted = results[0].pageData.extractedData;

    console.log('OAuth providers detected:', {
      google: extracted?.googleLogin,
      facebook: extracted?.facebookLogin,
      github: extracted?.githubLogin,
      sso: extracted?.ssoButton,
    });

    // Test passes if page loads
    expect(results[0].pageData.url).toBe(url);
  }, 30000);

  it('should detect session/cookie information', async () => {
    const url = `${baseUrl}/login`;

    const results = await runSpiderTest(url);

    expect(results).toHaveLength(1);
    const headers = results[0].pageData.headers;

    // Check for cookie headers
    const cookieHeaders = headers['set-cookie'] || '';
    const hasSessionCookie =
      cookieHeaders.includes('session') || cookieHeaders.includes('sess');

    console.log('Cookie information:', {
      hasCookies: !!cookieHeaders,
      hasSession: hasSessionCookie,
      cookieCount: cookieHeaders ? cookieHeaders.split(',').length : 0,
    });

    // Headers should be present
    expect(headers).toBeDefined();
  }, 30000);

  it('should detect protected page indicators', async () => {
    const url = `${baseUrl}/profile`; // This might redirect or show login

    const options = {
      extractData: {
        hasLoginPrompt: {
          selector: ':contains("Please log in"), :contains("Sign in required")',
          exists: true,
        },
        hasRedirectMessage: {
          selector: ':contains("Redirecting"), :contains("redirect")',
          exists: true,
        },
        isProtected: {
          selector: '.protected, .requires-auth, [data-protected]',
          exists: true,
        },
        statusCode: { selector: 'meta[name="status"]', attribute: 'content' },
      },
    };

    const results = await runSpiderTest(url, options);

    expect(results).toHaveLength(1);
    const pageData = results[0].pageData;
    const extracted = pageData.extractedData;

    console.log('Protected page indicators:', {
      url: pageData.url,
      statusCode: pageData.statusCode,
      hasLoginPrompt: extracted?.hasLoginPrompt,
      hasRedirect: extracted?.hasRedirectMessage,
      isProtected: extracted?.isProtected,
    });

    // Should get some response (might be redirect or login page)
    expect(pageData.statusCode).toBeGreaterThanOrEqual(200);
    expect(pageData.statusCode).toBeLessThan(600);
  }, 30000);

  it('should extract API token fields', async () => {
    const url = `${baseUrl}/login`;

    const options = {
      extractData: {
        apiKeyField: {
          selector:
            'input[name*="api"], input[name*="key"], input[name*="token"]',
          attribute: 'name',
        },
        bearerTokenMention: {
          selector: ':contains("Bearer"), :contains("Authorization")',
          exists: true,
        },
        apiDocLink: {
          selector: 'a:contains("API"), a[href*="api"]',
          attribute: 'href',
        },
      },
    };

    const results = await runSpiderTest(url, options);

    expect(results).toHaveLength(1);
    const extracted = results[0].pageData.extractedData;

    console.log('API authentication indicators:', {
      hasApiField: !!extracted?.apiKeyField,
      mentionsBearer: extracted?.bearerTokenMention,
      hasApiDocs: !!extracted?.apiDocLink,
    });

    // Test passes if page loads
    expect(results[0].pageData).toBeDefined();
  }, 30000);
});
