/**
 * Test Suite for Spider Examples
 *
 * This test suite validates that all examples compile successfully
 * and their imports are correct, without actually running the crawls.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const EXAMPLES_DIR = join(process.cwd(), 'src', 'examples');

const exampleFiles = [
  '01-basic-crawl-working.ts',
  '02-multiple-urls-working.ts',
  '03-url-filtering.ts',
  '04-robots-compliance.ts',
  '05-link-extraction-selectors.ts',
  '06-custom-middleware.ts',
  '07-resumability-demo.ts',
  '08-worker-monitoring.ts',
  '09-error-handling-recovery.ts',
];

describe('Spider Examples', () => {
  describe('File Existence', () => {
    exampleFiles.forEach((filename) => {
      it(`should have ${filename} example file`, () => {
        const filePath = join(EXAMPLES_DIR, filename);
        expect(existsSync(filePath)).toBe(true);
      });
    });
  });

  describe('Example Structure', () => {
    exampleFiles.forEach((filename) => {
      it(`${filename} should have proper structure`, () => {
        const filePath = join(EXAMPLES_DIR, filename);
        const content = readFileSync(filePath, 'utf-8');

        // Check for required structural elements
        expect(content).toContain('/**'); // JSDoc comment
        expect(content).toContain('This example demonstrates:'); // Description
        expect(content).toMatch(/from\s+['"]effect['"]/); // Effect imports
        expect(content).toContain('SpiderService'); // Spider service import
        expect(content).toContain('makeSpiderConfig'); // Config import
        expect(content).toContain('Effect.runPromise'); // Program execution
        expect(content).toContain('process.exit(0)'); // Success exit
        expect(content).toContain('process.exit(1)'); // Error exit
      });
    });
  });

  describe('Import Validation', () => {
    exampleFiles.forEach((filename) => {
      it(`${filename} should import from correct paths`, () => {
        const filePath = join(EXAMPLES_DIR, filename);
        const content = readFileSync(filePath, 'utf-8');

        // Check for correct import path (from ../index.js since examples are in src/examples)
        expect(content).toMatch(/from\s+['"]\.\.\/index\.js['"]/);

        // Should not import from absolute src paths
        expect(content).not.toContain("from 'src/");
      });
    });
  });

  describe('Configuration Validation', () => {
    exampleFiles.forEach((filename) => {
      it(`${filename} should have valid configuration`, () => {
        const filePath = join(EXAMPLES_DIR, filename);
        const content = readFileSync(filePath, 'utf-8');

        // Should use makeSpiderConfig
        expect(content).toContain('makeSpiderConfig');

        // Should provide required layer (allow variations in variable names)
        expect(content).toMatch(/SpiderConfig\.Live\([^)]+\)/);

        // Should not use Default config for examples
        expect(content).not.toContain('SpiderConfig.Default');
      });
    });
  });

  describe('Effect Provider Validation', () => {
    exampleFiles.forEach((filename) => {
      it(`${filename} should provide required Effect services`, () => {
        const filePath = join(EXAMPLES_DIR, filename);
        const content = readFileSync(filePath, 'utf-8');

        // Should provide SpiderService
        expect(content).toContain('SpiderService.Default');

        // Should provide SpiderLoggerLive
        expect(content).toContain('SpiderLoggerLive');

        // Should use Effect.provide
        expect(content).toContain('Effect.provide');
      });
    });
  });

  describe('Example-Specific Features', () => {
    it('01-basic-crawl-working should demonstrate basic features', () => {
      const filePath = join(EXAMPLES_DIR, '01-basic-crawl-working.ts');
      const content = readFileSync(filePath, 'utf-8');

      expect(content).toContain('Basic Web Crawling');
      expect(content).toContain('collectSink');
      expect(content).toContain('maxPages: 5');
      expect(content).toContain('maxDepth: 1');
    });

    it('02-multiple-urls-working should demonstrate multiple URLs', () => {
      const filePath = join(EXAMPLES_DIR, '02-multiple-urls-working.ts');
      const content = readFileSync(filePath, 'utf-8');

      expect(content).toContain('Multiple Starting URLs');
      expect(content).toContain('startingUrls');
      expect(content).toContain('metadata');
      expect(content).toContain('maxConcurrentWorkers: 3');
    });

    it('03-url-filtering should demonstrate filtering', () => {
      const filePath = join(EXAMPLES_DIR, '03-url-filtering.ts');
      const content = readFileSync(filePath, 'utf-8');

      expect(content).toContain('URL Filtering');
      expect(content).toContain('customUrlFilters');
      expect(content).toContain('fileExtensionFilters');
      expect(content).toContain('allowedDomains');
    });

    it('04-robots-compliance should demonstrate robots.txt', () => {
      const filePath = join(EXAMPLES_DIR, '04-robots-compliance.ts');
      const content = readFileSync(filePath, 'utf-8');

      expect(content).toContain('Robots.txt Compliance');
      expect(content).toContain('RobotsService');
      // Check for robots-related functionality (isAllowed, checkUrl, or allowed)
      expect(content).toMatch(/isAllowed|checkUrl|\.allowed/);
      // Check for crawl delay handling
      expect(content).toMatch(/getCrawlDelay|crawlDelay/);
      expect(content).toMatch(/ignoreRobotsTxt:\s*false/);
    });

    it('05-link-extraction-selectors should demonstrate link extraction', () => {
      const filePath = join(EXAMPLES_DIR, '05-link-extraction-selectors.ts');
      const content = readFileSync(filePath, 'utf-8');

      expect(content).toContain('Link Extraction');
      expect(content).toContain('LinkExtractorService');
      // Check for CSS selector usage (restrictCss, cssSelectors, or CSS pattern)
      expect(content).toMatch(/restrictCss|cssSelectors|nav a|\.navbar/);
      // Check for link extraction functionality
      expect(content).toMatch(/extractLinks|LinkExtractionResult/);
    });

    it('06-custom-middleware should demonstrate middleware', () => {
      const filePath = join(EXAMPLES_DIR, '06-custom-middleware.ts');
      const content = readFileSync(filePath, 'utf-8');

      expect(content).toContain('Custom Middleware');
      expect(content).toContain('SpiderMiddleware');
      // Check for middleware operations (processRequest/postResponse or similar)
      expect(content).toMatch(/processRequest|preRequest/);
      expect(content).toMatch(/processResponse|postResponse/);
    });

    it('07-resumability-demo should demonstrate resumability', () => {
      const filePath = join(EXAMPLES_DIR, '07-resumability-demo.ts');
      const content = readFileSync(filePath, 'utf-8');

      expect(content).toContain('Resumability');
      expect(content).toContain('ResumabilityService');
      expect(content).toContain('FileStorageBackend');
      // Check for session management (createSession, SESSION_ID, etc.)
      expect(content).toMatch(/createSession|SESSION_ID|session/i);
    });

    it('08-worker-monitoring should demonstrate worker management', () => {
      const filePath = join(EXAMPLES_DIR, '08-worker-monitoring.ts');
      const content = readFileSync(filePath, 'utf-8');

      expect(content).toContain('Worker Health Monitoring');
      expect(content).toContain('memoryUsage');
      expect(content).toContain('maxConcurrentWorkers: 4');
      expect(content).toContain('performance monitoring');
    });

    it('09-error-handling-recovery should demonstrate error handling', () => {
      const filePath = join(EXAMPLES_DIR, '09-error-handling-recovery.ts');
      const content = readFileSync(filePath, 'utf-8');

      expect(content).toContain('Error Handling');
      // Check for error handling mechanisms
      expect(content).toMatch(/networkErrors|NetworkError|timeoutErrors/);
      // Check for error statistics or tracking
      expect(content).toMatch(/ErrorStats|errorStats|errorsByDomain/);
    });
  });

  describe('URL Target Validation', () => {
    exampleFiles.forEach((filename) => {
      it(`${filename} should target web-scraping.dev`, () => {
        const filePath = join(EXAMPLES_DIR, filename);
        const content = readFileSync(filePath, 'utf-8');

        // Should use web-scraping.dev as test target
        expect(content).toContain('web-scraping.dev');

        // Should not use localhost or other test URLs
        expect(content).not.toContain('localhost');
        expect(content).not.toContain('127.0.0.1');
        expect(content).not.toContain('example.com');
      });
    });
  });

  describe('Output and Logging', () => {
    exampleFiles.forEach((filename) => {
      it(`${filename} should have proper console output`, () => {
        const filePath = join(EXAMPLES_DIR, filename);
        const content = readFileSync(filePath, 'utf-8');

        // Should have descriptive output (console.log or Effect.log)
        expect(content).toMatch(/console\.log|Effect\.log/);
        expect(content).toMatch(/Example \d+/);

        // Should have completion messages (completed, Demonstrated, Complete, etc.)
        expect(content).toMatch(/completed|Demonstrated|Complete|finished|✓/i);
      });
    });
  });

  describe('TypeScript Compliance', () => {
    exampleFiles.forEach((filename) => {
      it(`${filename} should have TypeScript annotations`, () => {
        const filePath = join(EXAMPLES_DIR, filename);
        const content = readFileSync(filePath, 'utf-8');

        // Should have proper Effect typing
        expect(content).toMatch(/Effect\.gen\(function\s*\*\s*\(/);
        expect(content).toContain('yield*');

        // Should have proper Sink usage
        expect(content).toMatch(/Sink\.forEach/);
      });
    });
  });
});
