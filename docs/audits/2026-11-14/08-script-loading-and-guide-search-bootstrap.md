# Script loading and Monorepo guide search bootstrap audit

## Findings

- A full scan of all 148 HTML pages found nine parser-blocking classic external scripts after correctly considering attributes across the complete opening tag.
- Five are the 362-byte `public-config.js` bootstrap. It must run before page ES modules that read the public Supabase configuration, so it remains intentionally ordered and synchronous; it is small and not a large application bundle.
- Four Monorepo guide pages loaded `v2.js` synchronously immediately before the search overlay markup. `v2.js` queries the overlay and its controls during evaluation, so those elements were still absent. The search button was present, but the overlay reference was null and search could not open.
- The three Monorepo lab pages already load `monorepo-labs.js` with `defer`; no change was needed there.

## Changes

1. Added `defer` to the four Monorepo guide `v2.js` script tags. This moves initialization until after parsing, makes the search overlay available, and avoids blocking the parser at the bottom of the page.
2. Added a browser E2E test that opens search and resolves a Promise query on all four guide pages.
3. Added `scripts/verify-script-loading-policy.mjs` to scan every HTML document, preserve the required public-config-before-module ordering, and reject other parser-blocking classic external scripts.

## Verification

- Chromium E2E: all four guide pages open the overlay and return search results.
- Static script policy: all 148 HTML documents.

No cloud sync, Supabase, authentication flow, or learner data behavior was changed. The public configuration bootstrap remains in its original execution order.
