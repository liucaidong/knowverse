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
- Pages deployments for `8ccf98c`, `ed4bcea` and `5e02429` completed successfully; the Validate run for `5e02429` also passed. At report time, Validate for `1c8f516` was in progress and Pages deployment was queued; release is not marked green until both finish successfully.

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

The local H1 and Tutor suites passed after these changes. The subsequent local regression run also passed all 31 verifier scripts and all 54 browser cases. The last completed GitHub Validate run for the preceding commit passed; the expanded AI Agent content commit `1c8f516` still requires its own GitHub Validate and Pages completion before release is called green.

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

## 7. Remaining acceptance gaps

| Area | Current status | Required evidence |
|---|---|---|
| Real Tutor / Agent / independent Reviewer model Provider calls | NOT VERIFIED | Staging calls using least-privilege provider credentials; independent Reviewer credential; timeout/429/5xx/invalid-output fail-closed tests |
| AI candidate-to-publication chain | NOT VERIFIED end-to-end | Real staging candidate → deterministic validator → independent Reviewer → explicit human approval → PR → exact Pages comparison → registration |
| Cross-device sync | PostgreSQL isolated tests PASS; hosted Supabase HTTP PASS; Mac Chromium staging browser PASS | Second physical device, offline Outbox, session refresh, weak network/background recovery, account revocation |
| Physical iPhone Safari | NOT VERIFIED | Real device acceptance evidence |
| Formal learning graph coverage | 4/12 topics mapped | Build evidence-backed Concept/Competency/prerequisite/Gap/Assessment/Checkpoint maps for remaining 8 topics; do not manufacture mastery for unmapped topics |
| Content correctness | PARTIAL | Technical/answer-level source review, calibrated difficulty and reviewed explanations for each formal assessment |
| Backup / restore | NOT VERIFIED | Documented backup and restore drill with evidence |

## 8. Next execution order

1. Confirm the `1c8f516` GitHub Validate and Pages runs; repair any remaining CI failures without weakening first-party assertions.
2. Verify the second physical device, offline Outbox / weak-network recovery, session refresh and iPhone Safari; the Mac Chromium staging browser path now passes.
3. Configure and test real staging AI Provider execution for Tutor, Agent and independent Reviewer; verify failure-safe behavior.
4. Prove the complete protected practice publication chain with a synthetic staging candidate and explicit human approval; never auto-merge.
5. Extend formal learning maps selectively to the remaining eight topics, beginning with high-value engineering topics, and review each assessment against official sources.
6. Complete a current feature/content inventory and backup/restore drill before declaring KNOWVERSE 4.0 production-ready.

## 9. Safety boundary

This session did not write production learning events, modify production Supabase data, change production permissions, merge a PR, or use production credentials. All hosted writes were confined to the pinned N2 staging project and synthetic accounts.
