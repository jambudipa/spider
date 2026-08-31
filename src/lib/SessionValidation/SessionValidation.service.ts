import { Context, Data, Duration, Effect, Layer, Option } from 'effect';
import type { Page } from 'playwright';

/**
 * What a signed-in page shows that a signed-out page does not.
 *
 * Declare one or the other. Both may be declared, in which case either being
 * present counts as the marker being seen.
 *
 * The marker is never inferred. A guessed marker silently validates the wrong
 * thing, which is worse than declining to validate at all.
 *
 * @group SessionValidation
 * @public
 */
export interface SignedInMarker {
  /** Text that appears in the rendered body when, and only when, signed in. */
  readonly text?: string;
  /** CSS selector that matches an element present only when signed in. */
  readonly selector?: string;
}

/**
 * What to validate, and where.
 *
 * @group SessionValidation
 * @public
 */
export interface SessionValidationRequest {
  /** The route to compare the two contexts on. */
  readonly url: string;

  /**
   * The declared evidence of a signed-in session.
   *
   * When absent, validation falls back to the redirect rule — an anonymous
   * visit being sent elsewhere. That rule is right for a server-rendered
   * target and blind on a client-rendered one, which answers 200 at the same
   * URL and draws its sign-in prompt in JavaScript.
   */
  readonly marker?: SignedInMarker;

  /**
   * How long to wait after navigation before reading the marker, in
   * milliseconds.
   *
   * A client-rendered page has an empty body at navigation time. Reading
   * immediately reports every marker absent and calls every valid session
   * rejected.
   *
   * @default 1500
   */
  readonly settleMs?: number;
}

/**
 * What each context was observed to do on the validation route.
 *
 * @group SessionValidation
 * @public
 */
export interface ContextEvidence {
  /** The URL the context finished on, after any redirect. */
  readonly finalUrl: string;
  /**
   * Whether the declared marker was seen. Absent when no marker was declared.
   */
  readonly markerSeen?: boolean;
}

/**
 * Why {@link SessionValidationResult.valid} holds the value it does.
 *
 * @group SessionValidation
 * @public
 */
export type SessionValidationReason =
  /** The session saw the marker and an anonymous context did not. Proven. */
  | 'marker-seen-only-by-session'
  /** The session did not see the marker. The session is not signed in. */
  | 'marker-absent-from-session'
  /** Both contexts saw the marker, so it proves nothing. Declare a better one. */
  | 'marker-not-discriminating'
  /** No marker declared: an anonymous visit was redirected away, the session was not. */
  | 'anonymous-redirected-away'
  /** No marker declared: the session itself was redirected away. */
  | 'session-redirected-away'
  /** No marker declared, and neither context was redirected. Nothing was proven. */
  | 'no-protection-observed';

/**
 * The verdict, with the evidence it rests on.
 *
 * @group SessionValidation
 * @public
 */
export interface SessionValidationResult {
  /** Whether the session was proven to be signed in. */
  readonly valid: boolean;
  /** Why {@link valid} holds the value it does. */
  readonly reason: SessionValidationReason;
  /** What the signed-in context did. */
  readonly session: ContextEvidence;
  /** What the anonymous context did. */
  readonly anonymous: ContextEvidence;
}

/**
 * The validation route could not be reached in one of the two contexts.
 *
 * This is a failure of the measurement, not a verdict about the session, and
 * it carries its own reason rather than the generic prerequisite. A swallowed
 * cause here reads as a target problem when it is a local one.
 *
 * @group Errors
 * @public
 */
export class ValidationRouteUnreachableError extends Data.TaggedError(
  'ValidationRouteUnreachableError'
)<{
  readonly message: string;
  readonly url: string;
  readonly context: 'session' | 'anonymous';
  readonly cause: string;
}> {
  static create(
    url: string,
    context: 'session' | 'anonymous',
    cause: unknown
  ): ValidationRouteUnreachableError {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return new ValidationRouteUnreachableError({
      message: `The ${context} context could not reach the validation route ${url}: ${detail}`,
      url,
      context,
      cause: detail,
    });
  }
}

/**
 * Service interface for evidence-based session validation.
 *
 * @group Services
 * @public
 */
export interface SessionValidationServiceInterface {
  /**
   * Visits the validation route in both contexts and compares what they see.
   *
   * `session` must be a page in the authenticated context; `anonymous` must be
   * a page in a context carrying no credentials. Supplying two pages from the
   * same context compares a thing with itself and proves nothing.
   */
  validate: (
    session: Page,
    anonymous: Page,
    request: SessionValidationRequest
  ) => Effect.Effect<SessionValidationResult, ValidationRouteUnreachableError>;
}

/** @internal */
const DEFAULT_SETTLE_MS = 1500;

/**
 * Reads whether the declared marker is present on a settled page.
 *
 * A selector matches on presence. Text matches against the rendered body,
 * not the markup, so a string buried in a script tag does not count.
 *
 * @internal
 */
const readMarker = (
  page: Page,
  marker: SignedInMarker
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const bySelector = yield* Option.fromNullishOr(marker.selector).pipe(
      Option.match({
        onNone: () => Effect.succeed(false),
        onSome: (selector) =>
          Effect.promise(() => page.locator(selector).first().count()).pipe(
            Effect.map((count) => count > 0),
            Effect.orElseSucceed(() => false)
          ),
      })
    );
    if (bySelector) return true;

    return yield* Option.fromNullishOr(marker.text).pipe(
      Option.match({
        onNone: () => Effect.succeed(false),
        onSome: (text) =>
          Effect.promise(() => page.locator('body').innerText()).pipe(
            Effect.map((body) => body.includes(text)),
            Effect.orElseSucceed(() => false)
          ),
      })
    );
  });

/**
 * Visits the validation route in one context and records what it did.
 *
 * @internal
 */
const observe = (
  page: Page,
  context: 'session' | 'anonymous',
  request: SessionValidationRequest
): Effect.Effect<ContextEvidence, ValidationRouteUnreachableError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => page.goto(request.url, { waitUntil: 'domcontentloaded' }),
      catch: (cause) =>
        ValidationRouteUnreachableError.create(request.url, context, cause),
    });

    // A client-rendered page has an empty body at navigation time.
    yield* Effect.sleep(Duration.millis(request.settleMs ?? DEFAULT_SETTLE_MS));

    const finalUrl = yield* Effect.sync(() => page.url());

    return yield* Option.fromNullishOr(request.marker).pipe(
      Option.match({
        onNone: () => Effect.succeed<ContextEvidence>({ finalUrl }),
        onSome: (marker) =>
          readMarker(page, marker).pipe(
            Effect.map((markerSeen) => ({ finalUrl, markerSeen }))
          ),
      })
    );
  });

/**
 * Proves a session by evidence rather than by redirect.
 *
 * A protected-route probe that asks *"did an anonymous visit get redirected
 * away?"* reads every route of a client-rendered application as public. Such a
 * target answers 200 at the same URL and draws its sign-in prompt in
 * JavaScript, so a URL-comparison test can never see the protection. That is
 * the majority behaviour for single-page applications, not an edge case.
 *
 * This service decides by comparison instead: the caller declares what
 * signed-in looks like, the session must see it, and an anonymous context must
 * not. The redirect rule stays as the fallback when no marker is declared,
 * because it is right for a server-rendered target.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const validation = yield* SessionValidationService;
 *
 *   const result = yield* validation.validate(sessionPage, anonymousPage, {
 *     url: 'https://example.com/my-account',
 *     marker: { selector: '[data-testid="account-menu"]' },
 *   });
 *
 *   if (!result.valid) {
 *     console.log(`Session rejected: ${result.reason}`);
 *   }
 * });
 * ```
 *
 * @group Services
 * @public
 */
export class SessionValidationService extends Context.Service<SessionValidationService>()(
  '@jambudipa.io/SessionValidationService',
  {
    make: Effect.succeed<SessionValidationServiceInterface>({
      validate: (session, anonymous, request) =>
        Effect.gen(function* () {
          // Sequential, not concurrent: two contexts hitting the same route at
          // once can share a rate limiter or a bot check and confound the
          // comparison the verdict rests on.
          const sessionEvidence = yield* observe(session, 'session', request);
          const anonymousEvidence = yield* observe(
            anonymous,
            'anonymous',
            request
          );

          type Verdict = {
            readonly valid: boolean;
            readonly reason: SessionValidationReason;
          };

          const byMarker = (): Verdict => {
            if (sessionEvidence.markerSeen !== true) {
              return { valid: false, reason: 'marker-absent-from-session' };
            }
            if (anonymousEvidence.markerSeen === true) {
              return { valid: false, reason: 'marker-not-discriminating' };
            }
            return { valid: true, reason: 'marker-seen-only-by-session' };
          };

          const byRedirect = (): Verdict => {
            if (sessionEvidence.finalUrl !== request.url) {
              return { valid: false, reason: 'session-redirected-away' };
            }
            if (anonymousEvidence.finalUrl !== request.url) {
              return { valid: true, reason: 'anonymous-redirected-away' };
            }
            return { valid: false, reason: 'no-protection-observed' };
          };

          const verdict = Option.fromNullishOr(request.marker).pipe(
            Option.match({ onSome: byMarker, onNone: byRedirect })
          );

          return {
            ...verdict,
            session: sessionEvidence,
            anonymous: anonymousEvidence,
          };
        }),
    }),
  }
) {
  static readonly layer = Layer.effect(
    SessionValidationService,
    SessionValidationService.make
  );
}

/**
 * Default layer for {@link SessionValidationService}.
 *
 * @group Layers
 * @public
 */
export const SessionValidationServiceLayer = SessionValidationService.layer;
