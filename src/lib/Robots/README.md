# Robots compliance

This folder fetches, parses, caches, and applies `robots.txt` rules before a crawler requests an origin. The service follows RFC 9309 matching rules and returns a verdict that explains why it allowed or refused a URL.

Start with `Robots.service.ts`. The service keeps one cache for its lifetime. It caches by origin, not by full URL.

Treat missing rules and unavailable rules as different outcomes. HTTP 404 and 410 mean no rules exist, so URLs are allowed. Network failures, 5xx responses, invalid bodies, and oversized bodies mean rules are unknown, so URLs are refused.

Keep robots parsing and cache policy in this folder. Do not place crawler scheduling or request execution here.
