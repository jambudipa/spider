import { describe, expect, it } from 'vitest';
import { HashMap, MutableRef, Option } from 'effect';
import {
  resolveUserAgent,
  type UserAgentStrategy,
} from '../../../lib/Config/SpiderConfig.service.js';

const newCache = () =>
  MutableRef.make(HashMap.empty<string, string>());

describe('resolveUserAgent', () => {
  describe('static strategy', () => {
    it('returns the configured UA for any domain', () => {
      const strategy: UserAgentStrategy = {
        kind: 'static',
        userAgent: 'StaticBot/1.0',
      };
      const cache = newCache();
      expect(resolveUserAgent(strategy, 'example.com', cache)).toBe('StaticBot/1.0');
      expect(resolveUserAgent(strategy, 'other.org', cache)).toBe('StaticBot/1.0');
    });
  });

  describe('custom strategy', () => {
    it('invokes the resolver per call with the URL/domain', () => {
      const strategy: UserAgentStrategy = {
        kind: 'custom',
        resolver: (url) => `Bot-for-${url}`,
      };
      const cache = newCache();
      expect(resolveUserAgent(strategy, 'example.com', cache)).toBe('Bot-for-example.com');
      expect(resolveUserAgent(strategy, 'other.org', cache)).toBe('Bot-for-other.org');
    });
  });

  describe('rotating strategy with perDomain', () => {
    it('returns the same UA for the same domain across multiple calls', () => {
      const strategy: UserAgentStrategy = {
        kind: 'rotating',
        pool: ['UA-A', 'UA-B', 'UA-C', 'UA-D'],
        perDomain: true,
      };
      const cache = newCache();
      const first = resolveUserAgent(strategy, 'example.com', cache);
      const second = resolveUserAgent(strategy, 'example.com', cache);
      const third = resolveUserAgent(strategy, 'example.com', cache);
      expect(first).toBe(second);
      expect(second).toBe(third);
      expect(strategy.pool).toContain(first);
    });

    it('selects independently for different domains', () => {
      const strategy: UserAgentStrategy = {
        kind: 'rotating',
        pool: ['UA-X', 'UA-Y', 'UA-Z'],
        perDomain: true,
      };
      const cache = newCache();
      const a = resolveUserAgent(strategy, 'a.example', cache);
      const b = resolveUserAgent(strategy, 'b.example', cache);
      // Both must come from the pool, both must be cached.
      expect(strategy.pool).toContain(a);
      expect(strategy.pool).toContain(b);
      const cacheNow = MutableRef.get(cache);
      expect(Option.getOrUndefined(HashMap.get(cacheNow, 'a.example'))).toBe(a);
      expect(Option.getOrUndefined(HashMap.get(cacheNow, 'b.example'))).toBe(b);
    });

    it('reuses cached UA even if the pool is later mutated', () => {
      const pool = ['UA-1'];
      const strategy: UserAgentStrategy = {
        kind: 'rotating',
        pool,
        perDomain: true,
      };
      const cache = MutableRef.make(
        HashMap.set(
          HashMap.empty<string, string>(),
          'sticky.example',
          'UA-PREVIOUSLY-CHOSEN'
        )
      );
      // The cache hit short-circuits — pool sampling never runs.
      expect(resolveUserAgent(strategy, 'sticky.example', cache)).toBe(
        'UA-PREVIOUSLY-CHOSEN'
      );
    });
  });

  describe('rotating strategy without perDomain', () => {
    it('returns a UA from the pool but does not cache', () => {
      const strategy: UserAgentStrategy = {
        kind: 'rotating',
        pool: ['UA-1', 'UA-2'],
        perDomain: false,
      };
      const cache = newCache();
      const ua = resolveUserAgent(strategy, 'example.com', cache);
      expect(strategy.pool).toContain(ua);
      expect(HashMap.size(MutableRef.get(cache))).toBe(0);
    });
  });
});
