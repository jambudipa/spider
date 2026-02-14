/**
 * JsonUtils Tests
 * Tests for JSON parsing, stringification, and manipulation utilities
 */

import { describe, expect, it } from 'vitest';
import { Effect, Schema, Option } from 'effect';
import { JsonUtils } from '../../../lib/utils/JsonUtils.js';

const run = <A>(effect: Effect.Effect<A, unknown>) =>
  Effect.runPromise(effect);

describe('JsonUtils', () => {
  describe('parseUnknown', () => {
    it('should parse valid JSON string', async () => {
      const result = await run(JsonUtils.parseUnknown('{"key":"value"}'));
      expect(result).toEqual({ key: 'value' });
    });

    it('should fail on invalid JSON', async () => {
      const result = await Effect.runPromiseExit(JsonUtils.parseUnknown('not json'));
      expect(result._tag).toBe('Failure');
    });
  });

  describe('parse', () => {
    it('should parse JSON with schema validation', async () => {
      const PersonSchema = Schema.Struct({
        name: Schema.String,
        age: Schema.Number,
      });
      const result = await run(JsonUtils.parse('{"name":"Alice","age":30}', PersonSchema));
      expect(result).toEqual({ name: 'Alice', age: 30 });
    });

    it('should fail when JSON does not match schema', async () => {
      const PersonSchema = Schema.Struct({
        name: Schema.String,
        age: Schema.Number,
      });
      const result = await Effect.runPromiseExit(
        JsonUtils.parse('{"name":"Alice","age":"not-a-number"}', PersonSchema)
      );
      expect(result._tag).toBe('Failure');
    });
  });

  describe('stringify', () => {
    it('should stringify a value to JSON', async () => {
      const result = await run(JsonUtils.stringify({ key: 'value' }));
      expect(result).toBe('{"key":"value"}');
    });

    it('should support pretty printing with space parameter', async () => {
      const result = await run(JsonUtils.stringify({ a: 1 }, 2));
      expect(result).toContain('\n');
      expect(result).toContain('  ');
    });
  });

  describe('isValid', () => {
    it('should return true for valid JSON', async () => {
      expect(await run(JsonUtils.isValid('{"a":1}'))).toBe(true);
    });

    it('should return false for invalid JSON', async () => {
      expect(await run(JsonUtils.isValid('{bad}'))).toBe(false);
    });
  });

  describe('parseOrDefault', () => {
    it('should parse valid JSON', async () => {
      const result = await run(JsonUtils.parseOrDefault('{"x":1}', { x: 0 }));
      expect(result).toEqual({ x: 1 });
    });

    it('should return default for invalid JSON', async () => {
      const result = await run(JsonUtils.parseOrDefault('bad', { x: 0 }));
      expect(result).toEqual({ x: 0 });
    });
  });

  describe('parseOrNone', () => {
    it('should return Some for valid JSON', async () => {
      const result = await run(JsonUtils.parseOrNone('[1,2,3]'));
      expect(Option.isSome(result)).toBe(true);
    });

    it('should return None for invalid JSON', async () => {
      const result = await run(JsonUtils.parseOrNone('nope'));
      expect(Option.isNone(result)).toBe(true);
    });
  });

  describe('pick', () => {
    it('should pick specified keys from object', async () => {
      const result = await run(JsonUtils.pick({ a: 1, b: 2, c: 3 }, ['a', 'c'] as const));
      expect(result).toEqual({ a: 1, c: 3 });
    });
  });

  describe('omit', () => {
    it('should omit specified keys from object', async () => {
      const result = await run(JsonUtils.omit({ a: 1, b: 2, c: 3 }, ['b'] as const));
      expect(result).toEqual({ a: 1, c: 3 });
    });
  });

  describe('prettyPrint', () => {
    it('should format JSON with indentation', async () => {
      const result = await run(JsonUtils.prettyPrint({ nested: { key: 'val' } }));
      expect(result).toContain('\n');
      expect(result).toContain('nested');
    });
  });
});
