import { Effect } from 'effect';

export function expectEffectSuccess<A, E>(
  effect: Effect.Effect<A, E, never>
): Promise<A> {
  return Effect.runPromise(effect);
}

export function expectEffectFailure<A, E>(
  effect: Effect.Effect<A, E, never>
): Promise<E> {
  return Effect.runPromise(
    Effect.flip(effect)
  );
}

export interface EffectAssertions {
  expectSuccess: typeof expectEffectSuccess;
  expectFailure: typeof expectEffectFailure;
}

export const EffectAssertions = {
  make: (): EffectAssertions => ({
    expectSuccess: expectEffectSuccess,
    expectFailure: expectEffectFailure
  })
};