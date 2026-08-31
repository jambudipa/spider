# Test suite

This folder holds unit, integration, scenario, and shared test support. Start
with `setup.ts` for the Vitest environment.

Keep deterministic behavior in unit tests. Put tests that need real origins in
`integration/` or `scenarios/` so local failures stay easy to classify.
