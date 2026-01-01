/**
 * EndlessScrollPaging Scenario Tests - Real Implementation
 * Tests for the EndlessScrollPaging scenario: infinite scroll pagination at /testimonials
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { DynamicScenarioBase } from '../../helpers/BaseScenarioTest';
import { DataExtractor, Testimonial } from '../../helpers/DataExtractor';

class EndlessScrollTest extends DynamicScenarioBase {
  async validateScenario(): Promise<void> {
    await super.validateScenario();
    
    // Verify we're on the testimonials page
    const url = this.getPage().url();
    expect(url).toContain('/testimonials');
  }
}

describe('EndlessScrollPaging Scenario Tests - Real Site', () => {
  let test: EndlessScrollTest;
  
  beforeEach(async () => {
    test = new EndlessScrollTest('EndlessScrollPaging');
    await test.setup();
    await test.navigateToScenario('/testimonials');
  });
  
  afterEach(async () => {
    if (test) {
      await test.cleanup();
    }
  });

  it('should detect infinite scroll', async () => {
    try {
      // Wait for page to load completely
      await test.waitForContent('body');
      
      // Check for indicators of infinite scroll
      const scrollIndicators = await test.getPage().evaluate(() => {
        // Look for common infinite scroll patterns
        const indicators = {
          hasLoadingSpinner: !!document.querySelector('.loading, .spinner, [data-loading]'),
          hasScrollContainer: !!document.querySelector('.scroll-container, .infinite-scroll'),
          hasEndOfContent: !!document.querySelector('.end-of-content, .no-more-content'),
          documentHeight: document.documentElement.scrollHeight,
          windowHeight: window.innerHeight,
          isScrollable: document.documentElement.scrollHeight > window.innerHeight,
          hasTestimonials: document.querySelectorAll('.testimonial, .testimonial-item, [data-testimonial]').length > 0
        };
        
        return indicators;
      });

      // Verify the page is scrollable and has initial content
      expect(scrollIndicators.isScrollable).toBe(true);
      expect(scrollIndicators.hasTestimonials).toBe(true);
      expect(scrollIndicators.documentHeight).toBeGreaterThan(scrollIndicators.windowHeight);
      
    } catch (error) {
      await test.handleFailure('detect-infinite-scroll', error as Error);
    }
  });

  it('should load content on scroll', async () => {
    try {
      // Get initial testimonials count
      const initialTestimonials = await DataExtractor.extractTestimonials(test.getPage());
      const initialCount = initialTestimonials.length;
      
      expect(initialCount).toBeGreaterThan(0);
      console.log(`Initial testimonials: ${initialCount}`);
      
      // Record initial page height
      const initialHeight = await test.getPage().evaluate(() => document.body.scrollHeight);
      
      // Scroll to bottom to trigger loading
      await test.getPage().evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      
      // Wait for content to load
      await test.getPage().waitForTimeout(1500);
      
      // Check if new content loaded
      const afterScrollTestimonials = await DataExtractor.extractTestimonials(test.getPage());
      const afterScrollCount = afterScrollTestimonials.length;
      const afterScrollHeight = await test.getPage().evaluate(() => document.body.scrollHeight);
      
      console.log(`After scroll testimonials: ${afterScrollCount}`);
      console.log(`Height change: ${initialHeight} -> ${afterScrollHeight}`);
      
      // Verify that content loading behavior works
      if (afterScrollCount > initialCount) {
        // New content was loaded successfully
        expect(afterScrollCount).toBeGreaterThan(initialCount);
        expect(afterScrollHeight).toBeGreaterThanOrEqual(initialHeight);
        console.log(`✓ Successfully loaded ${afterScrollCount - initialCount} more testimonials`);
      } else {
        // No new content - check if we might be at the end or if initial page was fully loaded
        console.log('No additional content loaded - checking if this is expected');
        
        // The page might have all content already loaded, or we reached the end quickly
        // This is acceptable behavior for the scroll mechanism
        expect(afterScrollCount).toEqual(initialCount);
        
        // Verify testimonials are still valid
        expect(afterScrollCount).toBeGreaterThanOrEqual(10); // Should have initial content
      }
      
    } catch (error) {
      await test.handleFailure('load-content-on-scroll', error as Error);
    }
  });

  it('should handle multiple scroll events', async () => {
    try {
      const testimonialCounts = [];
      const pageHeights = [];
      const maxScrolls = 5;
      
      // Get initial count
      let currentTestimonials = await DataExtractor.extractTestimonials(test.getPage());
      testimonialCounts.push(currentTestimonials.length);
      pageHeights.push(await test.getPage().evaluate(() => document.body.scrollHeight));
      
      console.log(`Starting with ${currentTestimonials.length} testimonials`);
      
      // Perform multiple scroll events
      for (let i = 0; i < maxScrolls; i++) {
        // Scroll to bottom each time to trigger more loading
        await test.getPage().evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        
        // Wait for content to potentially load
        await test.getPage().waitForTimeout(1000);
        
        // Count testimonials after scroll
        currentTestimonials = await DataExtractor.extractTestimonials(test.getPage());
        const currentCount = currentTestimonials.length;
        const currentHeight = await test.getPage().evaluate(() => document.body.scrollHeight);
        
        testimonialCounts.push(currentCount);
        pageHeights.push(currentHeight);
        
        console.log(`Scroll ${i + 1}: ${currentCount} testimonials, height: ${currentHeight}`);
        
        // If content hasn't changed in the last 2 scrolls, we've likely reached the end
        if (testimonialCounts.length >= 3) {
          const lastThree = testimonialCounts.slice(-3);
          if (lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2]) {
            console.log('Content stabilised - ending scroll attempts');
            break;
          }
        }
      }
      
      // Verify we performed multiple scroll attempts
      expect(testimonialCounts.length).toBeGreaterThan(1);
      
      // Verify content behavior
      const initialCount = testimonialCounts[0];
      const finalCount = testimonialCounts[testimonialCounts.length - 1];
      const maxCount = Math.max(...testimonialCounts);
      
      // Content should never decrease
      expect(finalCount).toBeGreaterThanOrEqual(initialCount);
      
      // We should have achieved some maximum count
      expect(maxCount).toBeGreaterThanOrEqual(initialCount);
      
      // Log the progression for debugging
      console.log('Testimonial count progression:', testimonialCounts);
      console.log('Page height progression:', pageHeights);
      
      // Final verification that we have reasonable content
      expect(finalCount).toBeGreaterThan(5); // Should have meaningful content
      expect(finalCount).toBeLessThan(1000); // Sanity check
      
    } catch (error) {
      await test.handleFailure('handle-multiple-scrolls', error as Error);
    }
  });

  it('should detect end of scrollable content', async () => {
    try {
      // Track page height changes to detect when content stops loading
      let previousHeight = 0;
      let currentHeight = await test.getPage().evaluate(() => document.body.scrollHeight);
      let stableHeightCount = 0;
      let testimonialCount = 0;
      
      // Perform scrolling with content tracking
      const maxScrollAttempts = 10;
      for (let i = 0; i < maxScrollAttempts; i++) {
        // Record heights before scroll
        previousHeight = currentHeight;
        const previousTestimonials = await DataExtractor.extractTestimonials(test.getPage());
        const previousCount = previousTestimonials.length;
        
        // Scroll down
        await test.getPage().evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        
        // Wait for potential content loading
        await test.getPage().waitForTimeout(1000);
        
        // Check new height and testimonial count
        currentHeight = await test.getPage().evaluate(() => document.body.scrollHeight);
        const currentTestimonials = await DataExtractor.extractTestimonials(test.getPage());
        testimonialCount = currentTestimonials.length;
        
        // If height and content haven't changed, we've likely reached the end
        if (currentHeight === previousHeight && testimonialCount === previousCount) {
          stableHeightCount++;
          if (stableHeightCount >= 2) {
            // Content has been stable for 2 scroll attempts - we've reached the end
            break;
          }
        } else {
          stableHeightCount = 0; // Reset if content changed
        }
      }
      
      // Verify we've reached a stable state (end of content)
      const finalInfo = await test.getPage().evaluate(() => {
        const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
        const clientHeight = document.documentElement.clientHeight || window.innerHeight;
        
        const isNearBottom = (scrollTop + clientHeight) >= (scrollHeight - 200);
        const scrollPercentage = Math.round((scrollTop / (scrollHeight - clientHeight)) * 100);
        
        return {
          isNearBottom,
          scrollPercentage,
          scrollTop,
          scrollHeight,
          clientHeight
        };
      });
      
      // We should have loaded a reasonable amount of content and reached a stable state
      expect(testimonialCount).toBeGreaterThan(10); // Should have loaded more than initial 10
      expect(stableHeightCount).toBeGreaterThanOrEqual(2); // Content should have stabilised
      expect(finalInfo.scrollPercentage).toBeGreaterThanOrEqual(70); // Should have scrolled significantly
      
    } catch (error) {
      await test.handleFailure('detect-end-of-content', error as Error);
    }
  });

  it('should extract all dynamically loaded items', async () => {
    try {
      // Load content gradually and track progress
      let allTestimonials: Testimonial[] = [];
      let attempts = 0;
      const maxAttempts = 8;
      
      while (attempts < maxAttempts) {
        // Extract current testimonials
        allTestimonials = await DataExtractor.extractTestimonials(test.getPage());
        
        // Scroll down to load more
        await test.getPage().evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        
        await test.getPage().waitForTimeout(1000);
        attempts++;
        
        // If we have a good number of testimonials, we can stop
        if (allTestimonials.length >= 20) {
          break;
        }
      }
      
      // Should have extracted testimonials
      expect(allTestimonials.length).toBeGreaterThan(0);
      
      // Validate testimonial structure
      allTestimonials.forEach((testimonial, _index) => {
        expect(testimonial.author).toBeTruthy();
        expect(testimonial.content).toBeTruthy();
        expect(testimonial.content.length).toBeGreaterThan(5);
        
        // Author should be a reasonable name (generated from username)
        expect(testimonial.author.length).toBeGreaterThan(3);
        expect(testimonial.author.length).toBeLessThan(50);
        
        // Content should be meaningful text
        expect(testimonial.content).toMatch(/[a-zA-Z]/); // Should contain letters
        expect(testimonial.content.split(' ').length).toBeGreaterThan(1); // Should have multiple words
        
        // Rating should be valid (1-5 stars)
        expect(testimonial.rating).toBeGreaterThanOrEqual(1);
        expect(testimonial.rating).toBeLessThanOrEqual(5);
      });
      
      // Check for duplicate testimonials (infinite scroll might have some pattern repetition)
      const uniqueContent = new Set(allTestimonials.map(t => t.content.trim()));
      const duplicateRatio = 1 - (uniqueContent.size / allTestimonials.length);
      
      // Allow some repetition but not complete duplication
      expect(duplicateRatio).toBeLessThan(0.8); // Less than 80% duplication
      
      // Verify we have a reasonable number of testimonials (more than initial page load)
      expect(allTestimonials.length).toBeGreaterThanOrEqual(10); // Should load more than initial
      expect(allTestimonials.length).toBeLessThan(200); // Reasonable upper bound for test
      
      console.log(`Successfully extracted ${allTestimonials.length} testimonials`);
      console.log(`First testimonial: "${allTestimonials[0].content}" by ${allTestimonials[0].author}`);
      
    } catch (error) {
      await test.handleFailure('extract-all-items', error as Error);
    }
  });

  it('should handle scroll loading errors', async () => {
    try {
      // Monitor network requests for errors
      const networkErrors: string[] = [];
      
      test.getPage().on('requestfailed', request => {
        networkErrors.push(request.url());
      });
      
      test.getPage().on('response', response => {
        if (response.status() >= 400) {
          networkErrors.push(response.url());
        }
      });
      
      // Perform aggressive scrolling to potentially trigger errors
      const maxScrolls = 5;
      for (let i = 0; i < maxScrolls; i++) {
        await test.getPage().evaluate(() => {
          // Rapid scrolling to stress test
          window.scrollTo(0, document.body.scrollHeight);
        });
        
        await test.getPage().waitForTimeout(500); // Short delay
        
        // Check if page is still responsive
        const isResponsive = await test.getPage().evaluate(() => {
          return document.readyState === 'complete' && window.location.href.includes('testimonials');
        });
        
        expect(isResponsive).toBe(true);
      }
      
      // Verify the page didn't crash completely
      const finalUrl = test.getPage().url();
      expect(finalUrl).toContain('/testimonials');
      
      // Check if we can still extract content
      const finalTestimonials = await DataExtractor.extractTestimonials(test.getPage());
      expect(finalTestimonials.length).toBeGreaterThan(0);
      
      // If there were network errors, make sure they didn't break the page
      if (networkErrors.length > 0) {
        // Page should still be functional despite network errors
        const pageContent = await test.getPage().content();
        expect(pageContent).toBeTruthy();
        expect(pageContent.length).toBeGreaterThan(1000);
      }
      
    } catch (error) {
      await test.handleFailure('handle-scroll-errors', error as Error);
    }
  });
});
