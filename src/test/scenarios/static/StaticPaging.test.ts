/**
 * StaticPaging Scenario Tests
 * Tests for the StaticPaging scenario: static HTML pagination on web-scraping.dev/products
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Effect } from 'effect';
import { StaticScenarioBase, runEffect } from '../../helpers/BaseScenarioTest';
import { DataExtractor, Product } from '../../helpers/DataExtractor';
import { TestHelper } from '../../helpers/TestHelper';

class StaticPagingTest extends StaticScenarioBase {
  protected products: Product[] = [];
  protected paginationLinks: string[] = [];
  
  constructor() {
    super('static-paging');
  }

  get getProducts() {
    return this.products;
  }

  get getPaginationLinks() {
    return this.paginationLinks;
  }
  
  async extractProductsFromCurrentPage(): Promise<Product[]> {
    return await runEffect(DataExtractor.extractProducts(this.page));
  }

  async extractPaginationLinks(): Promise<string[]> {
    return await runEffect(DataExtractor.extractPaginationLinks(this.page));
  }
  
  async navigateAllPages(): Promise<void> {
    const visitedUrls = new Set<string>();
    const toVisit: string[] = [`${this.getBaseUrl()}/products`];

    while (toVisit.length > 0) {
      const url = toVisit.shift()!;

      if (visitedUrls.has(url)) continue;
      visitedUrls.add(url);

      await runEffect(this.getContext().adapter.goto(url));
      
      // Extract products from current page
      const pageProducts = await this.extractProductsFromCurrentPage();
      this.products.push(...pageProducts);
      
      // Extract pagination links
      const links = await this.extractPaginationLinks();
      const productLinks = links.filter(link => link.includes('/products'));
      
      for (const link of productLinks) {
        if (!visitedUrls.has(link) && !toVisit.includes(link)) {
          toVisit.push(link);
        }
      }
      
      // Limit to prevent infinite loops
      if (visitedUrls.size >= 10) break;
    }
  }
  
  validateScenario() {
    const self = this;
    return Effect.gen(function* () {
      yield* StaticScenarioBase.prototype.validateScenario.call(self);

      // Validate we found products
      expect(self.products.length).toBeGreaterThan(0);

      // Validate product structure
      for (const product of self.products.slice(0, 5)) {
        expect(product.title).toBeTruthy();
        expect(product.price).toBeGreaterThan(0);
      }
    });
  }
}

describe('StaticPaging Scenario Tests - Real Site', () => {
  let test: StaticPagingTest;
  
  beforeAll(async () => {
    test = new StaticPagingTest();
    await test.setup();
  });
  
  afterAll(async () => {
    await test.cleanup();
  });
  
  it('should extract products from products page', async () => {
    await test.navigateToScenario('/products');
    const products = await test.extractProductsFromCurrentPage();
    
    expect(products).toBeDefined();
    expect(products.length).toBeGreaterThan(0);
    
    // Validate first product structure
    const firstProduct = products[0];
    expect(firstProduct).toHaveProperty('title');
    expect(firstProduct).toHaveProperty('price');
    expect(firstProduct.price).toBeGreaterThan(0);
  });
  
  it('should detect and follow pagination links', async () => {
    await test.navigateToScenario('/products');
    const links = await test.extractPaginationLinks();
    
    expect(links).toBeDefined();
    expect(links.length).toBeGreaterThan(0);
    
    // Check for page 2 link
    const hasNextPage = links.some(link => 
      link.includes('page=2') || link.includes('/products/2')
    );
    expect(hasNextPage).toBe(true);
  });
  
  it('should extract product details', async () => {
    await test.navigateToScenario('/product/1');
    const productDetails = await runEffect(DataExtractor.extractProductDetails(test.getPage()));

    expect(productDetails).toBeDefined();
    expect(productDetails.title).toBeTruthy();
    expect(productDetails.price).toBeGreaterThan(0);
    expect(productDetails.description).toBeTruthy();
  });
  
  it('should handle pagination navigation', async () => {
    await test.navigateAllPages();
    
    // Should have collected products from multiple pages
    expect(test.getProducts.length).toBeGreaterThanOrEqual(20);
    
    // Validate all products have required fields
    for (const product of test.getProducts) {
      expect(product.title).toBeTruthy();
      expect(product.price).toBeGreaterThanOrEqual(0);
    }
  });
  
  it('should validate extracted data', async () => {
    await test.navigateToScenario('/products');
    const products = await test.extractProductsFromCurrentPage();
    
    for (const product of products) {
      const validation = TestHelper.validateDataStructure(product as unknown as Record<string, unknown>, ['title', 'price']);
      expect(validation.valid).toBe(true);
      expect(validation.missing).toHaveLength(0);
    }
  });
  
  it('should handle missing pagination gracefully', async () => {
    // Navigate to a page that might not have pagination
    await test.navigateToScenario('/product/1');
    const links = await test.extractPaginationLinks();
    
    // Should return empty array or few links, not error
    expect(Array.isArray(links)).toBe(true);
  });
});
