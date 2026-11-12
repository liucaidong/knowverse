# KNOWVERSE 4.0 — 2026-11-12 当前状态与首轮质量治理记录

- Repository: `liucaidong/knowverse`
- Branch: `develop`
- Recorded HEAD at report creation: `1c8f516cc85869a1bb5c21cc18ca943c843ef683`.
- Local checkout: `/Users/geeker/ai-projects/knowverse`
- Scope: read-only audit, deterministic local tests, isolated PostgreSQL replay, isolated KNOWVERSE N2 staging acceptance, and CI reliability fixes. No production business data was written.

## 1. Repository and release state

- Local `develop` tracks `origin/develop`; code and content changes are committed and pushed. The audit report itself is being updated in a follow-up documentation commit.
- Latest changes in this work session:
  - `8ccf98c`: make the H1 pilot E2E distinguish optional Mermaid CDN failure from first-party resource failure; exclude ignored third-party dependency HTML from public-site link validation; regenerate stale search and Monorepo graph artifacts.
  - `ed4bcea`: isolate the Tutor E2E from the optional Mermaid CDN.
  - `c476607`: stub Supabase project requests in the synthetic Tutor consent E2E so a fake session cannot make DNS-dependent or production requests.
  - `1c8f516`: add the AI Agent formal learning graph, two evidence-backed lessons, six targeted review variants, three Concept pages, updated provenance/search/routes, deterministic provenance regeneration, and dedicated unit/browser regression tests.
  - `5ac5aa5`: update this audit baseline and record the current evidence boundary.
- Pages deployments for `8ccf98c`, `ed4bcea`, `5e02429`, `1c8f516`, `4f4f5ce` and `d841f32` completed successfully; Validate runs for `5e02429`, `4f4f5ce` and `d841f32` also passed.
- Current acceptance commit: `d841f32` (`deploy(staging): activate learning agent and practice reviewer`). GitHub Validate run `43173754146` completed successfully; Pages run `43173754132` completed successfully. Both runs target the same commit `d841f32f42ab102435ae09015405e7bc79b93d91`.

## 2. Current product inventory

The architecture validator reports:

- 4 direct navigation groups: Start, Knowledge, Experience, Progress.
- 12 registered knowledge topics.
- 19 Concepts and 18 Competencies, with 34 mapped learning gaps and 78 targeted review variants.
- 4 of 12 knowledge topics now have formal Concept / Competency maps: Promise, TypeScript Monorepo, React Native, and AI Agent. The other 8 remain content-only and are not falsely treated as mastery-mapped.
- 3 experience pillars and 17 registered works.
- 17 official source records.
- 47 canonical routes and 118 search records.
- 141 static-shell pages and 3 immersive pages with explicit exit affordances.

The current start page is a guided learning entry: one next action, a four-step learning path, and secondary links for browsing knowledge, practice, and progress. Browser coverage confirms four direct navigation destinations, no nested global menu, mobile menu behavior, no-JavaScript navigation, one learning CTA, and no horizontal overflow in tested narrow viewports.

## 3. Verification performed locally

- All 31 `scripts/verify-*.mjs` scripts completed successfully: 31/31, zero failures.
- All 17 non-hosted `scripts/e2e-*.mjs` suites completed successfully: 54 browser test cases across Chromium and WebKit. Hosted scripts are listed separately below.
- Static validation passed after deterministic rebuild:
  - V1 content registry: 12 topics, 17 works, 17 unique live routes.
  - V2 link validation: 3,624 local links, 22 Mermaid panoramas, 118 search records.
  - Promise course: 20 lessons and workbench/challenge checks.
  - Monorepo course: 10 chapters, 739 local links, 11 diagrams, 5-package graph.
  - Fullstack tutorial, native metadata, source ZIP and device-smoke metadata checks.
  - Search index and Monorepo graph reproducibility checks.
  - KNOWVERSE 4.0 architecture validation: 4 navigation groups, 12 topics, 19 Concepts, 18 Competencies, 3 experience pillars, 17 works, 17 sources, 47 canonical routes, 118 search records, 141 static-shell pages.
- Deno type-check passed for `supabase/functions/practice-quality-review/index.ts`.
- PostgreSQL 17 isolated migration replay passed for all 12 migrations against both empty Auth and seeded Auth databases. It also verified that migration replay does not overwrite an existing reviewer row.
- PostgreSQL 17 isolated sync/RLS test passed: atomic event/document commit, immutable event retry, CAS rollback, pagination, cross-account RLS isolation, identity spoof rejection and device spoof rejection.

## 4. CI reliability remediations

Two failures were traced to external dependencies, not to the tested learning business flow:

1. H1 pilot test failed when Mermaid's optional ESM chunk requests failed from jsDelivr. The application already has a source-preserving fallback. The test now excludes only the exact optional Mermaid CDN origin from its no-failed-request assertion; first-party local requests remain strict.
2. Tutor consent E2E failed in GitHub Actions when the synthetic session caused Supabase requests to depend on external DNS. The test now stubs the optional Mermaid module and all Supabase project requests. The Learning Agent request remains separately intercepted and its payload, authorization header, one-turn consent, and non-mastery behavior are still asserted. A shared `scripts/helpers/mock-supabase-project.mjs` fixture now keeps the other local synthetic-session suites (Phase K/L/M) off real Supabase hosts while preserving explicit RPC fixtures.

The local H1 and Tutor suites passed after these changes. The subsequent local regression run also passed all 31 verifier scripts and all 54 browser cases. The expanded AI Agent content commit and the later staging Edge Function deployment commit `d841f32` both passed GitHub Validate and Pages deployment. The current source baseline is green; the remaining blockers are external staging provider secrets and physical-device acceptance, not CI.

The V2 validator also previously traversed a locally installed nested `node_modules` tree and reported third-party React Native DevTools / Expo HTML references as broken public-site links. It now excludes generated dependency/build directories from the public-site HTML scan. The real public site link scan remains enabled and passed.

## 5. AI Agent formal learning-map expansion

This remediation batch expanded AI Agent from two lesson pages to four and added a formal learning graph rather than treating reading as mastery:

- 3 Concept nodes and 3 Competencies in a prerequisite chain: architecture selection → tool execution / MCP contract → security governance.
- 3 explicit Gap definitions and 6 independent review variants (two per gap).
- 4 official source records covering Anthropic agent architecture guidance, OpenAI Function Calling, the MCP 2026-07-28 specification, and OWASP LLM / GenAI security guidance.
- New lesson pages cover tool-calling execution boundaries, MCP Host / Client / Server and stateless request semantics, prompt injection, least privilege, explicit consent, human confirmation, audit and evaluation.
- A dedicated verifier proves a failed targeted review can be resolved only by a different no-hint review variant. The daily planner now includes the new root competency, and the public provenance registry refreshes source and coverage counts on every build.

The topic is one of four formally mapped topics; the remaining eight are still content-only.

## 6. N2 staging acceptance

The target was explicitly pinned by the test harness to `https://ypthoicwrfsblaidllyy.supabase.co` (`knowverse-staging`), not the production project.

The hosted Supabase acceptance completed successfully during this session:

- Account A/B Auth login, confirmed email, distinct identities and staging allowlist.
- Two devices registered for A and one for B.
- Atomic event + document commit.
- Second A device pulled the same event/document.
- Cross-device idempotent retry.
- Stale CAS conflict rolled back the entire batch.
- Corrected CAS retry committed revision 2.
- B could not read A's data, spoof A's identity or use A's device.

The script reports that the two synthetic Auth users should be deleted from the staging Supabase Dashboard after acceptance; dependent test rows cascade. This cleanup has not been performed by this session.

A fresh Mac Chromium hosted staging browser re-run passed on 2026-11-12. The local preview was pinned to the approved staging URL and used the application `SupabaseAuthClient.saveSession()` path. Result: 28/28 hosted RPC responses were HTTP 200; initial status `已同步`; conflicts, pending events and pending documents were all zero; manual sync passed; pull-only restore invoked zero `sync_commit_learning_batch` calls; page reload restored the same state; browser errors were zero. The temporary preview and public config were removed after the test. This is real Mac Chromium + hosted staging evidence, not a second physical device or iPhone Safari test.

#### Staging Edge Functions and real-provider gate

The Supabase management connector initially reported zero deployed Edge Functions. I deployed the current `develop` sources to the staging project only, with platform JWT verification enabled:

| Function | Deployment | Auth check | Provider status |
|---|---|---|---|
| `learning-agent` | Active | Unauthenticated request returns HTTP 401 | Authenticated Account A request returns `503 AI_PROVIDER_NOT_CONFIGURED` |
| `practice-quality-review` | Active | Unauthenticated request returns HTTP 401 | Authenticated history read returns HTTP 200 with no candidate records; no Reviewer model call was made |

This confirms both cloud endpoints, their runtime imports, and the authentication boundary are live, but it does **not** prove real AI generation or independent review. The authenticated Learning Agent test fails closed before any provider request because the required `AI_PROVIDER_API_KEY` / `AI_PROVIDER_MODEL` configuration is incomplete. No billable model request was made. The local ignored `.env.n2.local` contains only staging connection / test-account settings, not provider credentials.

The staging function secrets that must be set in Supabase Dashboard → Project Settings → Edge Functions → Secrets are:

- `AI_PROVIDER_API_KEY` and `AI_PROVIDER_MODEL`; `AI_PROVIDER_BASE_URL` is optional (default OpenAI-compatible API base).
- `PRACTICE_REVIEWER_API_KEY` and `PRACTICE_REVIEWER_MODEL`; `PRACTICE_REVIEWER_API_BASE_URL` is optional. The Reviewer model must differ from `AI_PROVIDER_MODEL`; use an independent credential/model where possible.
- `KNOWVERSE_CONTENT_REF=develop` so the staging Reviewer validates against the current develop learning map and assessment registry. The function safely defaults to `main` when this setting is absent; production should retain that default unless explicitly changed.

Do not paste API key values into chat or commit them. After the secrets are configured, rerun `node scripts/e2e-hosted-learning-agent.mjs`, then create one synthetic staging candidate and run the independent Reviewer acceptance path. The current connected Supabase management actions can inspect projects, migrations, tables, functions and advisors, but do not expose Edge Function secret mutation; the Dashboard action is required.

The Supabase Security Advisor also reports leaked-password protection disabled. Enable it under Authentication → Settings → Password Security. The private-schema RLS-without-policies findings are informational and consistent with server-only access; do not add broad client policies. Three unused indexes are informational on this small staging dataset and should not be dropped without production query evidence.

#### Staging Edge Functions and real-provider gate

The Supabase management connector initially reported zero deployed Edge Functions. I deployed the current `develop` sources to the staging project only, with platform JWT verification enabled:

| Function | Deployment | Auth check | Provider status |
|---|---|---|---|
| `learning-agent` | Active | Unauthenticated request returns HTTP 401 | Authenticated Account A request returns `503 AI_PROVIDER_NOT_CONFIGURED` |
| `practice-quality-review` | Active | Unauthenticated request returns HTTP 401 | Reviewer provider call not yet attempted; no candidate review was submitted |

This confirms the cloud endpoints and authentication boundary are live, but it does **not** prove real AI generation or independent review. The authenticated Learning Agent test fails closed before any provider request because `AI_PROVIDER_API_KEY` / `AI_PROVIDER_MODEL` are not configured for the staging function. No billable model request was made. The local ignored `.env.n2.local` contains only staging connection / test-account settings, not provider credentials.

The staging function secrets that must be set in Supabase Dashboard → Project Settings → Edge Functions → Secrets are:

- `AI_PROVIDER_API_KEY` and `AI_PROVIDER_MODEL`; `AI_PROVIDER_BASE_URL` is optional (default OpenAI-compatible API base).
- `PRACTICE_REVIEWER_API_KEY` and `PRACTICE_REVIEWER_MODEL`; `PRACTICE_REVIEWER_API_BASE_URL` is optional. The Reviewer model must differ from `AI_PROVIDER_MODEL`; use an independent credential/model where possible.
- `KNOWVERSE_CONTENT_REF=develop` so the staging Reviewer validates against the current develop learning map and assessment registry. The function safely defaults to `main` when this setting is absent; production should retain that default unless explicitly changed.

Do not paste API key values into chat or commit them. After the secrets are configured, rerun `node scripts/e2e-hosted-learning-agent.mjs`, then create one synthetic staging candidate and run the independent Reviewer acceptance path. The current connected Supabase management actions can inspect projects, migrations, tables, functions and advisors, but do not expose Edge Function secret mutation; the Dashboard action is required.

The Supabase Security Advisor also reports leaked-password protection disabled. Enable it under Authentication → Settings → Password Security. The private-schema RLS-without-policies findings are informational and consistent with server-only access; do not add broad client policies. Three unused indexes are informational on this small staging dataset and should not be dropped without production query evidence.

## 7. Remaining acceptance gaps

| Area | Current status | Required evidence |
|---|---|---|
| Real Tutor / Agent / independent Reviewer model Provider calls | BLOCKED: both Edge Functions are deployed and JWT-gated; Learning Agent returns `AI_PROVIDER_NOT_CONFIGURED` | Configure provider secrets, then verify real staging calls, independent Reviewer credential, timeout/429/5xx/invalid-output fail-closed tests |
| AI candidate-to-publication chain | NOT VERIFIED end-to-end | Real staging candidate → deterministic validator → independent Reviewer → explicit human approval → PR → exact Pages comparison → registration |
| Cross-device sync | PostgreSQL isolated tests PASS; hosted Supabase HTTP PASS; Mac Chromium staging browser PASS | Second physical device, offline Outbox, session refresh, weak network/background recovery, account revocation |
| Physical iPhone Safari | NOT VERIFIED | Real device acceptance evidence |
| Formal learning graph coverage | 4/12 topics mapped | Build evidence-backed Concept/Competency/prerequisite/Gap/Assessment/Checkpoint maps for remaining 8 topics; do not manufacture mastery for unmapped topics |
| Content correctness | PARTIAL | Technical/answer-level source review, calibrated difficulty and reviewed explanations for each formal assessment |
| Backup / restore | NOT VERIFIED | Documented backup and restore drill with evidence |

## 8. Next execution order

1. Verify the second physical device, offline Outbox / weak-network recovery, session refresh and iPhone Safari; the Mac Chromium staging browser path and current GitHub CI now pass.
2. Set staging Edge Function secrets (`AI_PROVIDER_*`, `PRACTICE_REVIEWER_*`, `KNOWVERSE_CONTENT_REF=develop`) and enable leaked-password protection; then test real Tutor / Agent / independent Reviewer calls.
3. Prove the complete protected practice publication chain with a synthetic staging candidate and explicit human approval; never auto-merge.
4. Extend formal learning maps selectively to the remaining eight topics, beginning with high-value engineering topics, and review each assessment against official sources.
5. Complete a current feature/content inventory and backup/restore drill before declaring KNOWVERSE 4.0 production-ready.

## 9. Safety boundary

This session did not write production learning events, modify production Supabase data, change production permissions, merge a PR, or use production credentials. Both Edge Functions were deployed only to the pinned N2 staging project; all hosted data writes remained confined to synthetic staging accounts.
