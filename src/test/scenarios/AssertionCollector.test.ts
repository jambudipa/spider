/**
 * Tests for AssertionCollector
 */

import { Effect } from 'effect';
import { describe, it, expect } from 'vitest';
import { AssertionCollector, createAssertionCollector, withAssertions } from './AssertionCollector.js';

describe('AssertionCollector', () => {
  it('should collect passing assertions', async () => {
    const collector = createAssertionCollector();
    
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* collector.assert('Test 1', true, 'expected', 'expected');
        yield* collector.assertEqual('Test 2', 5, 5);
        yield* collector.assertTruthy('Test 3', 'value');
        
        const assertions = yield* collector.getAssertions();
        expect(assertions).toHaveLength(3);
        expect(assertions.every(a => a.passed)).toBe(true);
        
        const summary = yield* collector.getSummary();
        expect(summary.total).toBe(3);
        expect(summary.passed).toBe(3);
        expect(summary.failed).toBe(0);
      })
    );
  });

  it('should collect failing assertions', async () => {
    const collector = createAssertionCollector();
    
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* collector.assert('Test 1', false, 'expected', 'actual');
        yield* collector.assertEqual('Test 2', 5, 10);
        yield* collector.assertFalsy('Test 3', true);
        
        const assertions = yield* collector.getAssertions();
        expect(assertions).toHaveLength(3);
        expect(assertions.every(a => !a.passed)).toBe(true);
        
        const summary = yield* collector.getSummary();
        expect(summary.total).toBe(3);
        expect(summary.passed).toBe(0);
        expect(summary.failed).toBe(3);
        expect(summary.failedAssertions).toHaveLength(3);
      })
    );
  });

  it('should collect mixed assertions', async () => {
    const collector = createAssertionCollector();
    
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* collector.assertTruthy('Pass 1', true);
        yield* collector.assertFalsy('Fail 1', true);
        yield* collector.assertGreaterThan('Pass 2', 10, 5);
        yield* collector.assertLessThan('Fail 2', 10, 5);
        yield* collector.assertContains('Pass 3', [1, 2, 3], 2);
        yield* collector.assertContains('Fail 3', [1, 2, 3], 5);
        
        const summary = yield* collector.getSummary();
        expect(summary.total).toBe(6);
        expect(summary.passed).toBe(3);
        expect(summary.failed).toBe(3);
      })
    );
  });

  it('should test property assertions', async () => {
    const collector = createAssertionCollector();
    const obj = { name: 'test', value: 42, nested: { prop: 'value' } };
    
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* collector.assertHasProperty('Has name', obj, 'name');
        yield* collector.assertHasProperty('Has value 42', obj, 'value', 42);
        yield* collector.assertHasProperty('Wrong value', obj, 'value', 100);
        yield* collector.assertHasProperty('Missing prop', obj, 'missing');
        
        const summary = yield* collector.getSummary();
        expect(summary.passed).toBe(2);
        expect(summary.failed).toBe(2);
      })
    );
  });

  it('should test regex assertions', async () => {
    const collector = createAssertionCollector();
    
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* collector.assertMatches('Email pattern', 'test@example.com', /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
        yield* collector.assertMatches('Phone pattern', '123-456-7890', /^\d{3}-\d{3}-\d{4}$/);
        yield* collector.assertMatches('Invalid pattern', 'not-an-email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
        
        const assertions = yield* collector.getAssertions();
        expect(assertions[0].passed).toBe(true);
        expect(assertions[1].passed).toBe(true);
        expect(assertions[2].passed).toBe(false);
      })
    );
  });

  it('should clear assertions', async () => {
    const collector = createAssertionCollector();
    
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* collector.assert('Test 1', true);
        yield* collector.assert('Test 2', false);
        
        let summary = yield* collector.getSummary();
        expect(summary.total).toBe(2);
        
        yield* collector.clear();
        
        summary = yield* collector.getSummary();
        expect(summary.total).toBe(0);
      })
    );
  });

  it('should work with withAssertions helper', async () => {
    const result = await Effect.runPromise(
      withAssertions((collector) =>
        Effect.gen(function* () {
          yield* collector.assertEqual('Value check', 10, 10);
          yield* collector.assertTruthy('Truthy check', 'exists');
          yield* collector.assertNoErrors('No errors', undefined);
          
          return { data: 'test-result' };
        })
      )
    );
    
    expect(result.result.data).toBe('test-result');
    expect(result.assertions).toHaveLength(3);
    expect(result.assertions.every(a => a.passed)).toBe(true);
  });
});