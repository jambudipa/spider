/**
 * Behavioural test for the fetch-retry filter.
 *
 * The Spider builds a retry schedule from `FetchRetryConfig`:
 *
 *   Schedule.exponential(baseBackoffMs)
 *     .pipe(
 *       Schedule.intersect(Schedule.recurs(maxAttempts - 1)),
 *       Schedule.whileInput(isRetryable)
 *     )
 *
 * where `isRetryable(error)` consults `retryOn` after `classifyFetchError`.
 * This test exercises that schedule against a mocked effect that fails N
 * times then succeeds. It catches regressions in:
 *
 *   - `whileInput(isRetryable)` short-circuiting on non-retryable kinds
 *   - `recurs(maxAttempts - 1)` capping total attempts at `maxAttempts`
 *   - `classifyFetchError` correctly tagging 5xx as `http_5xx`
 *
 * Provides equivalent AC coverage to a full-Spider integration test
 * without needing to override Effect.Service.Default's internal deps.
 */

import { describe, expect, it } from 'vitest';
import { Effect, MutableRef } from 'effect';
import {
  buildFetchRetrySchedule,
  defaultFetchRetry,
  type FetchRetryConfig,
} from '../../../lib/Config/SpiderConfig.service.js';
import { NetworkError } from '../../../lib/errors/effect-errors.js';

// Build an effect that fails the first `failCount` calls with a 503
// NetworkError, then succeeds. Returns the effect plus a call-count getter.
const failingEffect = (failCount: number) => {
  const calls = MutableRef.make(0);
  const eff = Effect.suspend(() => {
    MutableRef.update(calls, (n) => n + 1);
    const current = MutableRef.get(calls);
    if (current <= failCount) {
      return Effect.fail(
        NetworkError.fromResponse(
          'https://test/',
          new Response('', { status: 503 })
        )
      );
    }
    return Effect.succeed('ok' as const);
  });
  return { eff, getCalls: () => MutableRef.get(calls) };
};

const runWithRetry = async <A, E>(
  effect: Effect.Effect<A, E>,
  cfg: FetchRetryConfig
) => {
  const schedule = buildFetchRetrySchedule(cfg);
  return Effect.runPromiseExit(effect.pipe(Effect.retry(schedule)));
};

describe('Fetch retry filter', () => {
  it('retries on http_5xx and succeeds within maxAttempts', async () => {
    const { eff, getCalls } = failingEffect(2);
    const exit = await runWithRetry(eff, {
      maxAttempts: 3,
      baseBackoffMs: 1,
      retryOn: ['http_5xx'],
    });

    expect(exit._tag).toBe('Success');
    expect(getCalls()).toBe(3);
  });

  it('exhausts maxAttempts when the failure persists', async () => {
    const { eff, getCalls } = failingEffect(Number.POSITIVE_INFINITY);
    const exit = await runWithRetry(eff, {
      maxAttempts: 3,
      baseBackoffMs: 1,
      retryOn: ['http_5xx'],
    });

    expect(exit._tag).toBe('Failure');
    expect(getCalls()).toBe(3);
  });

  it('does not retry when the error kind is not in retryOn', async () => {
    // 5xx fails; retryOn lists only 'timeout' so the schedule short-circuits
    // after the first call.
    const { eff, getCalls } = failingEffect(Number.POSITIVE_INFINITY);
    const exit = await runWithRetry(eff, {
      maxAttempts: 3,
      baseBackoffMs: 1,
      retryOn: ['timeout'],
    });

    expect(exit._tag).toBe('Failure');
    expect(getCalls()).toBe(1);
  });

  it('uses default config retryOn (timeout, http_5xx, http_429) without override', async () => {
    const { eff, getCalls } = failingEffect(1);
    const exit = await runWithRetry(eff, defaultFetchRetry);

    expect(exit._tag).toBe('Success');
    expect(getCalls()).toBe(2);
  });

  it('respects maxAttempts === 1 (no retries, single attempt only)', async () => {
    const { eff, getCalls } = failingEffect(Number.POSITIVE_INFINITY);
    const exit = await runWithRetry(eff, {
      maxAttempts: 1,
      baseBackoffMs: 1,
      retryOn: ['http_5xx'],
    });

    expect(exit._tag).toBe('Failure');
    expect(getCalls()).toBe(1);
  });

  it('fires the onAttempt hook once per retry that the schedule permits', async () => {
    // In Effect v4, Schedule.tap runs after the schedule permits another
    // retry. With maxAttempts: 3 and a permanently failing effect, only the
    // first two failures start retries. The terminal failure does not tap.
    const { eff } = failingEffect(Number.POSITIVE_INFINITY);
    const taps = MutableRef.make(0);
    const onAttempt = Effect.sync(() => {
      MutableRef.update(taps, (n) => n + 1);
    });
    const schedule = buildFetchRetrySchedule(
      { maxAttempts: 3, baseBackoffMs: 1, retryOn: ['http_5xx'] },
      onAttempt
    );
    await Effect.runPromiseExit(eff.pipe(Effect.retry(schedule)));

    expect(MutableRef.get(taps)).toBe(2);
  });

  it('fires the onAttempt hook only on failures (success short-circuits the schedule)', async () => {
    // Two failures then success: only the two failures feed input into
    // the schedule, so the hook fires twice — never on the successful
    // final attempt.
    const { eff } = failingEffect(2);
    const taps = MutableRef.make(0);
    const onAttempt = Effect.sync(() => {
      MutableRef.update(taps, (n) => n + 1);
    });
    const schedule = buildFetchRetrySchedule(
      { maxAttempts: 3, baseBackoffMs: 1, retryOn: ['http_5xx'] },
      onAttempt
    );
    await Effect.runPromiseExit(eff.pipe(Effect.retry(schedule)));

    expect(MutableRef.get(taps)).toBe(2);
  });

  it('does not fire the onAttempt hook when maxAttempts === 1', async () => {
    // The single failed attempt has no permitted retry, so Schedule.tap
    // does not run the hook.
    const { eff } = failingEffect(Number.POSITIVE_INFINITY);
    const taps = MutableRef.make(0);
    const onAttempt = Effect.sync(() => {
      MutableRef.update(taps, (n) => n + 1);
    });
    const schedule = buildFetchRetrySchedule(
      { maxAttempts: 1, baseBackoffMs: 1, retryOn: ['http_5xx'] },
      onAttempt
    );
    await Effect.runPromiseExit(eff.pipe(Effect.retry(schedule)));

    expect(MutableRef.get(taps)).toBe(0);
  });
});
