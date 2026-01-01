import { Effect } from 'effect';

export function expectEffectSuccess<A, E>(
  effect: Effect.Effect<A, E>
): Promise<A> {
  return Effect.runPromise(effect);
}

export function expectEffectFailure<A, E>(
  effect: Effect.Effect<A, E>
): Promise<E> {
  return Effect.runPromise(
    Effect.flip(effect)
  );
}

export interface IEffectAssertions {
  expectSuccess: typeof expectEffectSuccess;
  expectFailure: typeof expectEffectFailure;
}

export const EffectAssertions = {
  make: (): IEffectAssertions => ({
    expectSuccess: expectEffectSuccess,
    expectFailure: expectEffectFailure
  })
};