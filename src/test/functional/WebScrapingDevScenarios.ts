/**
 * Additional Web-scraping.dev Scenarios
 * These scenarios require different handling approaches
 */

import { Effect } from 'effect';
import { EnhancedHttpClient } from '../../lib/HttpClient/EnhancedHttpClient.js';
import { StateManager } from '../../lib/StateManager/StateManager.service.js';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://web-scraping.dev';

interface TestResult {
  scenario: string;
  success: boolean;
  data?: any;
  error?: string;
  duration: number;
  limitations?: string[];
}

/**
 * Test 4: Infinite Scroll (Limited - requires browser automation)
 * Note: This tests the static content that's available without scrolling
 */
export const testInfiniteScrollStatic = Effect.gen(function* () {
  const startTime = Date.now();
  const httpClient = yield* EnhancedHttpClient;

  try {
    const response = yield* httpClient.get(`${BASE_URL}/testimonials`);

    if (response.status !== 200) {
      throw new Error(`Failed to fetch testimonials: ${response.status}`);
    }

    const $ = cheerio.load(response.body);

    // Extract initial testimonials that are loaded
    const testimonials = $('.testimonial, .testimonial-card')
      .map((_, el) => ({
        author: $(el).find('.author, .name').text().trim(),
        content: $(el).find('.content, .text, .testimonial-text').text().trim(),
        rating:
          $(el).find('.rating, .stars').attr('data-rating') ||
          $(el).find('.rating, .stars').text().trim(),
      }))
      .get()
      .filter((t) => t.author || t.content);

    const duration = Date.now() - startTime;

    // Check for infinite scroll indicators
    const hasInfiniteScroll =
      $('[data-infinite-scroll], .infinite-scroll, #load-more-testimonials')
        .length > 0;

    return {
      scenario: 'Infinite Scroll (Static)',
      success: testimonials.length > 0,
      data: {
        initialTestimonials: testimonials.length,
        testimonials: testimonials.slice(0, 3),
        hasInfiniteScrollIndicators: hasInfiniteScroll,
      },
      limitations: [
        'Full infinite scroll requires browser automation (Playwright)',
        'This test only captures initially loaded content',
      ],
      duration,
    };
  } catch (error) {
    return {
      scenario: 'Infinite Scroll (Static)',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
});

/**
 * Test 5: Load More Button (Static detection)
 * Note: Clicking requires browser automation
 */
export const testLoadMoreButton = Effect.gen(function* () {
  const startTime = Date.now();
  const httpClient = yield* EnhancedHttpClient;

  try {
    const response = yield* httpClient.get(`${BASE_URL}/reviews`);

    if (response.status !== 200) {
      throw new Error(`Failed to fetch reviews: ${response.status}`);
    }

    const $ = cheerio.load(response.body);

    // Extract initial reviews
    const reviews = $('.review, .review-card')
      .map((_, el) => ({
        author: $(el).find('.author, .name').text().trim(),
        content: $(el).find('.content, .text, .review-text').text().trim(),
        rating:
          $(el).find('.rating, .stars').attr('data-rating') ||
          $(el).find('.rating, .stars').text().trim(),
      }))
      .get()
      .filter((r) => r.author || r.content);

    // Look for load more button
    const loadMoreButton = $(
      'button:contains("Load More"), .load-more-btn, #load-more-reviews'
    );
    const hasLoadMoreButton = loadMoreButton.length > 0;

    // Try to find the AJAX endpoint for loading more
    let ajaxEndpoint: string | null = null;
    $('script:not([src])').each((_, script) => {
      const content = $(script).html();
      if (content) {
        const endpointMatch = content.match(
          /['"]([^'"]*(?:load|more|reviews|ajax)[^'"]*)['"]/i
        );
        if (endpointMatch) {
          ajaxEndpoint = endpointMatch[1];
        }
      }
    });

    const duration = Date.now() - startTime;

    return {
      scenario: 'Load More Button (Detection)',
      success: reviews.length > 0 && hasLoadMoreButton,
      data: {
        initialReviews: reviews.length,
        reviews: reviews.slice(0, 3),
        hasLoadMoreButton,
        loadMoreButtonText: loadMoreButton.text().trim(),
        detectedAjaxEndpoint: ajaxEndpoint,
      },
      limitations: [
        'Button clicking requires browser automation (Playwright)',
        'This test only detects the button and initial content',
      ],
      duration,
    };
  } catch (error) {
    return {
      scenario: 'Load More Button (Detection)',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
});

/**
 * Test 6: GraphQL API (Detection and attempted query)
 */
export const testGraphQLAPI = Effect.gen(function* () {
  const startTime = Date.now();
  const httpClient = yield* EnhancedHttpClient;

  try {
    // First, find the page that uses GraphQL
    const pageResponse = yield* httpClient.get(`${BASE_URL}/graphql-demo`);

    if (pageResponse.status !== 200) {
      throw new Error(
        `Failed to fetch GraphQL demo page: ${pageResponse.status}`
      );
    }

    const $ = cheerio.load(pageResponse.body);

    // Look for GraphQL endpoint
    let graphqlEndpoint: string | null = null;
    $('script:not([src])').each((_, script) => {
      const content = $(script).html();
      if (content) {
        const endpointMatch = content.match(/['"]([^'"]*graphql[^'"]*)['"]/i);
        if (endpointMatch) {
          graphqlEndpoint = endpointMatch[1];
        }
      }
    });

    if (!graphqlEndpoint) {
      graphqlEndpoint = `${BASE_URL}/graphql`; // Default guess
    }

    // Try a simple GraphQL query
    const graphqlQuery = {
      query: `
        query {
          products {
            id
            name
            price
          }
        }
      `,
    };

    const graphqlResponse = yield* httpClient
      .post(graphqlEndpoint, graphqlQuery)
      .pipe(
        Effect.catchAll(() =>
          Effect.succeed({ status: 404, body: '{}', headers: {} })
        )
      );

    let graphqlData: any = null;
    if (graphqlResponse.status === 200) {
      try {
        graphqlData = JSON.parse(graphqlResponse.body);
      } catch (e) {
        // Not valid JSON
      }
    }

    const duration = Date.now() - startTime;

    return {
      scenario: 'GraphQL API',
      success: !!graphqlEndpoint && graphqlResponse.status === 200,
      data: {
        endpointFound: !!graphqlEndpoint,
        endpoint: graphqlEndpoint,
        responseStatus: graphqlResponse.status,
        graphqlData: graphqlData,
        hasGraphQLData: !!graphqlData?.data,
      },
      duration,
    };
  } catch (error) {
    return {
      scenario: 'GraphQL API',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
});

/**
 * Test 11: Cookie Modal (Detection)
 * Note: Modal interaction requires browser automation
 */
export const testCookieModal = Effect.gen(function* () {
  const startTime = Date.now();
  const httpClient = yield* EnhancedHttpClient;

  try {
    const response = yield* httpClient.get(`${BASE_URL}/cookie-banner`);

    if (response.status !== 200) {
      throw new Error(
        `Failed to fetch page with cookie modal: ${response.status}`
      );
    }

    const $ = cheerio.load(response.body);

    // Look for cookie modal elements
    const cookieModal = $(
      '.cookie-modal, .cookie-banner, .cookie-notice, #cookie-modal'
    );
    const acceptButton = $(
      'button:contains("Accept"), .accept-cookies, .cookie-accept'
    );
    const declineButton = $(
      'button:contains("Decline"), .decline-cookies, .cookie-decline'
    );

    // Check if modal is initially hidden (common pattern)
    const isModalHidden =
      cookieModal.hasClass('hidden') ||
      cookieModal.css('display') === 'none' ||
      cookieModal.attr('style')?.includes('display: none');

    const duration = Date.now() - startTime;

    return {
      scenario: 'Cookie Modal (Detection)',
      success: cookieModal.length > 0,
      data: {
        modalFound: cookieModal.length > 0,
        modalText: cookieModal.text().trim().substring(0, 100),
        hasAcceptButton: acceptButton.length > 0,
        hasDeclineButton: declineButton.length > 0,
        isInitiallyHidden: isModalHidden,
        acceptButtonText: acceptButton.text().trim(),
        declineButtonText: declineButton.text().trim(),
      },
      limitations: [
        'Modal interaction requires browser automation (Playwright)',
        'This test only detects modal structure',
      ],
      duration,
    };
  } catch (error) {
    return {
      scenario: 'Cookie Modal (Detection)',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
});

/**
 * Test 12: Local Storage Cart (JavaScript detection)
 */
export const testLocalStorageCart = Effect.gen(function* () {
  const startTime = Date.now();
  const httpClient = yield* EnhancedHttpClient;
  const stateManager = yield* StateManager;

  try {
    const response = yield* httpClient.get(`${BASE_URL}/cart`);

    if (response.status !== 200) {
      throw new Error(`Failed to fetch cart page: ${response.status}`);
    }

    const $ = cheerio.load(response.body);

    // Look for localStorage usage in JavaScript
    let usesLocalStorage = false;
    let cartJavaScript: string | null = null;

    $('script:not([src])').each((_, script) => {
      const content = $(script).html();
      if (content && content.includes('localStorage')) {
        usesLocalStorage = true;
        if (content.includes('cart') || content.includes('Cart')) {
          cartJavaScript = content.substring(0, 200) + '...';
        }
      }
    });

    // Simulate adding items to localStorage (what the JS would do)
    const mockCartData = {
      items: [
        { id: 1, name: 'Test Product', price: 29.99, quantity: 2 },
        { id: 2, name: 'Another Product', price: 19.99, quantity: 1 },
      ],
      total: 79.97,
    };

    yield* stateManager.setLocalStorage('cart', JSON.stringify(mockCartData));

    // Verify we can retrieve it
    const retrievedCart = yield* stateManager
      .getLocalStorage('cart')
      .pipe(Effect.catchAll(() => Effect.succeed('{}')));

    const duration = Date.now() - startTime;

    return {
      scenario: 'Local Storage Cart',
      success: usesLocalStorage || !!cartJavaScript,
      data: {
        usesLocalStorage,
        cartJavaScriptFound: !!cartJavaScript,
        cartJavaScriptSample: cartJavaScript,
        mockCartSimulated: true,
        retrievedCart: JSON.parse(retrievedCart),
        cartElements: $('.cart-item, .cart-product').length,
      },
      limitations: [
        'Full cart interaction requires browser automation',
        'This test simulates localStorage operations',
      ],
      duration,
    };
  } catch (error) {
    return {
      scenario: 'Local Storage Cart',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
});

/**
 * Test 13: New Tab Links (Detection)
 */
export const testNewTabLinks = Effect.gen(function* () {
  const startTime = Date.now();
  const httpClient = yield* EnhancedHttpClient;

  try {
    const response = yield* httpClient.get(`${BASE_URL}/external-links`);

    if (response.status !== 200) {
      throw new Error(
        `Failed to fetch external links page: ${response.status}`
      );
    }

    const $ = cheerio.load(response.body);

    // Find links that open in new tabs/windows
    const newTabLinks = $('a[target="_blank"], a[target="_new"]')
      .map((_, el) => ({
        href: $(el).attr('href'),
        text: $(el).text().trim(),
        target: $(el).attr('target'),
        rel: $(el).attr('rel'),
      }))
      .get();

    // Also check for JavaScript window.open calls
    let hasWindowOpen = false;
    $('script:not([src])').each((_, script) => {
      const content = $(script).html();
      if (content && content.includes('window.open')) {
        hasWindowOpen = true;
      }
    });

    const duration = Date.now() - startTime;

    return {
      scenario: 'New Tab Links (Detection)',
      success: newTabLinks.length > 0 || hasWindowOpen,
      data: {
        newTabLinksFound: newTabLinks.length,
        newTabLinks: newTabLinks.slice(0, 5),
        hasWindowOpenCalls: hasWindowOpen,
        totalLinks: $('a').length,
      },
      limitations: [
        'Following links to new tabs requires browser automation',
        'This test only detects target="_blank" attributes',
      ],
      duration,
    };
  } catch (error) {
    return {
      scenario: 'New Tab Links (Detection)',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
});

/**
 * Test 14: Block Page (Detection and handling)
 */
export const testBlockPage = Effect.gen(function* () {
  const startTime = Date.now();
  const httpClient = yield* EnhancedHttpClient;

  try {
    // Try to trigger a block by making rapid requests
    const responses: any[] = [];

    for (let i = 0; i < 3; i++) {
      const response = yield* httpClient.get(`${BASE_URL}/rate-limited`).pipe(
        Effect.catchAll((error) =>
          Effect.succeed({
            status: 429,
            body: error.message,
            headers: {},
          })
        )
      );

      responses.push({
        attempt: i + 1,
        status: response.status,
        blocked: response.status === 429 || response.status === 403,
        bodyContains: {
          rateLimit: response.body.toLowerCase().includes('rate limit'),
          blocked: response.body.toLowerCase().includes('blocked'),
          captcha: response.body.toLowerCase().includes('captcha'),
        },
      });

      // Small delay between requests
      yield* Effect.sleep(100);
    }

    const blockedResponses = responses.filter((r) => r.blocked);
    const hasBlockDetection = blockedResponses.length > 0;

    const duration = Date.now() - startTime;

    return {
      scenario: 'Block Page Detection',
      success: hasBlockDetection,
      data: {
        totalRequests: responses.length,
        blockedRequests: blockedResponses.length,
        responses,
        blockDetected: hasBlockDetection,
      },
      limitations: [
        'Block simulation may not trigger on all sites',
        'CAPTCHA solving requires specialized tools',
      ],
      duration,
    };
  } catch (error) {
    return {
      scenario: 'Block Page Detection',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
});

export const additionalScenarios = [
  testInfiniteScrollStatic,
  testLoadMoreButton,
  testGraphQLAPI,
  testCookieModal,
  testLocalStorageCart,
  testNewTabLinks,
  testBlockPage,
];
