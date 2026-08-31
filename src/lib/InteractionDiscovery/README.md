# Interaction discovery

This folder records network requests that a browser page makes after a person-like interaction. It supports pages where markup does not expose the asset identity.

Start with `InteractionDiscovery.service.ts`. Callers declare controls and provide a request filter. This folder records request identities only. Asset selection, downloads, and ordinary markup extraction belong elsewhere.

The service starts its network ledger before optional navigation. It attributes a request only during the control window that caused it. A control that changes documents invalidates the measurement and returns a typed error.
