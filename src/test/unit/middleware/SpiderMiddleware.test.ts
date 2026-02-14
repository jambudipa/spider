/**
 * Spider Middleware Tests
 * Tests for Spider middleware functionality
 */

import { describe, expect, it } from 'vitest';
import { Effect, Layer, Option } from 'effect';
import {
  MiddlewareManager,
  UserAgentMiddleware,
  StatsMiddleware,
} from '../../../lib/Middleware/SpiderMiddleware.js';
import { SpiderRequest, SpiderResponse } from '../../../lib/Middleware/types.js';
import type { PageData } from '../../../lib/PageData/PageData.js';

const makeRequest = (url = 'https://example.com') =>
  SpiderRequest.fromTask({ url, depth: 0 });

const makePageData = (url = 'https://example.com'): PageData => ({
  url,
  html: '<html></html>',
  metadata: {},
  statusCode: 200,
  headers: {},
  fetchedAt: new Date(),
  scrapeDurationMs: 100,
  depth: 0,
});

const makeResponse = (url = 'https://example.com') =>
  SpiderResponse.fromPageData(makePageData(url), 200);

const testLayer = Layer.mergeAll(
  MiddlewareManager.Default,
  UserAgentMiddleware.Default,
  StatsMiddleware.Default
);

const run = <A, E>(
  effect: Effect.Effect<A, E, MiddlewareManager | UserAgentMiddleware | StatsMiddleware>
) => Effect.runPromise(Effect.provide(effect, testLayer));

describe('SpiderMiddleware', () => {
  it('should apply request middleware in forward order', async () => {
    const result = await run(
      Effect.gen(function* () {
        const manager = yield* MiddlewareManager;
        const uaService = yield* UserAgentMiddleware;
        const request = makeRequest();
        const ua = uaService.create('TestBot/1.0');
        return yield* manager.processRequest(request, [ua]);
      })
    );
    const headers = Option.getOrElse(result.headers, () => ({} as Record<string, string>));
    expect(headers['User-Agent']).toBe('TestBot/1.0');
  });

  it('should apply response middleware in reverse order', async () => {
    const result = await run(
      Effect.gen(function* () {
        const manager = yield* MiddlewareManager;
        const statsService = yield* StatsMiddleware;
        const request = makeRequest();
        const response = makeResponse();
        const stats = statsService.create();
        return yield* manager.processResponse(response, request, [stats.middleware]);
      })
    );
    expect(result.pageData.url).toBe('https://example.com');
  });

  it('should handle request middleware that transforms headers', async () => {
    const result = await run(
      Effect.gen(function* () {
        const manager = yield* MiddlewareManager;
        const uaService = yield* UserAgentMiddleware;
        const request = makeRequest().withHeaders({ 'Accept': 'text/html' });
        const ua = uaService.create('Spider/2.0');
        return yield* manager.processRequest(request, [ua]);
      })
    );
    const headers = Option.getOrElse(result.headers, () => ({} as Record<string, string>));
    expect(headers['User-Agent']).toBe('Spider/2.0');
    expect(headers['Accept']).toBe('text/html');
  });

  it('should handle response middleware with stats collection', async () => {
    const stats = await run(
      Effect.gen(function* () {
        const manager = yield* MiddlewareManager;
        const statsService = yield* StatsMiddleware;
        const request = makeRequest();
        const response = makeResponse();
        const s = statsService.create();
        yield* manager.processResponse(response, request, [s.middleware]);
        return yield* s.getStats();
      })
    );
    expect(typeof stats).toBe('object');
  });

  it('should handle empty middleware list gracefully', async () => {
    const result = await run(
      Effect.gen(function* () {
        const manager = yield* MiddlewareManager;
        const request = makeRequest();
        return yield* manager.processRequest(request, []);
      })
    );
    expect(result.task.url).toBe('https://example.com');
  });

  it('should compose multiple middleware in correct order', async () => {
    const result = await run(
      Effect.gen(function* () {
        const manager = yield* MiddlewareManager;
        const uaService = yield* UserAgentMiddleware;
        const request = makeRequest();
        const ua1 = uaService.create('First/1.0');
        const ua2 = uaService.create('Second/2.0');
        // Second middleware runs after first, overwriting User-Agent
        return yield* manager.processRequest(request, [ua1, ua2]);
      })
    );
    const headers = Option.getOrElse(result.headers, () => ({} as Record<string, string>));
    expect(headers['User-Agent']).toBe('Second/2.0');
  });
});
