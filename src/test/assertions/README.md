# Effect assertions

This folder contains assertion helpers for Effect test programs. Use these
helpers when a test must inspect an Effect exit or failure channel directly.

Keep assertions free of crawler setup. Scenario-specific assertions belong
with the scenario test that owns the behavior.
