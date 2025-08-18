/**
 * Data Extractor Utilities
 * Specialised extraction methods for web-scraping.dev scenarios
 */

import { Page } from 'playwright';
import * as cheerio from 'cheerio';

export interface Product {
  id?: string;
  title: string;
  price: number;
  description?: string;
  image?: string;
  url?: string;
  inStock?: boolean;
  rating?: number;
  reviews?: number;
}

export interface Testimonial {
  id?: string;
  author: string;
  content: string;
  rating?: number;
  date?: string;
  verified?: boolean;
}

export interface Review {
  id?: string;
  author: string;
  title?: string;
  content: string;
  rating: number;
  date?: string;
  helpful?: number;
  verified?: boolean;
}

export class DataExtractor {
  /**
   * Extract products from listing page
   */
  static async extractProducts(page: Page): Promise<Product[]> {
    return await page.$$eval('.product', elements =>
      elements.map(el => {
        const getText = (selector: string) => 
          el.querySelector(selector)?.textContent?.trim() || '';
        
        const getAttr = (selector: string, attr: string) =>
          el.querySelector(selector)?.getAttribute(attr) || '';
        
        // Extract from web-scraping.dev structure
        const titleElement = el.querySelector('h3 a, .description h3 a');
        const title = titleElement?.textContent?.trim() || '';
        const url = (titleElement as HTMLAnchorElement)?.href || '';
        
        // Extract price from the price element
        const priceText = getText('.price');
        const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;
        
        // Extract description
        const description = getText('.short-description');
        
        // Extract image
        const image = getAttr('img', 'src');
        
        // Extract ID from URL if present
        const idMatch = url.match(/\/product\/(\d+)/);
        const id = idMatch ? idMatch[1] : '';
        
        return {
          id,
          title,
          price,
          description,
          image,
          url,
          inStock: true, // Assume in stock unless marked otherwise
          rating: 0,
          reviews: 0
        };
      })
    );
  }
  
  /**
   * Extract product details from single product page
   */
  static async extractProductDetails(page: Page): Promise<Product> {
    return await page.evaluate(() => {
      const getText = (selector: string) => 
        document.querySelector(selector)?.textContent?.trim() || '';
      
      const getAttr = (selector: string, attr: string) =>
        (document.querySelector(selector) as HTMLElement)?.getAttribute(attr) || '';
      
      const priceText = getText('.price, .product-price, [data-price], .Price');
      const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;
      
      // Check for structured data
      const jsonLd = document.querySelector('script[type="application/ld+json"]');
      let structuredData: any = {};
      if (jsonLd) {
        try {
          structuredData = JSON.parse(jsonLd.textContent || '{}');
        } catch {}
      }
      
      return {
        id: getAttr('[data-product-id]', 'data-product-id') || 
            structuredData['@id'] || '',
        title: getText('h1, .product-title, [data-title]') || 
               structuredData.name || '',
        price: price || structuredData.offers?.price || 0,
        description: getText('.description, .product-description, [data-description]') || 
                     structuredData.description || '',
        image: getAttr('.product-image img, img.main-image', 'src') || 
               structuredData.image || '',
        url: window.location.href,
        inStock: !document.querySelector('.out-of-stock') && 
                 structuredData.offers?.availability !== 'OutOfStock',
        rating: parseFloat(getAttr('[data-rating]', 'data-rating') || 
                structuredData.aggregateRating?.ratingValue || '0'),
        reviews: parseInt(getAttr('[data-reviews]', 'data-reviews') || 
                 structuredData.aggregateRating?.reviewCount || '0')
      };
    });
  }
  
  /**
   * Extract testimonials (for endless scroll)
   */
  static async extractTestimonials(page: Page): Promise<Testimonial[]> {
    return await page.$$eval('.testimonial', elements =>
      elements.map((el, index) => {
        const getText = (selector: string) => 
          el.querySelector(selector)?.textContent?.trim() || '';
        
        // Extract star rating from svg elements
        const ratingEl = el.querySelector('.rating');
        let rating = 0;
        if (ratingEl) {
          // Count filled stars (svg elements in rating span)
          const stars = ratingEl.querySelectorAll('svg');
          rating = stars.length || 0;
        }
        
        // Extract testimonial text from p.text element
        const content = getText('.text, p');
        
        // Generate synthetic author name since the site uses identicons
        const iconElement = el.querySelector('identicon-svg');
        const username = iconElement?.getAttribute('username') || `User ${index}`;
        const author = username.replace('testimonial-', 'User ').replace('-', ' ');
        
        return {
          id: username || `testimonial-${index}`,
          author: author,
          content: content,
          rating,
          date: '', // No dates on this site
          verified: false // No verification badges on this site
        };
      })
    );
  }
  
  /**
   * Extract reviews (for button loading)
   */
  static async extractReviews(page: Page): Promise<Review[]> {
    return await page.$$eval('.review[data-testid="review"]', elements =>
      elements.map(el => {
        const getText = (selector: string) => 
          el.querySelector(selector)?.textContent?.trim() || '';
        
        const getNumber = (selector: string) => {
          const text = getText(selector);
          return parseInt(text.replace(/[^0-9]/g, '')) || 0;
        };
        
        // Extract rating from SVG stars in [data-testid="review-stars"]
        const starsEl = el.querySelector('[data-testid="review-stars"]');
        let rating = 0;
        if (starsEl) {
          // Count filled/active stars or look for data attributes
          const filledStars = starsEl.querySelectorAll('.filled, .active, [fill="#ffc107"]');
          rating = filledStars.length;
          
          // Fallback: try to extract from attributes or text
          if (rating === 0) {
            const ratingText = starsEl.getAttribute('data-rating') || starsEl.textContent || '';
            rating = parseFloat(ratingText) || 0;
          }
        }
        
        // Generate author name from review ID (based on web-scraping.dev pattern)
        const reviewId = el.getAttribute('data-review-id') || '';
        const author = `Reviewer ${reviewId}` || 'Anonymous';
        
        return {
          id: reviewId,
          author,
          title: '', // No titles in this review structure
          content: getText('[data-testid="review-text"]'),
          rating,
          date: getText('[data-testid="review-date"]'),
          helpful: 0, // No helpful counts in this structure
          verified: false // No verification system
        };
      })
    );
  }
  
  /**
   * Extract pagination links
   */
  static async extractPaginationLinks(page: Page): Promise<string[]> {
    return await page.$$eval('a[href*="page"], .pagination a, .pager a', links =>
      links
        .map(link => (link as HTMLAnchorElement).href)
        .filter(href => href && !href.includes('#') && href.includes('/products'))
    );
  }
  
  /**
   * Extract hidden data from page
   */
  static async extractHiddenData(page: Page): Promise<Record<string, any>> {
    return await page.evaluate(() => {
      const data: Record<string, any> = {};
      
      // Extract from data attributes
      document.querySelectorAll('[data-hidden], [data-secret], [data-info]').forEach(el => {
        Array.from(el.attributes).forEach(attr => {
          if (attr.name.startsWith('data-')) {
            data[attr.name] = attr.value;
          }
        });
      });
      
      // Extract from hidden inputs
      document.querySelectorAll('input[type="hidden"]').forEach(input => {
        const name = (input as HTMLInputElement).name;
        const value = (input as HTMLInputElement).value;
        if (name) data[`hidden_${name}`] = value;
      });
      
      // Extract from meta tags
      document.querySelectorAll('meta[property], meta[name]').forEach(meta => {
        const name = meta.getAttribute('property') || meta.getAttribute('name');
        const content = meta.getAttribute('content');
        if (name && content) data[`meta_${name}`] = content;
      });
      
      // Extract from inline scripts
      const scriptData = Array.from(document.querySelectorAll('script:not([src])')).map(script => {
        const match = script.textContent?.match(/window\.__DATA__ = ({.*?});/);
        if (match) {
          try {
            return JSON.parse(match[1]);
          } catch {}
        }
        return null;
      }).filter(Boolean);
      
      if (scriptData.length > 0) {
        data.scriptData = scriptData;
      }
      
      return data;
    });
  }
  
  /**
   * Extract GraphQL data from network requests
   */
  static extractGraphQLData(responseBody: string): any {
    try {
      const parsed = JSON.parse(responseBody);
      return parsed.data || parsed;
    } catch {
      return null;
    }
  }
  
  /**
   * Extract CSRF token
   */
  static async extractCSRFToken(page: Page): Promise<string> {
    // Try multiple common CSRF token locations
    const token = await page.evaluate(() => {
      // Meta tag
      const metaToken = document.querySelector('meta[name="csrf-token"], meta[name="_csrf"]');
      if (metaToken) return metaToken.getAttribute('content');
      
      // Hidden input
      const inputToken = document.querySelector('input[name="csrf_token"], input[name="_csrf"], input[name="csrfToken"]');
      if (inputToken) return (inputToken as HTMLInputElement).value;
      
      // JavaScript variable
      const win = window as any;
      return win.csrfToken || win._csrf || win.CSRF_TOKEN || '';
    });
    
    return token || '';
  }
  
  /**
   * Extract API token from page
   */
  static async extractAPIToken(page: Page): Promise<string> {
    return await page.evaluate(() => {
      // Check window object
      const win = window as any;
      const windowToken = win.apiToken || win.API_TOKEN || win.api_key || win.API_KEY;
      if (windowToken) return windowToken;
      
      // Check localStorage
      const localToken = localStorage.getItem('apiToken') || 
                        localStorage.getItem('api_token') ||
                        localStorage.getItem('token');
      if (localToken) return localToken;
      
      // Check data attributes
      const dataToken = document.querySelector('[data-api-token], [data-api-key]');
      if (dataToken) {
        return dataToken.getAttribute('data-api-token') || 
               dataToken.getAttribute('data-api-key') || '';
      }
      
      // Check inline scripts for token patterns
      const scripts = Array.from(document.querySelectorAll('script:not([src])'));
      for (const script of scripts) {
        const match = script.textContent?.match(/["']?(?:api[_-]?token|api[_-]?key)["']?\s*[:=]\s*["']([^"']+)["']/i);
        if (match) return match[1];
      }
      
      return '';
    });
  }
}