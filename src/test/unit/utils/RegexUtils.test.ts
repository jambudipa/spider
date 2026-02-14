/**
 * RegexUtils Tests
 * Tests for regex compilation, matching, and utility functions
 */

import { describe, expect, it } from 'vitest';
import { Effect, Option } from 'effect';
import { RegexUtils } from '../../../lib/utils/RegexUtils.js';

const run = <A>(effect: Effect.Effect<A, unknown>) =>
  Effect.runPromise(effect);

describe('RegexUtils', () => {
  describe('compile', () => {
    it('should compile a valid regex pattern', async () => {
      const regex = await run(RegexUtils.compile('\\d+'));
      expect(regex).toBeInstanceOf(RegExp);
    });

    it('should fail on invalid regex pattern', async () => {
      const result = await Effect.runPromiseExit(RegexUtils.compile('[invalid'));
      expect(result._tag).toBe('Failure');
    });
  });

  describe('test', () => {
    it('should return true when pattern matches', async () => {
      expect(await run(RegexUtils.test('\\d+', 'abc123'))).toBe(true);
    });

    it('should return false when pattern does not match', async () => {
      expect(await run(RegexUtils.test('^\\d+$', 'abc'))).toBe(false);
    });

    it('should support flags', async () => {
      expect(await run(RegexUtils.test('hello', 'HELLO', 'i'))).toBe(true);
    });
  });

  describe('findFirst', () => {
    it('should find the first match', async () => {
      const result = await run(RegexUtils.findFirst('(\\d+)', 'abc 123 def 456'));
      expect(Option.isSome(result)).toBe(true);
      if (Option.isSome(result)) {
        expect(result.value.match).toBe('123');
        expect(result.value.index).toBe(4);
      }
    });

    it('should return None when no match', async () => {
      const result = await run(RegexUtils.findFirst('\\d+', 'no numbers here'));
      expect(Option.isNone(result)).toBe(true);
    });
  });

  describe('findAll', () => {
    it('should find all matches', async () => {
      const results = await run(RegexUtils.findAll('\\d+', 'a1 b2 c3'));
      expect(results).toHaveLength(3);
      expect(results.map((m) => m.match)).toEqual(['1', '2', '3']);
    });
  });

  describe('replace', () => {
    it('should replace first occurrence', async () => {
      const result = await run(RegexUtils.replace('\\d+', 'a1 b2', 'X'));
      expect(result.replaced).toBe('aX b2');
    });
  });

  describe('replaceAll', () => {
    it('should replace all occurrences', async () => {
      const result = await run(RegexUtils.replaceAll('\\d+', 'a1 b2 c3', 'X'));
      expect(result.replaced).toBe('aX bX cX');
    });
  });

  describe('split', () => {
    it('should split string by pattern', async () => {
      const parts = await run(RegexUtils.split('[,;]\\s*', 'a, b; c'));
      expect(parts).toEqual(['a', 'b', 'c']);
    });
  });

  describe('escape', () => {
    it('should escape special regex characters', async () => {
      const escaped = await run(RegexUtils.escape('hello.world (test)'));
      expect(escaped).toContain('\\.');
      expect(escaped).toContain('\\(');
    });
  });

  describe('count', () => {
    it('should count pattern occurrences', async () => {
      const count = await run(RegexUtils.count('\\d+', 'a1 b2 c3 d4'));
      expect(count).toBe(4);
    });
  });

  describe('isValid', () => {
    it('should return true for valid patterns', async () => {
      expect(await run(RegexUtils.isValid('\\d+'))).toBe(true);
    });

    it('should return false for invalid patterns', async () => {
      expect(await run(RegexUtils.isValid('[invalid'))).toBe(false);
    });
  });

  describe('isEmail', () => {
    it('should validate correct email addresses', async () => {
      expect(await run(RegexUtils.isEmail('user@example.com'))).toBe(true);
    });

    it('should reject invalid email addresses', async () => {
      expect(await run(RegexUtils.isEmail('not-an-email'))).toBe(false);
    });
  });

  describe('isUrl', () => {
    it('should validate correct URLs', async () => {
      expect(await run(RegexUtils.isUrl('https://example.com'))).toBe(true);
    });

    it('should reject invalid URLs', async () => {
      expect(await run(RegexUtils.isUrl('not a url'))).toBe(false);
    });
  });
});
