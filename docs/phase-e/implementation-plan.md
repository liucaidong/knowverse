# Phase E — Implementation and Deployment

## Implemented work

1. Extend the existing local document allowlist without bumping IndexedDB v4 or introducing another database.
2. Add Learner Profile and user preference projection / persistence.
3. Add topic- and competency-validated Goal Manager and lifecycle events.
4. Extend the existing deterministic Planner with multi-goal ranking, time-budget selection and 1–14 day schedule allocation.
5. Add versioned proposal / accepted plan lifecycle, plan-head CAS and explicit acceptance.
6. Add persisted tasks, state machine, scheduled-date lock, execution timing and evidence validation.
7. Add Agent tool schemas, explicit mutation confirmation, local rule mode, session/message documents and provider adapter.
8. Add authenticated Supabase Edge Function and forward-only migration for existing archive document types.
9. Add Agent workspace under the existing Learning Growth navigation group.
10. Add unit and browser E2E tests and GitHub Actions checks.

## Database deployment

The required sequence is:

1. Confirm Supabase project ref is exactly sxcpareycpokcyroufww.
2. Compare applied migrations with the live migration history.
3. Apply 20261103000000_phase_e_learning_documents.sql as a forward migration.
4. Deploy Edge Function learning-agent with JWT verification enabled.
5. Verify function deployment and migration history.
6. Set provider secrets only when an approved provider is selected.

No destructive SQL or history rewrite is part of the deployment.

## Static deployment

GitHub Pages continues to serve the existing static site. The Agent is at /knowverse/agent/ and the static shell generator includes its page and submenu. The build must regenerate public pages, shell, search and Monorepo graph assets exactly as CI expects.

## Manual owner configuration

The site owner must set AI_PROVIDER_API_KEY and AI_PROVIDER_MODEL in Supabase Edge Function secrets, plus AI_PROVIDER_BASE_URL when using a compatible custom endpoint. The function can be deployed before these secrets; it then returns a typed unavailable response and the browser falls back to rule mode.

Cloud AI access also requires a GitHub-authenticated user authorized by the existing allowlist. Cross-device sync requires an authenticated authorized account and live cloud session.

## Final release gate

A release is complete only after local unit tests, Chromium / WebKit browser tests, static content validators, all existing product-line tests, GitHub Actions and Pages deployment are checked against the pushed commit SHA. A browser viewport is not a physical-device certification. A WebKit test is not an actual iPhone restore test.
