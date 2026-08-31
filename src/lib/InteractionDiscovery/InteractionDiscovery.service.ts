import { Context, Data, Effect, Layer, MutableHashSet, Option } from 'effect';
import type { Page, Request as PlaywrightRequest } from 'playwright';

/**
 * A control on the page that reveals identities when driven.
 *
 * A control is anything a person would operate in place: a tab, a disclosure,
 * a lightbox trigger, a "load more" button, a player's play button. Controls
 * that navigate away are not usable here — see
 * {@link SweepNavigatedAwayError}.
 *
 * @group InteractionDiscovery
 * @public
 */
export interface InteractionControl {
  /**
   * Stable identity for this control, chosen by the caller.
   * Carried onto every request the control reveals.
   */
  readonly id: string;

  /**
   * Human-readable name for this control, as a person would refer to it.
   * This is what turns an opaque GUID in a URL into something nameable.
   */
  readonly label: string;

  /** CSS selector locating the control. */
  readonly selector: string;

  /**
   * How long to wait after driving this control before moving on, in
   * milliseconds. A client-rendered page issues its requests after the click
   * returns, so reading immediately observes nothing.
   *
   * @default 1500
   */
  readonly settleMs?: number;
}

/**
 * A network identity observed during a sweep.
 *
 * @group InteractionDiscovery
 * @public
 */
export interface RevealedRequest {
  /** The absolute URL requested. */
  readonly url: string;
  /** HTTP method of the request. */
  readonly method: string;
  /** Playwright's classification of the request (`xhr`, `media`, `image`, …). */
  readonly resourceType: string;
  /**
   * The control that revealed this identity.
   *
   * Absent when the request happened outside any control's window — an
   * ordinary `<video src>` present in the markup belongs to nobody, and must
   * not be credited to whichever control happened to run last.
   */
  readonly revealedBy?: { readonly id: string; readonly label: string };
}

/**
 * A control that could not be driven, and why.
 *
 * @group InteractionDiscovery
 * @public
 */
export interface SkippedControl {
  /** Identifier of the declared control that could not run. */
  readonly id: string;
  /** Human-readable control name for the diagnostic message. */
  readonly label: string;
  /** Browser failure that prevented the control from running. */
  readonly reason: string;
}

/**
 * The result of a successful sweep.
 *
 * @group InteractionDiscovery
 * @public
 */
export interface InteractionSweepResult {
  /** Identities observed, deduplicated by method and URL. */
  readonly requests: readonly RevealedRequest[];
  /** Controls that were actually driven. */
  readonly driven: readonly { readonly id: string; readonly label: string }[];
  /** Controls that were declared but could not be driven. */
  readonly skipped: readonly SkippedControl[];
}

/**
 * Options for a sweep.
 *
 * @group InteractionDiscovery
 * @public
 */
export interface InteractionSweepOptions {
  /**
   * Which observed requests to keep. The discovery layer is asset-agnostic —
   * it does not know or care whether an identity is video, JSON, or a PDF —
   * so narrowing to a class of interest is the caller's job.
   *
   * @default keeps everything except the page's own document
   */
  readonly include?: (request: RevealedRequest) => boolean;

  /**
   * Default settle window applied to controls that do not declare their own.
   *
   * @default 1500
   */
  readonly settleMs?: number;

  /**
   * How long to observe before driving anything, in milliseconds.
   *
   * Traffic seen in this window belongs to the delivered page rather than to
   * any control, and is recorded with no `revealedBy`. Pair it with
   * {@link navigateTo}: an identity requested while the delivered markup is
   * parsed is gone before a ledger attached after navigation can see it.
   *
   * @default 0
   */
  readonly baselineMs?: number;

  /**
   * Navigate here as the first act of the sweep, with the ledger already
   * attached.
   *
   * A caller that navigates first and sweeps second cannot observe the
   * identities in the delivered markup at all: the browser requests them while
   * the document parses, which is before the ledger exists. Navigating from
   * inside the sweep closes that window, so an ordinary `<img src>` or
   * `<video src>` is recorded — unattributed, as it should be.
   *
   * When absent, the sweep measures whatever page it was handed.
   */
  readonly navigateTo?: string;
}

/**
 * No controls were declared, so no discovery was even attempted.
 *
 * Distinct from {@link NothingRevealedError}: there was never an oracle to
 * consult. A pass here would be vacuous.
 *
 * @group Errors
 * @public
 */
export class NoOracleDeclaredError extends Data.TaggedError(
  'NoOracleDeclaredError'
)<{
  readonly message: string;
}> {
  /** Create the configuration error raised when no interaction oracle exists. */
  static create(): NoOracleDeclaredError {
    return new NoOracleDeclaredError({
      message:
        'No interaction controls were declared, so nothing could be revealed. Declare at least one control, or use a markup-based extractor instead.',
    });
  }
}

/**
 * Controls were declared but none of them could be driven.
 *
 * Distinct from {@link NothingRevealedError}: the page never got as far as
 * being measured.
 *
 * @group Errors
 * @public
 */
export class NoControlsDrivenError extends Data.TaggedError(
  'NoControlsDrivenError'
)<{
  readonly message: string;
  readonly skipped: readonly SkippedControl[];
}> {
  /** Preserve each failed control when discovery cannot drive any of them. */
  static create(skipped: readonly SkippedControl[]): NoControlsDrivenError {
    const detail = skipped
      .map((s) => `${s.label} (${s.id}): ${s.reason}`)
      .join('; ');
    return new NoControlsDrivenError({
      message: `All ${skipped.length} declared control(s) failed to drive: ${detail}`,
      skipped,
    });
  }
}

/**
 * Controls were driven and revealed nothing.
 *
 * Refused rather than returned empty: a vacuous pass is worse than a failure
 * because it looks like success.
 *
 * @group Errors
 * @public
 */
export class NothingRevealedError extends Data.TaggedError(
  'NothingRevealedError'
)<{
  readonly message: string;
  readonly driven: readonly { readonly id: string; readonly label: string }[];
}> {
  /** Refuse an empty measurement after at least one control ran. */
  static create(
    driven: readonly { readonly id: string; readonly label: string }[]
  ): NothingRevealedError {
    return new NothingRevealedError({
      message: `Drove ${driven.length} control(s) — ${driven.map((d) => d.label).join(', ')} — and observed no requests. Either the settle window is too short or these controls reveal nothing.`,
      driven,
    });
  }
}

/**
 * The page navigated during the sweep, so the measurement is void.
 *
 * Only in-place controls can be swept: a control that navigates away loses the
 * page that was being measured, and any identities recorded after it belong to
 * a different document.
 *
 * @group Errors
 * @public
 */
export class SweepNavigatedAwayError extends Data.TaggedError(
  'SweepNavigatedAwayError'
)<{
  readonly message: string;
  readonly controlId: string;
  readonly from: string;
  readonly to: string;
}> {
  /** Report the control that invalidated the sweep by changing documents. */
  static create(
    controlId: string,
    from: string,
    to: string
  ): SweepNavigatedAwayError {
    return new SweepNavigatedAwayError({
      message: `Control "${controlId}" navigated the page from ${from} to ${to}. Only in-place controls can be swept.`,
      controlId,
      from,
      to,
    });
  }
}

/**
 * The sweep's own navigation failed, so there was never a page to measure.
 *
 * Carries its own cause rather than the generic refusal: a local failure that
 * reports as "revealed nothing" reads like a target problem when it is not.
 *
 * @group Errors
 * @public
 */
export class SweepNavigationFailedError extends Data.TaggedError(
  'SweepNavigationFailedError'
)<{
  readonly message: string;
  readonly url: string;
  readonly cause: string;
}> {
  /** Convert a navigation failure into an error that keeps its target URL. */
  static create(url: string, cause: unknown): SweepNavigationFailedError {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return new SweepNavigationFailedError({
      message: `The sweep could not navigate to ${url}: ${detail}`,
      url,
      cause: detail,
    });
  }
}

/**
 * Every way a sweep can refuse.
 *
 * @group Errors
 * @public
 */
export type InteractionSweepError =
  | NoOracleDeclaredError
  | NoControlsDrivenError
  | NothingRevealedError
  | SweepNavigatedAwayError
  | SweepNavigationFailedError;

/**
 * Service interface for interaction-driven discovery.
 *
 * @group Services
 * @public
 */
export interface InteractionDiscoveryServiceInterface {
  /**
   * Drives each declared control on `page` in turn with a network ledger
   * attached, and returns the identities that resulted, each naming the
   * control that revealed it.
   */
  sweep: (
    page: Page,
    controls: readonly InteractionControl[],
    options?: InteractionSweepOptions
  ) => Effect.Effect<InteractionSweepResult, InteractionSweepError>;
}

/** @internal */
const DEFAULT_SETTLE_MS = 1500;

/**
 * Discovers identities that only exist after an interaction.
 *
 * A client-rendered application does not put its asset identities in the
 * delivered markup — they are fetched when a control is driven. A crawler that
 * reads the DOM finds nothing and reports success. This service is the second
 * extraction source alongside `LinkExtractorService`: rather than reading what
 * is there, it operates the page and records what results.
 *
 * It is deliberately asset-agnostic. The unit of work is *an identity revealed
 * by an interaction*, whatever the bytes behind it turn out to be; selecting a
 * class of interest and deciding how to retrieve it are both the caller's job.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const discovery = yield* InteractionDiscoveryService;
 *
 *   const result = yield* discovery.sweep(page, [
 *     { id: 'tab-documents', label: 'Documents', selector: '#tab-docs' },
 *     { id: 'lightbox-1', label: 'Gallery, first image', selector: '.thumb:first-child' },
 *   ], {
 *     include: (r) => r.resourceType === 'xhr' || r.resourceType === 'media',
 *   });
 *
 *   for (const request of result.requests) {
 *     // `revealedBy.label` is what makes an opaque GUID nameable.
 *     console.log(request.url, request.revealedBy?.label ?? '(in markup)');
 *   }
 * });
 * ```
 *
 * @group Services
 * @public
 */
export class InteractionDiscoveryService extends Context.Service<InteractionDiscoveryService>()(
  '@jambudipa.io/InteractionDiscoveryService',
  {
    make: Effect.succeed<InteractionDiscoveryServiceInterface>({
      sweep: (page, controls, options) =>
        Effect.gen(function* () {
          if (controls.length === 0) {
            return yield* NoOracleDeclaredError.create();
          }

          // Reassigned when the sweep does its own navigation, so the
          // request listener and the navigated-away check both read the page
          // actually under measurement.
          let startUrl = page.url();
          const defaultSettleMs = options?.settleMs ?? DEFAULT_SETTLE_MS;
          const include =
            options?.include ??
            ((r: RevealedRequest) => r.resourceType !== 'document');

          const seen = MutableHashSet.empty<string>();
          const observed: RevealedRequest[] = [];
          const driven: { id: string; label: string }[] = [];
          const skipped: SkippedControl[] = [];

          // Attribution is only live inside a control's window. A request that
          // arrives outside one belongs to nobody, and stays that way.
          let attribution = Option.none<{ id: string; label: string }>();

          const onRequest = (request: PlaywrightRequest) => {
            const url = request.url();
            const method = request.method();
            const key = `${method} ${url}`;
            if (url === startUrl || MutableHashSet.has(seen, key)) return;

            const revealed: RevealedRequest = {
              url,
              method,
              resourceType: request.resourceType(),
              ...(Option.isSome(attribution)
                ? { revealedBy: { ...attribution.value } }
                : {}),
            };
            if (!include(revealed)) return;

            MutableHashSet.add(seen, key);
            observed.push(revealed);
          };

          return yield* Effect.acquireUseRelease(
            Effect.sync(() => {
              page.on('request', onRequest);
              return onRequest;
            }),
            () =>
              Effect.gen(function* () {
                // Navigate with the ledger already attached, so identities
                // requested while the markup parses are observed.
                yield* Option.fromNullishOr(options?.navigateTo).pipe(
                  Option.match({
                    onNone: () => Effect.void,
                    onSome: (url) =>
                      Effect.tryPromise({
                        try: () => page.goto(url, { waitUntil: 'commit' }),
                        catch: (error) =>
                          SweepNavigationFailedError.create(url, error),
                      }).pipe(
                        Effect.andThen(
                          Effect.sync(() => {
                            startUrl = page.url();
                          })
                        )
                      ),
                  })
                );

                // Anything arriving before the first control is the page's
                // own traffic, and is recorded with no attribution.
                const baselineMs = options?.baselineMs ?? 0;
                if (baselineMs > 0) {
                  yield* Effect.promise(() => page.waitForTimeout(baselineMs));
                }

                for (const control of controls) {
                  const identity = { id: control.id, label: control.label };

                  const clicked = yield* Effect.gen(function* () {
                    const locator = page.locator(control.selector).first();
                    // Open the attribution window before the click, so the
                    // requests it provokes are credited to this control.
                    yield* Effect.sync(() => {
                      attribution = Option.some(identity);
                    });
                    yield* Effect.tryPromise({
                      try: () => locator.click({ timeout: 5000 }),
                      catch: (error) =>
                        error instanceof Error ? error.message : String(error),
                    });
                    yield* Effect.promise(() =>
                      page.waitForTimeout(control.settleMs ?? defaultSettleMs)
                    );
                  }).pipe(
                    Effect.as(true),
                    Effect.catch((reason) =>
                      Effect.sync(() => {
                        skipped.push({ ...identity, reason });
                        return false;
                      })
                    ),
                    // Close the attribution window whether or not the click
                    // worked, so a failed control cannot claim later requests.
                    Effect.ensuring(
                      Effect.sync(() => {
                        attribution = Option.none();
                      })
                    )
                  );

                  if (!clicked) continue;

                  const nowUrl = page.url();
                  if (nowUrl !== startUrl) {
                    return yield* SweepNavigatedAwayError.create(
                      control.id,
                      startUrl,
                      nowUrl
                    );
                  }

                  driven.push(identity);
                }

                if (driven.length === 0) {
                  return yield* NoControlsDrivenError.create(skipped);
                }

                if (observed.length === 0) {
                  return yield* NothingRevealedError.create(driven);
                }

                return { requests: observed, driven, skipped };
              }),
            (handler) => Effect.sync(() => page.off('request', handler))
          );
        }),
    }),
  }
) {
  /** Supply the dependency-free discovery service to a crawl program. */
  static readonly layer = Layer.effect(
    InteractionDiscoveryService,
    InteractionDiscoveryService.make
  );
}

/**
 * Default layer for {@link InteractionDiscoveryService}.
 *
 * @group Layers
 * @public
 */
export const InteractionDiscoveryServiceLayer =
  InteractionDiscoveryService.layer;
