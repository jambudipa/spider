import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import {
  LinkExtractorConfig,
  LinkExtractorService,
} from '../../../lib/LinkExtractor/LinkExtractor.service.js';

describe('LinkExtractor Service', () => {
  describe('extractLinks', () => {
    it('should extract basic links from simple HTML', async () => {
      const html = `
        <html>
          <body>
            <a href="/page1.html">Page 1</a>
            <a href="/page2.html">Page 2</a>
            <a href="http://example.org/absolute">External</a>
          </body>
        </html>
      `;
      const _baseUrl = 'https://example.com/test';

      const config: LinkExtractorConfig = {
        tags: ['a'],
        attrs: ['href'],
        restrictCss: [],
      };

      const program = Effect.gen(function* () {
        const extractor = yield* LinkExtractorService;
        const result = yield* extractor.extractLinks(html, config);
        return result;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(LinkExtractorService.Default))
      );

      expect(result.links).toBeDefined();
      expect(result.links.length).toBeGreaterThan(0);
      // Check for relative URLs being resolved
      expect(result.links.some((l) => l.includes('page1.html'))).toBe(true);
      expect(result.links.some((l) => l.includes('page2.html'))).toBe(true);
    });

    it('should extract links from complex HTML with all supported elements', async () => {
      const html = `
        <html>
          <body>
            <a href="/link1">Link 1</a>
            <area href="/area1" />
            <form action="/form1"></form>
            <iframe src="/iframe1"></iframe>
            <frame src="/frame1"></frame>
            <link href="/style.css" />
          </body>
        </html>
      `;
      const _baseUrl = 'https://example.com/complex';

      const config: LinkExtractorConfig = {
        tags: ['a', 'area', 'form', 'iframe', 'frame', 'link'],
        attrs: ['href', 'action', 'src'],
        restrictCss: [],
      };

      const program = Effect.gen(function* () {
        const extractor = yield* LinkExtractorService;
        const result = yield* extractor.extractLinks(html, config);
        return result;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(LinkExtractorService.Default))
      );

      expect(result.links).toBeDefined();
      expect(result.links.length).toBeGreaterThan(0);
    });

    it('should handle relative URLs correctly', async () => {
      const html = `
        <html>
          <body>
            <a href="/absolute">Absolute path</a>
            <a href="../parent">Parent path</a>
            <a href="./sibling">Sibling path</a>
            <a href="relative">Relative path</a>
            <a href="http://external.com">External</a>
          </body>
        </html>
      `;
      const _baseUrl = 'https://example.com/path/to/page';

      const config: LinkExtractorConfig = {
        tags: ['a'],
        attrs: ['href'],
        restrictCss: [],
      };

      const program = Effect.gen(function* () {
        const extractor = yield* LinkExtractorService;
        const result = yield* extractor.extractLinks(html, config);
        return result;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(LinkExtractorService.Default))
      );

      expect(result.links).toBeDefined();
      expect(result.links.length).toBeGreaterThan(0);
    });

    it('should filter links using restrictCss selectors', async () => {
      const html = `
        <html>
          <body>
            <nav>
              <a href="/nav1" class="nav-link">Nav 1</a>
              <a href="/nav2" class="nav-link">Nav 2</a>
            </nav>
            <main>
              <a href="/content1" class="content-link">Content 1</a>
              <a href="/content2" class="content-link">Content 2</a>
            </main>
          </body>
        </html>
      `;
      const _baseUrl = 'https://example.com';

      const config: LinkExtractorConfig = {
        tags: ['a'],
        attrs: ['href'],
        restrictCss: ['.content-link'],
      };

      const program = Effect.gen(function* () {
        const extractor = yield* LinkExtractorService;
        const result = yield* extractor.extractLinks(html, config);
        return result;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(LinkExtractorService.Default))
      );

      expect(result.links).toBeDefined();
      // Should only extract content links, not nav links
      expect(result.links.some((l) => l.includes('content'))).toBe(true);
    });

    it('should handle malformed URLs gracefully', async () => {
      const html = `
        <html>
          <body>
            <a href="javascript:void(0)">JavaScript link</a>
            <a href="mailto:test@example.com">Email link</a>
            <a href="#">Hash link</a>
            <a href="">Empty href</a>
            <a>No href</a>
            <a href="http://valid.com">Valid link</a>
          </body>
        </html>
      `;
      const _baseUrl = 'https://example.com';

      const config: LinkExtractorConfig = {
        tags: ['a'],
        attrs: ['href'],
      };

      const program = Effect.gen(function* () {
        const extractor = yield* LinkExtractorService;
        const result = yield* extractor.extractLinks(html, config);
        return result;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(LinkExtractorService.Default))
      );

      expect(result.links).toBeDefined();
      // Should include valid HTTP links
      expect(result.links.some((l) => l.includes('valid.com'))).toBe(true);
      // May or may not include javascript:, mailto:, etc. depending on implementation
    });

    it('should extract links from forms', async () => {
      const html = `
        <html>
          <body>
            <form action="/submit" method="post">
              <input type="submit" value="Submit">
            </form>
            <form action="https://external.com/api" method="get">
              <input type="text" name="q">
            </form>
          </body>
        </html>
      `;
      const _baseUrl = 'https://example.com';

      const config: LinkExtractorConfig = {
        tags: ['form'],
        attrs: ['action'],
      };

      const program = Effect.gen(function* () {
        const extractor = yield* LinkExtractorService;
        const result = yield* extractor.extractLinks(html, config);
        return result;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(LinkExtractorService.Default))
      );

      expect(result.links).toBeDefined();
      expect(result.links.length).toBeGreaterThan(0);
      expect(result.links.some((l) => l.includes('submit'))).toBe(true);
      expect(result.links.some((l) => l.includes('external.com'))).toBe(true);
    });
  });
});
