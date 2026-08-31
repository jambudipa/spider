import { Effect, Option } from 'effect';

// `NodeJS.UncaughtExceptionOrigin` is `'uncaughtException' | 'unhandledRejection'`.
// Inlined to keep the lint env free of `NodeJS` global namespace usage.
/** Origin values reported by Node's uncaught-exception event. */
type UncaughtExceptionOrigin = 'uncaughtException' | 'unhandledRejection';
/** Process listener shape used by the narrow undici termination guard. */
type UncaughtExceptionListener = (
  err: Error,
  origin: UncaughtExceptionOrigin
) => void;

/**
 * Process-level guard for an undici race exposed when an in-flight
 * `fetch()` is aborted at the same moment the underlying TLS socket
 * closes. Node's vendored undici can synchronously emit a
 * `TypeError: terminated` from `Fetch.onAborted` inside an EventEmitter
 * callback (originating in `TLSSocket.onHttpSocketClose`); because the
 * throw escapes via the emitter path rather than a Promise rejection,
 * the adapter's `Effect.tryPromise` catch never sees it and Node's
 * default `uncaughtException` behaviour terminates the process.
 *
 * Upstream context:
 *   - https://github.com/nodejs/node/issues/54484
 *   - https://github.com/nodejs/undici/issues/3492
 *
 * The guard installs a narrow `uncaughtException` listener that only
 * suppresses errors whose stack contains BOTH `Fetch.onAborted` and
 * `Fetch.terminate` frames. Anything else is re-emitted so the default
 * fatal behaviour (or any user-installed handler) runs unchanged.
 *
 * Lifetime is reference-counted on the current Scope, so concurrent
 * `crawl()` invocations share a single process listener and the guard
 * is removed once the last crawl scope closes.
 *
 * @internal
 */

let refCount = 0;
/** Installed listener, if any, so shared crawl scopes register only once. */
let installed: Option.Option<UncaughtExceptionListener> = Option.none();
/** Number of known undici abort-race errors that this process suppressed. */
let swallowedCount = 0;

/**
 * Matches only the Node-undici abort race that this guard may suppress.
 *
 * The stack-frame checks prevent an unrelated `TypeError: terminated` from
 * changing the process failure behavior.
 */
const isUndiciTerminated = (err: unknown): err is TypeError => {
  if (!(err instanceof TypeError)) return false;
  if (err.message !== 'terminated') return false;
  const stack = err.stack;
  if (typeof stack !== 'string') return false;
  return stack.includes('Fetch.onAborted') && stack.includes('Fetch.terminate');
};

/**
 * Preserves normal uncaught-exception handling except for the known undici race.
 *
 * When no other listener exists, it removes itself before rethrowing so Node
 * still terminates as it would without this guard.
 */
const handler: UncaughtExceptionListener = (err, origin) => {
  if (isUndiciTerminated(err)) {
    swallowedCount++;
    // Process-level listener fires outside any Fiber context, so an
    // Effect logger is unreachable here. Write a structured JSON line
    // to stderr — consumers parsing JSON-line logs will pick it up.
    const payload = JSON.stringify({
      event: 'undici_terminated_swallowed',
      level: 'warn',
      message:
        'Suppressed TypeError: terminated from undici Fetch abort race (https://github.com/nodejs/undici/issues/3492)',
      origin,
      count: swallowedCount,
      stack: err.stack,
    });
    process.stderr.write(payload + '\n');
    return;
  }
  // Not ours. Node's `process.emit('uncaughtException', …)` iterates a
  // SNAPSHOT of listeners taken at emit time, so any other listeners
  // present when this fired will still be invoked after us — we do not
  // need to (and must not) re-emit, or those listeners would run
  // twice. If WE are the only listener, however, our presence has
  // already suppressed Node's default fatal behaviour, so we must
  // restore it explicitly: schedule a removal + throw on the next
  // tick so the default uncaught-exception path runs cleanly after
  // the current emit completes.
  const others = process
    .listeners('uncaughtException')
    .filter((l) => l !== handler);
  if (others.length === 0) {
    process.nextTick(() => {
      if (Option.exists(installed, (h) => h === handler)) {
        process.removeListener('uncaughtException', handler);
        installed = Option.none();
      }
      // Intentional re-throw: with no other listener and the guard
      // removed, this becomes an uncaught exception with zero
      // listeners, which is exactly the path Node would have taken if
      // the guard had never been installed (print + exit code 1).
      throw err;
    });
  }
};

/** Installs the shared process listener once for all active crawl scopes. */
const install = (): void => {
  if (Option.isSome(installed)) return;
  installed = Option.some(handler);
  process.on('uncaughtException', handler);
};

/** Removes the shared listener after the final crawl scope releases it. */
const uninstall = (): void => {
  Option.match(installed, {
    onNone: () => {},
    onSome: (h) => {
      process.removeListener('uncaughtException', h);
      installed = Option.none();
    },
  });
};

/**
 * Acquire the undici 'terminated' uncaughtException guard for the
 * lifetime of the current Scope. The first acquirer installs the
 * process listener; the last releaser removes it.
 *
 * @internal
 */
export const acquireUndiciTerminatedGuard = Effect.acquireRelease(
  Effect.sync(() => {
    refCount++;
    if (refCount === 1) install();
  }),
  () =>
    Effect.sync(() => {
      refCount = Math.max(0, refCount - 1);
      if (refCount === 0) uninstall();
    })
);

/**
 * Test-only inspection of guard internals. Not part of the public API.
 *
 * @internal
 */
export const _undiciGuardInternals = {
  isInstalled: (): boolean => Option.isSome(installed),
  refCount: (): number => refCount,
  swallowedCount: (): number => swallowedCount,
  matches: (err: unknown): boolean => isUndiciTerminated(err),
  reset: (): void => {
    uninstall();
    refCount = 0;
    swallowedCount = 0;
  },
};
