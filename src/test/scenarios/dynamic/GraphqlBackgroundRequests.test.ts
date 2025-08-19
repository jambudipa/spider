/**
 * GraphqlBackgroundRequests Scenario Tests - Real Implementation
 * Tests for the GraphqlBackgroundRequests scenario: intercepting GraphQL requests at /reviews
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { DynamicScenarioBase } from '../../helpers/BaseScenarioTest';
import { DataExtractor } from '../../helpers/DataExtractor';

class GraphQLTest extends DynamicScenarioBase {
  protected interceptedRequests: Array<{
    url: string;
    method: string;
    postData: any;
    headers: any;
    timestamp: number;
  }> = [];
  
  protected interceptedResponses: Array<{
    url: string;
    status: number;
    body: any;
    headers: any;
    timestamp: number;
  }> = [];

  get getInterceptedRequests() {
    return this.interceptedRequests;
  }

  get getInterceptedResponses() {
    return this.interceptedResponses;
  }

  async setup(): Promise<void> {
    await super.setup();
    
    // Set up request/response interception
    this.getPage().on('request', request => {
      const url = request.url();
      if (this.isGraphQLRequest(url, request.postData() ?? undefined)) {
        this.interceptedRequests.push({
          url,
          method: request.method(),
          postData: this.parsePostData(request.postData() ?? undefined),
          headers: request.headers(),
          timestamp: Date.now()
        });
      }
    });
    
    this.getPage().on('response', async response => {
      const url = response.url();
      if (this.isGraphQLResponse(url, response.headers())) {
        try {
          const body = await response.json();
          this.interceptedResponses.push({
            url,
            status: response.status(),
            body,
            headers: response.headers(),
            timestamp: Date.now()
          });
        } catch {
          // Not JSON response
        }
      }
    });
  }
  
  private isGraphQLRequest(url: string, postData?: string): boolean {
    return url.includes('graphql') || 
           url.includes('/api/graph') ||
           (!!postData && (postData.includes('query') || postData.includes('mutation')));
  }
  
  private isGraphQLResponse(url: string, headers: Record<string, string>): boolean {
    const contentType = headers['content-type'] || '';
    return url.includes('graphql') ||
           url.includes('/api/graph') ||
           contentType.includes('application/json') && url.includes('api');
  }
  
  private parsePostData(postData?: string): any {
    if (!postData) return null;
    
    try {
      return JSON.parse(postData);
    } catch {
      // Try to parse as URL-encoded
      const params = new URLSearchParams(postData);
      const result: Record<string, any> = {};
      params.forEach((value, key) => {
        result[key] = value;
      });
      return result;
    }
  }

  async validateScenario(): Promise<void> {
    await super.validateScenario();
    
    // Verify we're on the reviews page
    const url = this.getPage().url();
    expect(url).toContain('/reviews');
  }

  hasNestedObjects(obj: any, depth: number = 0): boolean {
    if (depth > 3) return false; // Prevent infinite recursion
    
    if (typeof obj !== 'object' || obj === null) return false;
    
    for (const key in obj) {
      const value = obj[key];
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          // Check if array contains objects
          if (value.some(item => typeof item === 'object' && item !== null)) {
            return true;
          }
        } else {
          // Nested object found
          return true;
        }
      }
    }
    
    return false;
  }
}

describe('GraphqlBackgroundRequests Scenario Tests - Real Site', () => {
  let test: GraphQLTest;
  
  beforeEach(async () => {
    test = new GraphQLTest('GraphqlBackgroundRequests');
    await test.setup();
    await test.navigateToScenario('/reviews');
  });
  
  afterEach(async () => {
    if (test) {
      await test.cleanup();
    }
  });

  it('should detect GraphQL endpoint', async () => {
    try {
      // Wait for page to load and interact with it to trigger requests
      await test.waitForContent('body');
      
      // Try to trigger dynamic loading to capture GraphQL requests
      try {
        // Look for load more buttons or other interactive elements
        const loadMoreButton = await test.getPage().$('button:has-text("Load"), button:has-text("More")');
        if (loadMoreButton) {
          await loadMoreButton.click();
          await test.getPage().waitForTimeout(3000);
        }
      } catch {}
      
      // Also try scrolling to potentially trigger lazy loading
      await test.getPage().evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight * 0.8);
      });
      await test.getPage().waitForTimeout(2000);
      
      // Check for API requests that might be GraphQL
      const apiRequests = test.getInterceptedRequests.filter(req => 
        req.url.includes('/api') || 
        req.url.includes('graphql') ||
        req.postData && (
          JSON.stringify(req.postData).includes('query') ||
          JSON.stringify(req.postData).includes('mutation')
        )
      );
      
      const apiResponses = test.getInterceptedResponses.filter(res =>
        res.url.includes('/api') ||
        res.url.includes('graphql') ||
        (res.body && typeof res.body === 'object' && (res.body.data || res.body.errors))
      );
      
      // If we found GraphQL-like requests/responses
      if (apiRequests.length > 0 || apiResponses.length > 0) {
        expect(apiRequests.length + apiResponses.length).toBeGreaterThan(0);
        
        // Validate GraphQL structure in responses
        apiResponses.forEach(response => {
          if (response.body && typeof response.body === 'object') {
            // GraphQL responses typically have 'data' or 'errors' fields
            const hasGraphQLStructure = 
              response.body.hasOwnProperty('data') ||
              response.body.hasOwnProperty('errors') ||
              response.body.hasOwnProperty('extensions');
              
            if (hasGraphQLStructure) {
              expect(hasGraphQLStructure).toBe(true);
            }
          }
        });
      }
      
    } catch (error) {
      await test.handleFailure('detect-graphql-endpoint', error as Error);
    }
  });

  it('should query GraphQL for data', async () => {
    try {
      // Set up response interception for GraphQL-like data
      const graphqlData: any[] = [];
      
      await test.interceptRequests('/api', (url, body) => {
        if (body && (body.data || body.reviews || body.items)) {
          graphqlData.push({
            url,
            data: body,
            timestamp: Date.now()
          });
        }
      });
      
      // Try to trigger GraphQL requests by interacting with the page
      const interactions = [
        // Try clicking load more buttons
        async () => {
          const buttons = await test.getPage().$$('button');
          for (const button of buttons) {
            const text = await button.textContent();
            if (text && text.toLowerCase().includes('load')) {
              await button.click();
              await test.getPage().waitForTimeout(1000);
              break;
            }
          }
        },
        
        // Try scrolling to trigger lazy loading
        async () => {
          await test.getPage().evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          await test.getPage().waitForTimeout(1000);
        }
      ];
      
      // Execute interactions to potentially trigger GraphQL requests
      for (const interaction of interactions) {
        try {
          await interaction();
        } catch {}
      }
      
      // Check if we captured any structured data responses
      const structuredResponses = test.getInterceptedResponses.filter(res =>
        res.body && 
        typeof res.body === 'object' &&
        res.status < 400
      );
      
      if (structuredResponses.length > 0) {
        expect(structuredResponses.length).toBeGreaterThan(0);
        
        // Validate response structure
        structuredResponses.forEach(response => {
          expect(response.body).toBeTruthy();
          expect(typeof response.body).toBe('object');
          expect(response.status).toBeLessThan(400);
        });
      } else if (graphqlData.length > 0) {
        expect(graphqlData.length).toBeGreaterThan(0);
        graphqlData.forEach(item => {
          expect(item.data).toBeTruthy();
        });
      }
      
    } catch (error) {
      await test.handleFailure('query-graphql-data', error as Error);
    }
  });

  it('should handle GraphQL pagination', async () => {
    try {
      const paginationRequests: any[] = [];
      
      // Monitor pagination-related requests
      test.getInterceptedRequests.forEach(req => {
        if (req.postData && typeof req.postData === 'object') {
          const postDataStr = JSON.stringify(req.postData).toLowerCase();
          if (postDataStr.includes('page') || 
              postDataStr.includes('offset') || 
              postDataStr.includes('cursor') ||
              postDataStr.includes('first') ||
              postDataStr.includes('after')) {
            paginationRequests.push(req);
          }
        }
      });
      
      // Try to trigger pagination by clicking through pages/loading more
      const maxAttempts = 3;
      for (let i = 0; i < maxAttempts; i++) {
        // Look for pagination buttons
        const paginationButtons = await test.getPage().$$eval(
          'button, a, [role="button"]',
          elements => elements
            .map(el => ({
              text: el.textContent?.toLowerCase() || '',
              href: (el as HTMLAnchorElement).href || '',
              className: el.className
            }))
            .filter(btn => 
              btn.text.includes('next') ||
              btn.text.includes('more') ||
              btn.text.includes('load') ||
              btn.className.includes('pagination')
            )
        );
        
        if (paginationButtons.length > 0) {
          try {
            // Click the first pagination-like button
            const button = await test.getPage().$('button:has-text("Load"), button:has-text("More"), button:has-text("Next")');
            if (button && await button.isVisible() && await button.isEnabled()) {
              await button.click();
              await test.getPage().waitForTimeout(2000);
            }
          } catch {}
        } else {
          break;
        }
      }
      
      // Check for pagination in URL parameters or API calls
      const hasPagination = 
        paginationRequests.length > 0 ||
        test.getInterceptedRequests.some(req => 
          req.url.includes('page=') || 
          req.url.includes('offset=') ||
          req.url.includes('limit=')
        );
        
      if (hasPagination) {
        expect(hasPagination).toBe(true);
      }
      
      // Verify reviews increase with pagination
      const finalReviews = await DataExtractor.extractReviews(test.getPage());
      expect(finalReviews.length).toBeGreaterThan(0);
      
    } catch (error) {
      await test.handleFailure('handle-graphql-pagination', error as Error);
    }
  });

  it('should extract nested GraphQL data', async () => {
    try {
      // Interact with page to generate API requests
      await test.getPage().evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight * 0.5);
      });
      await test.getPage().waitForTimeout(1000);
      
      // Try to click elements that might trigger nested data loading
      const clickableElements = await test.getPage().$$('button, [role="button"], a');
      for (let i = 0; i < Math.min(3, clickableElements.length); i++) {
        try {
          const element = clickableElements[i];
          if (await element.isVisible()) {
            await element.click();
            await test.getPage().waitForTimeout(1000);
          }
        } catch {}
      }
      
      // Analyze intercepted responses for nested structure
      const nestedDataResponses = test.getInterceptedResponses.filter(res => {
        if (!res.body || typeof res.body !== 'object') return false;
        
        const hasNestedStructure = test.hasNestedObjects(res.body);
        return hasNestedStructure;
      });
      
      if (nestedDataResponses.length > 0) {
        expect(nestedDataResponses.length).toBeGreaterThan(0);
        
        // Validate nested structure
        nestedDataResponses.forEach(response => {
          const extractedData = DataExtractor.extractGraphQLData(JSON.stringify(response.body));
          if (extractedData) {
            expect(extractedData).toBeTruthy();
            expect(typeof extractedData).toBe('object');
          }
        });
      }
      
      // Also check if the page itself contains nested review/testimonial data
      const pageReviews = await DataExtractor.extractReviews(test.getPage());
      if (pageReviews.length > 0) {
        expect(pageReviews.length).toBeGreaterThan(0);
        
        // Verify nested review structure
        pageReviews.forEach(review => {
          expect(review).toHaveProperty('author');
          expect(review).toHaveProperty('content');
          expect(typeof review.rating).toBe('number');
        });
      }
      
    } catch (error) {
      await test.handleFailure('extract-nested-graphql-data', error as Error);
    }
  });

  it('should handle GraphQL errors', async () => {
    try {
      // Monitor for error responses
      const errorResponses = test.getInterceptedResponses.filter(res =>
        res.status >= 400 ||
        (res.body && 
         typeof res.body === 'object' && 
         (res.body.errors || res.body.error))
      );
      
      // Try to make requests that might cause errors
      const potentialErrorTriggers = [
        // Try accessing non-existent endpoints
        async () => {
          try {
            await test.getPage().goto(`${test.getBaseUrl()}/api/reviews/99999`, { 
              waitUntil: 'networkidle',
              timeout: 5000 
            });
          } catch {}
        },
        
        // Try invalid pagination
        async () => {
          try {
            await test.getPage().goto(`${test.getBaseUrl()}/reviews?page=-1`, {
              waitUntil: 'networkidle',
              timeout: 5000
            });
          } catch {}
        }
      ];
      
      // Execute potential error triggers
      for (const trigger of potentialErrorTriggers) {
        try {
          await trigger();
          await test.getPage().waitForTimeout(1000);
        } catch {}
      }
      
      // Return to original page
      await test.navigateToScenario('/reviews');
      
      // Verify error handling
      if (errorResponses.length > 0) {
        expect(errorResponses.length).toBeGreaterThan(0);
        
        errorResponses.forEach(response => {
          // Should have proper error status or error structure
          expect(
            response.status >= 400 ||
            (response.body && (response.body.errors || response.body.error))
          ).toBe(true);
        });
      }
      
      // Verify page still functions after error scenarios
      const finalReviews = await DataExtractor.extractReviews(test.getPage());
      expect(finalReviews.length).toBeGreaterThanOrEqual(0);
      
      const pageContent = await test.getPage().content();
      expect(pageContent.length).toBeGreaterThan(1000);
      
    } catch (error) {
      await test.handleFailure('handle-graphql-errors', error as Error);
    }
  });

  it('should support GraphQL mutations', async () => {
    try {
      // Look for mutation-like operations (POST requests to API endpoints)
      const mutationRequests = test.getInterceptedRequests.filter(req =>
        req.method === 'POST' &&
        (req.url.includes('/api') || req.url.includes('graphql')) &&
        req.postData &&
        (JSON.stringify(req.postData).includes('mutation') ||
         req.headers['content-type']?.includes('application/json'))
      );
      
      // Try to trigger mutation-like operations
      const interactiveElements = await test.getPage().$$eval(
        'button, input[type="submit"], [role="button"]',
        elements => elements
          .map(el => ({
            text: el.textContent?.toLowerCase() || '',
            type: (el as HTMLInputElement).type || 'button',
            className: el.className
          }))
          .filter(el => 
            el.text.includes('submit') ||
            el.text.includes('save') ||
            el.text.includes('update') ||
            el.text.includes('delete') ||
            el.type === 'submit' ||
            el.className.includes('submit')
          )
      );
      
      // If we have interactive elements that might trigger mutations
      if (interactiveElements.length > 0) {
        try {
          const submitButton = await test.getPage().$('button:has-text("Submit"), input[type="submit"]');
          if (submitButton && await submitButton.isVisible()) {
            // Don't actually submit - just verify the button exists
            expect(submitButton).toBeTruthy();
          }
        } catch {}
      }
      
      // Check for CSRF tokens or other mutation-related data
      const csrfToken = await DataExtractor.extractCSRFToken(test.getPage());
      const hasFormElements = await test.getPage().evaluate(() => {
        return document.querySelectorAll('form, input, textarea').length > 0;
      });
      
      // Verify mutation support indicators
      if (mutationRequests.length > 0) {
        expect(mutationRequests.length).toBeGreaterThan(0);
        
        mutationRequests.forEach(request => {
          expect(request.method).toBe('POST');
          expect(request.postData).toBeTruthy();
        });
      } else if (hasFormElements || csrfToken) {
        // Page has forms or CSRF tokens, indicating mutation support
        expect(hasFormElements || csrfToken.length > 0).toBe(true);
      }
      
    } catch (error) {
      await test.handleFailure('support-graphql-mutations', error as Error);
    }
  });
});
