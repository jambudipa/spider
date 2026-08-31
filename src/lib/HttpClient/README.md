# HTTP client services

This folder holds high-level HTTP helpers for workflows that need cookies,
sessions, forms, and authentication tokens. Start with the matching service
file when you change its public Effect contract.

The services share state through Effect Layers. Cookie, session, and token
state must stay inside a layer instance. Use a fresh layer when callers need
separate sessions.

Keep raw transport behavior in `../HttpAdapter`. Do not add spider crawl
scheduling here. These helpers exist for request workflows above that boundary.
