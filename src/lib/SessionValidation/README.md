# Session validation

This folder proves that an authenticated Playwright page differs from an
anonymous page on a declared route. Start with `SessionValidation.service.ts`
to change the evidence model or the resulting validation verdict.

The caller owns both pages and must create them in separate browser contexts.
The service compares a declared signed-in marker when one exists. It uses
redirect behavior only when no marker exists. Do not put login flows, browser
creation, or session persistence in this folder.
