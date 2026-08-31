/**
 * Tests for the undici `TypeError: terminated` uncaughtException guard.
 *
 * Verifies that:
 *   - Synthesised matching errors (TypeError with `terminated` message
 *     and stack containing `Fetch.onAborted` and `Fetch.terminate`) are
 *     suppressed and counted.
 *   - Non-matching errors are re-emitted so any other listener (or
 *     Node's default fatal behaviour) sees them unchanged.
 *   - Acquisition is reference-counted: the listener is installed on
 *     0→1 and removed on 1→0, so concurrent crawls share a single
 *     process-level registration.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect, Exit, Scope } from 'effect';
import {
  acquireUndiciTerminatedGuard,
  _undiciGuardInternals,
} from '../../../lib/Spider/undiciTerminatedGuard.js';

// Snapshot any uncaughtException listeners present at suite start
// (vitest and friends often install their own) so we can isolate our
// re-emit test from them, then restore afterwards.
type UncaughtListener = (err: Error, origin: string) => void;
let preexistingListeners: UncaughtListener[] = [];

beforeEach(() => {
  preexistingListeners = [
    ...process.listeners('uncaughtException'),
  ] as UncaughtListener[];
  for (const l of preexistingListeners) {
    process.removeListener('uncaughtException', l);
  }
  _undiciGuardInternals.reset();
});

afterEach(() => {
  _undiciGuardInternals.reset();
  for (const l of preexistingListeners) {
    process.on('uncaughtException', l);
  }
});

// @types/node @20 lacks an explicit overload for emitting
// `uncaughtException` with a custom origin, so cast to a permissive
// signature for direct synthetic emission. This is test-only code —
// `custom-rules/no-type-assertion` is disabled in test files.
const emitUncaught = (err: Error, origin = 'uncaughtException'): void => {
  (
    process.emit as (
      event: 'uncaughtException',
      err: Error,
      origin: string
    ) => boolean
  )('uncaughtException', err, origin);
};

const makeUndiciTerminatedError = (): TypeError => {
  const err = new TypeError('terminated');
  err.stack = [
    'TypeError: terminated',
    '    at Fetch.onAborted (node:internal/deps/undici/undici:12141:53)',
    '    at Fetch.emit (node:events:508:28)',
    '    at Fetch.terminate (node:internal/deps/undici/undici:11300:14)',
    '    at Object.onError (node:internal/deps/undici/undici:12260:38)',
    '    at TLSSocket.onHttpSocketClose (node:internal/deps/undici/undici:7173:14)',
  ].join('\n');
  return err;
};

describe('undiciTerminatedGuard — stack matching', () => {
  it('matches a synthesised undici terminated error', () => {
    expect(_undiciGuardInternals.matches(makeUndiciTerminatedError())).toBe(
      true
    );
  });

  it('rejects a TypeError with the right message but wrong stack', () => {
    const err = new TypeError('terminated');
    err.stack = 'TypeError: terminated\n    at something else';
    expect(_undiciGuardInternals.matches(err)).toBe(false);
  });

  it('rejects a non-TypeError with matching message', () => {
    const err = new Error('terminated');
    err.stack = [
      'Error: terminated',
      '    at Fetch.onAborted (x)',
      '    at Fetch.terminate (y)',
    ].join('\n');
    expect(_undiciGuardInternals.matches(err)).toBe(false);
  });

  it('rejects a TypeError with a different message', () => {
    const err = new TypeError('something else');
    err.stack = [
      'TypeError: something else',
      '    at Fetch.onAborted (x)',
      '    at Fetch.terminate (y)',
    ].join('\n');
    expect(_undiciGuardInternals.matches(err)).toBe(false);
  });

  it('rejects undefined, null, and primitives', () => {
    expect(_undiciGuardInternals.matches(undefined)).toBe(false);
    expect(_undiciGuardInternals.matches(null)).toBe(false);
    expect(_undiciGuardInternals.matches('terminated')).toBe(false);
  });
});

describe('undiciTerminatedGuard — refcounted lifecycle', () => {
  it('installs the listener on first acquire and removes on last release', async () => {
    expect(_undiciGuardInternals.isInstalled()).toBe(false);
    expect(_undiciGuardInternals.refCount()).toBe(0);

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* acquireUndiciTerminatedGuard;
          expect(_undiciGuardInternals.isInstalled()).toBe(true);
          expect(_undiciGuardInternals.refCount()).toBe(1);
        })
      )
    );

    expect(_undiciGuardInternals.isInstalled()).toBe(false);
    expect(_undiciGuardInternals.refCount()).toBe(0);
  });

  it('shares a single registration across concurrent scopes', async () => {
    const outerScope = await Effect.runPromise(Scope.make());
    const innerScope = await Effect.runPromise(Scope.make());

    await Effect.runPromise(
      Scope.provide(acquireUndiciTerminatedGuard, outerScope)
    );
    expect(_undiciGuardInternals.refCount()).toBe(1);
    expect(process.listeners('uncaughtException')).toHaveLength(1);

    await Effect.runPromise(
      Scope.provide(acquireUndiciTerminatedGuard, innerScope)
    );
    expect(_undiciGuardInternals.refCount()).toBe(2);
    // Still exactly one process-level listener.
    expect(process.listeners('uncaughtException')).toHaveLength(1);

    await Effect.runPromise(Scope.close(innerScope, Exit.succeed(0)));
    expect(_undiciGuardInternals.refCount()).toBe(1);
    expect(_undiciGuardInternals.isInstalled()).toBe(true);

    await Effect.runPromise(Scope.close(outerScope, Exit.succeed(0)));
    expect(_undiciGuardInternals.refCount()).toBe(0);
    expect(_undiciGuardInternals.isInstalled()).toBe(false);
  });
});

describe('undiciTerminatedGuard — emission behaviour', () => {
  it('swallows a matching uncaughtException and increments the counter', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* acquireUndiciTerminatedGuard;
          emitUncaught(makeUndiciTerminatedError());
        })
      )
    );

    expect(_undiciGuardInternals.swallowedCount()).toBe(1);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const payload = String(stderrSpy.mock.calls[0]?.[0] ?? '');
    expect(payload).toContain('undici_terminated_swallowed');
    expect(payload).toContain('"count":1');

    stderrSpy.mockRestore();
  });

  it('passes non-matching uncaughtException through to other listeners exactly once', async () => {
    const sink = vi.fn();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // Install sink BEFORE the guard so both appear in the emit
          // snapshot. Node's emit iterates the snapshot, so sink will
          // be called once whether or not the guard intervenes — the
          // guard's job is to NOT trigger a duplicate invocation.
          process.on('uncaughtException', sink);
          yield* acquireUndiciTerminatedGuard;

          const other = new Error('totally unrelated');
          emitUncaught(other);

          expect(sink).toHaveBeenCalledTimes(1);
          expect(sink.mock.calls[0]?.[0]).toBe(other);
          // Guard remains installed; non-matching errors do not change
          // its lifecycle when other listeners are present.
          expect(_undiciGuardInternals.isInstalled()).toBe(true);
          expect(_undiciGuardInternals.swallowedCount()).toBe(0);

          process.removeListener('uncaughtException', sink);
        })
      )
    );
  });

  it('schedules a default-fatal re-throw when no other listener is installed', async () => {
    // When the guard is the sole listener, a non-matching error must
    // restore Node's default behaviour. The handler defers a `throw`
    // via process.nextTick — verify that it's scheduled and that the
    // guard removes itself before throwing. We capture the deferred
    // callback rather than letting it actually throw (which would
    // kill the test process).
    const nextTickSpy = vi
      .spyOn(process, 'nextTick')
      .mockImplementation(() => {
        // Swallow — we only need to assert it was called.
      });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* acquireUndiciTerminatedGuard;
          expect(process.listeners('uncaughtException')).toHaveLength(1);

          const other = new Error('alone');
          emitUncaught(other);

          expect(nextTickSpy).toHaveBeenCalledTimes(1);
          // Guard is still installed at this point; the removal happens
          // inside the deferred callback (which we didn't run).
          expect(_undiciGuardInternals.isInstalled()).toBe(true);
          expect(_undiciGuardInternals.swallowedCount()).toBe(0);
        })
      )
    );

    nextTickSpy.mockRestore();
  });
});
