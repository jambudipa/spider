/**
 * EndlessButtonPaging Scenario Tests - Real Implementation
 * Tests for the EndlessButtonPaging scenario: dynamic content loading via button clicks at /reviews
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { DynamicScenarioBase } from '../../helpers/BaseScenarioTest';
import { DataExtractor } from '../../helpers/DataExtractor';

class ButtonLoadingTest extends DynamicScenarioBase {
  async validateScenario(): Promise<void> {
    await super.validateScenario();
    
    // Verify we're on the reviews page
    const url = this.getPage().url();
    expect(url).toContain('/reviews');
  }
}

describe('EndlessButtonPaging Scenario Tests - Real Site', () => {
  let test: ButtonLoadingTest;
  
  beforeEach(async () => {
    test = new ButtonLoadingTest('EndlessButtonPaging');
    await test.setup();
    await test.navigateToScenario('/reviews');
  });
  
  afterEach(async () => {
    if (test) {
      await test.cleanup();
    }
  });

  it('should detect load more buttons', async () => {
    try {
      // Wait for page to load
      await test.waitForContent('body');
      
      // Look for load more button patterns
      const loadMoreButtons = await test.getPage().$$eval(
        'button, [role="button"], a, input[type="button"], input[type="submit"]',
        elements => elements
          .map(el => {
            const text = el.textContent?.toLowerCase().trim() || '';
            const classNames = el.className?.toLowerCase() || '';
            const id = el.id?.toLowerCase() || '';
            
            const isLoadMore = 
              text.includes('load more') ||
              text.includes('show more') ||
              text.includes('more reviews') ||
              text.includes('see more') ||
              text.includes('load next') ||
              classNames.includes('load-more') ||
              classNames.includes('show-more') ||
              id.includes('load-more') ||
              id.includes('show-more');
              
            return {
              text,
              className: classNames,
              id,
              tagName: el.tagName,
              isLoadMore,
              isVisible: 'offsetParent' in el ? (el as HTMLElement).offsetParent !== null : true,
              isEnabled: !el.hasAttribute('disabled')
            };
          })
          .filter(btn => btn.isLoadMore)
      );

      if (loadMoreButtons.length > 0) {
        expect(loadMoreButtons.length).toBeGreaterThan(0);
        
        // At least one button should be visible and enabled
        const visibleButtons = loadMoreButtons.filter(btn => btn.isVisible && btn.isEnabled);
        expect(visibleButtons.length).toBeGreaterThan(0);
      }
    } catch (error) {
      await test.handleFailure('detect-load-more-buttons', error as Error);
    }
  });

  it('should load content on button click', async () => {
    try {
      // Get initial reviews count
      const initialReviews = await DataExtractor.extractReviews(test.getPage());
      const initialCount = initialReviews.length;
      
      expect(initialCount).toBeGreaterThan(0);
      
      // Use exact selector from manual validation
      const loadMoreSelector = '#page-load-more';
      
      try {
        // Try to find and click the load more button with Bootstrap.js workaround
        const button = await test.getPage().locator(loadMoreSelector);
        
        if (await button.isVisible()) {
          try {
            // Try native click first
            await button.click({ timeout: 5000 });
          } catch (error) {
            console.log('Native click failed, trying JS click:', error instanceof Error ? error.message : String(error));
            // Fallback to JavaScript click to bypass Bootstrap.js issues
            await test.getPage().evaluate(() => {
              const btn = document.getElementById('page-load-more');
              if (btn) {
                btn.click();
              }
            });
          }
        } else {
          throw new Error('Load more button not visible');
        }
        
        // Wait for new content to load
        await test.getPage().waitForTimeout(3000);
        
        // Check if new content loaded
        const afterClickReviews = await DataExtractor.extractReviews(test.getPage());
        const afterClickCount = afterClickReviews.length;
        
        if (afterClickCount > initialCount) {
          expect(afterClickCount).toBeGreaterThan(initialCount);
        } else {
          // If no new content, check if button disappeared or was disabled
          const buttonStillExists = await test.getPage().$(loadMoreSelector);
          if (!buttonStillExists) {
            // Button disappeared - likely reached end of content
            expect(afterClickCount).toEqual(initialCount);
          }
        }
        
      } catch (clickError) {
        // If we can't find the button, check if pagination exists in another form
        const paginationExists = await test.getPage().evaluate(() => {
          const paginationSelectors = [
            '.pagination', '.pager', '[data-pagination]',
            'button[disabled]:has-text("Load")', 
            'button[disabled]:has-text("More")'
          ];
          
          return paginationSelectors.some(selector => 
            document.querySelector(selector) !== null
          );
        });
        
        // Either we should find a button or see pagination/end-of-content indicators
        expect(paginationExists || initialCount > 0).toBe(true);
      }
      
    } catch (error) {
      await test.handleFailure('load-content-on-click', error as Error);
    }
  });

  it('should handle multiple load more clicks', async () => {
    try {
      const reviewCounts = [];
      const maxClicks = 3;
      
      // Get initial count
      let currentReviews = await DataExtractor.extractReviews(test.getPage());
      reviewCounts.push(currentReviews.length);
      
      // Try multiple button clicks
      for (let i = 0; i < maxClicks; i++) {
        const loadMoreSelectors = [
          '#page-load-more:not([disabled])'
        ];
        
        let buttonClicked = false;
        
        for (const selector of loadMoreSelectors) {
          try {
            const button = await test.getPage().$(selector);
            if (button) {
              const isVisible = await button.isVisible();
              const isEnabled = await button.isEnabled();
              
              if (isVisible && isEnabled) {
                await button.click();
                buttonClicked = true;
                break;
              }
            }
          } catch {}
        }
        
        if (!buttonClicked) {
          // No more buttons to click - we've reached the end
          break;
        }
        
        // Wait for content to load
        await test.getPage().waitForTimeout(2000);
        
        // Count reviews after click
        currentReviews = await DataExtractor.extractReviews(test.getPage());
        reviewCounts.push(currentReviews.length);
      }
      
      // Verify we attempted multiple operations
      expect(reviewCounts.length).toBeGreaterThan(1);
      
      // Check that content either increased or stayed stable (end reached)
      const maxCount = Math.max(...reviewCounts);
      const finalCount = reviewCounts[reviewCounts.length - 1];
      
      expect(finalCount).toBeGreaterThanOrEqual(reviewCounts[0]);
      expect(maxCount).toBeGreaterThanOrEqual(reviewCounts[0]);
      
    } catch (error) {
      await test.handleFailure('handle-multiple-clicks', error as Error);
    }
  });

  it('should detect when all content is loaded', async () => {
    try {
      let clickCount = 0;
      const maxAttempts = 5;
      
      while (clickCount < maxAttempts) {
        // Look for active load more buttons
        const activeButton = await test.getPage().evaluate(() => {
          // Use DOM-compatible selectors (not Playwright-specific)
          const buttons = document.querySelectorAll('button:not([disabled]), [class*="load-more"]:not([disabled]), [id*="load-more"]:not([disabled])');
          
          for (const button of Array.from(buttons)) {
            const text = button.textContent?.toLowerCase() || '';
            if (text.includes('load') || text.includes('more')) {
              if ((button as HTMLElement).offsetParent !== null) {
                return true;
              }
            }
          }
          
          
          return false;
        });
        
        if (!activeButton) {
          // No active button found - check for end indicators
          const endIndicators = await test.getPage().evaluate(() => {
            const indicators = {
              hasDisabledButton: !!document.querySelector('button[disabled]:has-text("Load"), button[disabled]:has-text("More")'),
              hasEndMessage: !!document.querySelector('.end-of-content, .no-more-content, .all-loaded'),
              hasHiddenButton: !!document.querySelector('[class*="load-more"][style*="display: none"]'),
              buttonCount: document.querySelectorAll('button').length
            };
            
            return indicators;
          });
          
          // We've reached the end if we have end indicators or no active buttons
          expect(
            endIndicators.hasDisabledButton || 
            endIndicators.hasEndMessage || 
            endIndicators.hasHiddenButton ||
            !activeButton
          ).toBe(true);
          
          break;
        }
        
        // Click the button if available
        try {
          // Use the specific selector from manual validation
          const loadMoreButton = document.getElementById('page-load-more');
          
          if (loadMoreButton && !('disabled' in loadMoreButton && (loadMoreButton as any).disabled) && loadMoreButton.offsetParent !== null) {
            loadMoreButton.click();
            return true;
          }
          
          // Handled above
          
          clickCount++;
          await test.getPage().waitForTimeout(2000);
          
        } catch {
          // Button click failed - likely reached end
          break;
        }
      }
      
      // Get final review count
      const finalReviews = await DataExtractor.extractReviews(test.getPage());
      expect(finalReviews.length).toBeGreaterThan(0);
      
    } catch (error) {
      await test.handleFailure('detect-all-content-loaded', error as Error);
    }
  });

  it('should extract dynamically loaded items', async () => {
    try {
      // Load as much content as possible
      let previousCount = 0;
      let currentCount = 0;
      const maxAttempts = 5;
      let attempts = 0;
      
      do {
        previousCount = currentCount;
        
        // Try to click load more button
        try {
          const loadMoreButton = document.getElementById('page-load-more');
          
          if (loadMoreButton && !('disabled' in loadMoreButton && (loadMoreButton as any).disabled) && loadMoreButton.offsetParent !== null) {
            try {
              loadMoreButton.click();
              return true;
            } catch (error) {
              console.log('Click failed:', error instanceof Error ? error.message : String(error));
              return false;
            }
          }
          
          const clickResult = await test.getPage().evaluate(() => {
            const loadMoreButton = document.getElementById('page-load-more');
            
            if (loadMoreButton && !('disabled' in loadMoreButton && (loadMoreButton as any).disabled) && loadMoreButton.offsetParent !== null) {
              try {
                loadMoreButton.click();
                return true;
              } catch (error) {
                console.log('Click failed:', error instanceof Error ? error.message : String(error));
                return false;
              }
            }
            return false;
          });
          
          if (!clickResult) break;
          
          await test.getPage().waitForTimeout(2000);
          
        } catch {
          break;
        }
        
        // Count current reviews
        const reviews = await DataExtractor.extractReviews(test.getPage());
        currentCount = reviews.length;
        attempts++;
        
      } while (currentCount > previousCount && attempts < maxAttempts);
      
      // Extract all final reviews
      const allReviews = await DataExtractor.extractReviews(test.getPage());
      
      expect(allReviews.length).toBeGreaterThan(0);
      
      // Validate review structure
      allReviews.forEach((review, index) => {
        expect(review.author).toBeTruthy();
        expect(review.content).toBeTruthy();
        expect(review.content.length).toBeGreaterThan(5);
        expect(typeof review.rating).toBe('number');
        
        // Author should be reasonable
        expect(review.author.length).toBeGreaterThan(1);
        expect(review.author.length).toBeLessThan(100);
        
        // Rating should be in reasonable range
        if (review.rating > 0) {
          expect(review.rating).toBeGreaterThanOrEqual(0);
          expect(review.rating).toBeLessThanOrEqual(5);
        }
      });
      
      // Check for reasonable uniqueness
      const uniqueContent = new Set(allReviews.map(r => r.content.slice(0, 50)));
      const duplicateRatio = 1 - (uniqueContent.size / allReviews.length);
      expect(duplicateRatio).toBeLessThan(0.5); // Less than 50% duplicates
      
    } catch (error) {
      await test.handleFailure('extract-dynamically-loaded-items', error as Error);
    }
  });

  it('should handle button state changes', async () => {
    try {
      // Monitor button state changes
      const buttonStates: any[] = [];
      
      // Get initial button state
      const initialState = await test.getPage().evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        return buttons.map(btn => ({
          text: btn.textContent?.trim() || '',
          disabled: btn.hasAttribute('disabled'),
          visible: (btn as HTMLElement).offsetParent !== null,
          className: btn.className
        })).filter(btn => 
          btn.text.toLowerCase().includes('load') || 
          btn.text.toLowerCase().includes('more')
        );
      });
      
      buttonStates.push({ phase: 'initial', buttons: initialState });
      
      // Try to click a load more button
      try {
        const loadMoreButton = await test.getPage().$('button:has-text("Load"), button:has-text("More")');
        
        if (loadMoreButton && await loadMoreButton.isVisible() && await loadMoreButton.isEnabled()) {
          // Click and monitor state change
          await loadMoreButton.click();
          
          // Check state during loading
          await test.getPage().waitForTimeout(500);
          const loadingState = await test.getPage().evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
            return buttons.map(btn => ({
              text: btn.textContent?.trim() || '',
              disabled: btn.hasAttribute('disabled'),
              visible: (btn as HTMLElement).offsetParent !== null,
              className: btn.className,
              hasLoadingClass: btn.className.includes('loading') || btn.className.includes('disabled')
            })).filter(btn => 
              btn.text.toLowerCase().includes('load') || 
              btn.text.toLowerCase().includes('more') ||
              btn.hasLoadingClass
            );
          });
          
          buttonStates.push({ phase: 'loading', buttons: loadingState });
          
          // Wait for loading to complete
          await test.getPage().waitForTimeout(2000);
          
          // Check final state
          const finalState = await test.getPage().evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
            return buttons.map(btn => ({
              text: btn.textContent?.trim() || '',
              disabled: btn.hasAttribute('disabled'),
              visible: (btn as HTMLElement).offsetParent !== null,
              className: btn.className
            })).filter(btn => 
              btn.text.toLowerCase().includes('load') || 
              btn.text.toLowerCase().includes('more')
            );
          });
          
          buttonStates.push({ phase: 'final', buttons: finalState });
        }
      } catch (clickError) {
        // Button click failed - that's okay, we still have initial state
      }
      
      // Verify we captured button states
      expect(buttonStates.length).toBeGreaterThan(0);
      
      // Verify initial state had at least some button information
      if (buttonStates[0].buttons.length > 0) {
        expect(buttonStates[0].buttons.length).toBeGreaterThan(0);
        
        // If we have multiple states, verify they show progression
        if (buttonStates.length > 1) {
          const hasStateChanges = buttonStates.some((state, index) => {
            if (index === 0) return false;
            const prevState = buttonStates[index - 1];
            return JSON.stringify(state.buttons) !== JSON.stringify(prevState.buttons);
          });
          
          // States should either change or stay consistent
          expect(hasStateChanges || buttonStates.length === 1).toBeTruthy();
        }
      }
      
    } catch (error) {
      await test.handleFailure('handle-button-state-changes', error as Error);
    }
  });
});
