# Phase E — Acceptance Record

This file is the acceptance checklist. Its status is updated only from commands and remote service results actually observed.

## Functional acceptance

- [x] Dynamic learner profile derives mastery and gaps from existing Learning Intelligence.
- [x] User-editable learning preferences persist through LearningRepository.
- [x] Goals validate IDs against the existing knowledge map and retain lifecycle audit events.
- [x] Goal progress is based on stable mastery plus no active gaps, not page count.
- [x] Deterministic planner uses active goals, prerequisites, gaps, review timing and a global time budget.
- [x] Multi-day schedule is capped at 14 days and stores per-day budget.
- [x] Proposed plans are separate from accepted plans; acceptance is explicit.
- [x] Plan history and superseded / rejected revisions remain stored.
- [x] Tasks use a legal state machine, future-date locks and CAS-persisted timing.
- [x] Read-task completion does not create mastery evidence.
- [x] Review tasks require a causal chain to a different-variant, no-hint independent pass.
- [x] Agent tools have schemas and model-origin mutations are blocked.
- [x] Agent messages are stored as separate documents.
- [x] Rule mode works without model credentials and clearly reports that it is not LLM output.
- [x] Agent workspace is included in the existing three-pillar navigation.

## Local verification record

- [x] Static content, route, generated shell, search index and Monorepo graph validators.
- [x] Deno type check for the Edge Function.
- [x] Unit and contract tests: 114 passed, 0 failed.
- [x] Monorepo Starter tests: 3 passed, 0 failed.
- [x] Fullstack packaging, lockfile, native config, and device proxy tests: 3 passed, 0 failed.
- [x] Browser E2E matrix: 16 passed, 0 failed across Chromium desktop and WebKit mobile viewport.
- [x] Phase E dedicated tests: profile, goals, multi-day plans, task state / evidence boundaries, Agent tools, provider adapter and persistence.
- [x] git diff --check.

A browser viewport and local simulated offline storage are not a real second-device cloud restore.

## External / live-environment acceptance

- [x] Forward Supabase migration applied to verified project sxcpareycpokcyroufww.
- [x] Edge Function learning-agent deployed and reports ACTIVE with JWT verification enabled.
- [ ] Provider API secret and model name configured by the site owner.
- [ ] Cloud AI response validated using the owner's provider account.
- [ ] Authorized GitHub user performs real cross-device goal / plan / task restore.
- [ ] Physical iPhone device acceptance.

These checks remain separate from local Chromium / WebKit viewport tests. Do not mark Phase E fully accepted until required live items are actually executed.
