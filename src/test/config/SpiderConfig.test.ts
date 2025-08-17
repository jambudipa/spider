import { describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';
import {
  makeSpiderConfig,
  SpiderConfig,
  SpiderConfigOptions,
} from '../../lib/Config/SpiderConfig.service.js';
import { runEffect } from '../utils/test-helpers.js';

describe('SpiderConfig Service', () => {
  describe('makeSpiderConfig', () => {
    it('should create a valid config with default values', () => {
      const config = makeSpiderConfig();

      expect(config).toBeDefined();
      expect(typeof config.getOptions).toBe('function');
      expect(typeof config.shouldFollowUrl).toBe('function');
      expect(typeof config.getUserAgent).toBe('function');
    });

    it('should merge custom options with defaults', async () => {
      const customOptions: Partial<SpiderConfigOptions> = {
        maxPages: 50,
        maxDepth: 5,
        userAgent: 'CustomBot/1.0',
        requestDelayMs: 500,
      };

      const config = makeSpiderConfig(customOptions);
      const layer = Layer.succeed(SpiderConfig, config);

      const program = Effect.gen(function* () {
        const configService = yield* SpiderConfig;
        const options = yield* configService.getOptions();
        return options;
      });

      const result = await runEffect(program.pipe(Effect.provide(layer)));

      expect(result.maxPages).toBe(50);
      expect(result.maxDepth).toBe(5);
      expect(result.userAgent).toBe('CustomBot/1.0');
      expect(result.requestDelayMs).toBe(500);
    });
  });

  describe('SpiderConfig.Default layer', () => {
    it('should provide default configuration', async () => {
      const program = Effect.gen(function* () {
        const config = yield* SpiderConfig;
        const options = yield* config.getOptions();
        return options;
      });

      const result = await runEffect(
        program.pipe(Effect.provide(SpiderConfig.Default))
      );

      expect(result).toBeDefined();
      expect(result.userAgent).toBe('JambudipaSpider/1.0');
      expect(result.requestDelayMs).toBe(1000);
    });
  });

  describe('URL filtering', () => {
    it('should filter URLs by allowed domains', async () => {
      const config = makeSpiderConfig({
        allowedDomains: ['example.com', 'test.com'],
      });

      const layer = Layer.succeed(SpiderConfig, config);

      const program = Effect.gen(function* () {
        const configService = yield* SpiderConfig;
        const shouldFollow1 = yield* configService.shouldFollowUrl(
          'https://example.com/page'
        );
        const shouldFollow2 = yield* configService.shouldFollowUrl(
          'https://test.com/page'
        );
        const shouldFollow3 = yield* configService.shouldFollowUrl(
          'https://blocked.com/page'
        );
        return { shouldFollow1, shouldFollow2, shouldFollow3 };
      });

      const result = await runEffect(program.pipe(Effect.provide(layer)));

      expect(result.shouldFollow1.follow).toBe(true);
      expect(result.shouldFollow2.follow).toBe(true);
      expect(result.shouldFollow3.follow).toBe(false);
    });

    it('should filter URLs by blocked domains', async () => {
      const config = makeSpiderConfig({
        blockedDomains: ['spam.com', 'malware.com'],
      });

      const layer = Layer.succeed(SpiderConfig, config);

      const program = Effect.gen(function* () {
        const configService = yield* SpiderConfig;
        const shouldFollow1 = yield* configService.shouldFollowUrl(
          'https://good.com/page'
        );
        const shouldFollow2 = yield* configService.shouldFollowUrl(
          'https://spam.com/page'
        );
        const shouldFollow3 = yield* configService.shouldFollowUrl(
          'https://malware.com/page'
        );
        return { shouldFollow1, shouldFollow2, shouldFollow3 };
      });

      const result = await runEffect(program.pipe(Effect.provide(layer)));

      expect(result.shouldFollow1.follow).toBe(true);
      expect(result.shouldFollow2.follow).toBe(false);
      expect(result.shouldFollow3.follow).toBe(false);
    });

    it('should filter malformed URLs when enabled', async () => {
      const config = makeSpiderConfig({
        technicalFilters: {
          filterMalformedUrls: true,
          filterUnsupportedSchemes: true,
          filterLongUrls: true,
          maxUrlLength: 2083,
        },
      });

      const layer = Layer.succeed(SpiderConfig, config);

      const program = Effect.gen(function* () {
        const configService = yield* SpiderConfig;
        const shouldFollow1 = yield* configService.shouldFollowUrl(
          'https://example.com/page'
        );
        const shouldFollow2 =
          yield* configService.shouldFollowUrl('ht!tp://malformed');
        const shouldFollow3 =
          yield* configService.shouldFollowUrl('http://[invalid');
        return { shouldFollow1, shouldFollow2, shouldFollow3 };
      });

      const result = await runEffect(program.pipe(Effect.provide(layer)));

      expect(result.shouldFollow1.follow).toBe(true);
      expect(result.shouldFollow2.follow).toBe(false);
      expect(result.shouldFollow3.follow).toBe(false);
    });

    it('should filter unsupported schemes', async () => {
      const config = makeSpiderConfig({
        technicalFilters: {
          filterUnsupportedSchemes: true,
          filterMalformedUrls: true,
          filterLongUrls: true,
          maxUrlLength: 2083,
        },
      });

      const layer = Layer.succeed(SpiderConfig, config);

      const program = Effect.gen(function* () {
        const configService = yield* SpiderConfig;
        const shouldFollow1 = yield* configService.shouldFollowUrl(
          'https://example.com/page'
        );
        const shouldFollow2 = yield* configService.shouldFollowUrl(
          'http://example.com/page'
        );
        const shouldFollow3 = yield* configService.shouldFollowUrl(
          'ftp://files.com/file'
        );
        const shouldFollow4 = yield* configService.shouldFollowUrl(
          'mailto:test@example.com'
        );
        const shouldFollow5 =
          yield* configService.shouldFollowUrl('javascript:void(0)');
        return {
          shouldFollow1,
          shouldFollow2,
          shouldFollow3,
          shouldFollow4,
          shouldFollow5,
        };
      });

      const result = await runEffect(program.pipe(Effect.provide(layer)));

      expect(result.shouldFollow1.follow).toBe(true);
      expect(result.shouldFollow2.follow).toBe(true);
      expect(result.shouldFollow3.follow).toBe(true); // FTP is allowed by default
      expect(result.shouldFollow4.follow).toBe(false);
      expect(result.shouldFollow5.follow).toBe(false);
    });

    it('should filter long URLs', async () => {
      const config = makeSpiderConfig({
        technicalFilters: {
          filterLongUrls: true,
          maxUrlLength: 100,
          filterUnsupportedSchemes: true,
          filterMalformedUrls: true,
        },
      });

      const layer = Layer.succeed(SpiderConfig, config);

      const shortUrl = 'https://example.com/page';
      const longUrl = 'https://example.com/' + 'a'.repeat(100);

      const program = Effect.gen(function* () {
        const configService = yield* SpiderConfig;
        const shouldFollowShort =
          yield* configService.shouldFollowUrl(shortUrl);
        const shouldFollowLong = yield* configService.shouldFollowUrl(longUrl);
        return { shouldFollowShort, shouldFollowLong };
      });

      const result = await runEffect(program.pipe(Effect.provide(layer)));

      expect(result.shouldFollowShort.follow).toBe(true);
      expect(result.shouldFollowLong.follow).toBe(false);
    });

    it('should apply custom URL filters', async () => {
      const config = makeSpiderConfig({
        customUrlFilters: [/\/admin\//, /\.pdf$/, /test-pattern/],
      });

      const layer = Layer.succeed(SpiderConfig, config);

      const program = Effect.gen(function* () {
        const configService = yield* SpiderConfig;
        const shouldFollow1 = yield* configService.shouldFollowUrl(
          'https://example.com/page'
        );
        const shouldFollow2 = yield* configService.shouldFollowUrl(
          'https://example.com/admin/panel'
        );
        const shouldFollow3 = yield* configService.shouldFollowUrl(
          'https://example.com/document.pdf'
        );
        const shouldFollow4 = yield* configService.shouldFollowUrl(
          'https://example.com/test-pattern-page'
        );
        return { shouldFollow1, shouldFollow2, shouldFollow3, shouldFollow4 };
      });

      const result = await runEffect(program.pipe(Effect.provide(layer)));

      expect(result.shouldFollow1.follow).toBe(true);
      expect(result.shouldFollow2.follow).toBe(false);
      expect(result.shouldFollow3.follow).toBe(false);
      expect(result.shouldFollow4.follow).toBe(false);
    });
  });

  describe('File extension filtering', () => {
    it('should filter files based on extension filters', async () => {
      const config = makeSpiderConfig({
        fileExtensionFilters: {
          filterArchives: true,
          filterImages: true,
          filterAudio: true,
          filterVideo: true,
          filterOfficeDocuments: false,
          filterOther: true,
        },
      });

      const layer = Layer.succeed(SpiderConfig, config);

      const program = Effect.gen(function* () {
        const configService = yield* SpiderConfig;
        const shouldFollow1 = yield* configService.shouldFollowUrl(
          'https://example.com/page.html'
        );
        const shouldFollow2 = yield* configService.shouldFollowUrl(
          'https://example.com/image.jpg'
        );
        const shouldFollow3 = yield* configService.shouldFollowUrl(
          'https://example.com/document.pdf'
        );
        const shouldFollow4 = yield* configService.shouldFollowUrl(
          'https://example.com/archive.zip'
        );
        const shouldFollow5 = yield* configService.shouldFollowUrl(
          'https://example.com/page'
        );
        return {
          shouldFollow1,
          shouldFollow2,
          shouldFollow3,
          shouldFollow4,
          shouldFollow5,
        };
      });

      const result = await runEffect(program.pipe(Effect.provide(layer)));

      expect(result.shouldFollow1.follow).toBe(true);
      expect(result.shouldFollow2.follow).toBe(false);
      expect(result.shouldFollow3.follow).toBe(false);
      expect(result.shouldFollow4.follow).toBe(false);
      expect(result.shouldFollow5.follow).toBe(true);
    });

    it('should handle legacy skipFileExtensions', async () => {
      const config = makeSpiderConfig({
        skipFileExtensions: ['pdf', 'jpg', 'zip', 'exe'],
      });

      const layer = Layer.succeed(SpiderConfig, config);

      const program = Effect.gen(function* () {
        const configService = yield* SpiderConfig;
        const shouldFollow1 = yield* configService.shouldFollowUrl(
          'https://example.com/page.html'
        );
        const shouldFollow2 = yield* configService.shouldFollowUrl(
          'https://example.com/document.pdf'
        );
        const shouldFollow3 = yield* configService.shouldFollowUrl(
          'https://example.com/image.jpg'
        );
        const shouldFollow4 = yield* configService.shouldFollowUrl(
          'https://example.com/app.exe'
        );
        return { shouldFollow1, shouldFollow2, shouldFollow3, shouldFollow4 };
      });

      const result = await runEffect(program.pipe(Effect.provide(layer)));

      expect(result.shouldFollow1.follow).toBe(true);
      expect(result.shouldFollow2.follow).toBe(false);
      expect(result.shouldFollow3.follow).toBe(false);
      expect(result.shouldFollow4.follow).toBe(false);
    });
  });

  describe('URL normalization', () => {
    it('should normalize URLs when enabled', async () => {
      const config = makeSpiderConfig({
        normalizeUrlsForDeduplication: true,
      });

      const layer = Layer.succeed(SpiderConfig, config);

      const program = Effect.gen(function* () {
        const configService = yield* SpiderConfig;
        const shouldNormalize =
          yield* configService.shouldNormalizeUrlsForDeduplication();
        return shouldNormalize;
      });

      const result = await runEffect(program.pipe(Effect.provide(layer)));
      expect(result).toBe(true);
    });

    it('should not normalize URLs when disabled', async () => {
      const config = makeSpiderConfig({
        normalizeUrlsForDeduplication: false,
      });

      const layer = Layer.succeed(SpiderConfig, config);

      const program = Effect.gen(function* () {
        const configService = yield* SpiderConfig;
        const shouldNormalize =
          yield* configService.shouldNormalizeUrlsForDeduplication();
        return shouldNormalize;
      });

      const result = await runEffect(program.pipe(Effect.provide(layer)));
      expect(result).toBe(false);
    });
  });

  describe('Configuration getters', () => {
    it('should return all configuration values correctly', async () => {
      const customOptions: Partial<SpiderConfigOptions> = {
        maxPages: 50,
        maxDepth: 5,
        requestDelayMs: 1000,
        ignoreRobotsTxt: false,
        userAgent: 'TestBot/2.0',
        followRedirects: false,
        normalizeUrlsForDeduplication: true,
        enableResumability: true,
        maxRequestsPerSecondPerDomain: 10,
        maxConcurrentWorkers: 4,
      };

      const config = makeSpiderConfig(customOptions);
      const layer = Layer.succeed(SpiderConfig, config);

      const program = Effect.gen(function* () {
        const configService = yield* SpiderConfig;

        const options = yield* configService.getOptions();
        const userAgent = yield* configService.getUserAgent();
        const requestDelay = yield* configService.getRequestDelay();
        const shouldIgnoreRobots = yield* configService.shouldIgnoreRobotsTxt();
        const maxWorkers = yield* configService.getMaxConcurrentWorkers();
        const shouldNormalize =
          yield* configService.shouldNormalizeUrlsForDeduplication();

        return {
          options,
          userAgent,
          requestDelay,
          shouldIgnoreRobots,
          maxWorkers,
          shouldNormalize,
        };
      });

      const result = await runEffect(program.pipe(Effect.provide(layer)));

      expect(result.options.maxPages).toBe(50);
      expect(result.options.maxDepth).toBe(5);
      expect(result.userAgent).toBe('TestBot/2.0');
      expect(result.requestDelay).toBe(1000);
      expect(result.shouldIgnoreRobots).toBe(false);
      expect(result.maxWorkers).toBe(4);
      expect(result.shouldNormalize).toBe(true);
    });
  });
});
