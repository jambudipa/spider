# State manager

This folder holds the workflow-local token and browser-storage service. It extracts known token patterns and keeps token, local-storage, and session-storage values in memory.

Start with `StateManager.service.ts`. Use `StateManagerLive` when a workflow needs its own isolated state. Do not place HTTP, cookie, or persistence logic here. Call the focused services for those concerns instead.

The service rejects missing and expired tokens. Its state does not cross a layer instance boundary, so callers must provide the same layer to effects that must share state.
