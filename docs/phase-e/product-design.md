# Phase E — Product Design

## Primary experience

The new Personal AI Learning Agent route is integrated under the existing Learning Growth navigation group. KNOWVERSE retains its three top-level product pillars and its existing knowledge, engineering-practice and architecture-exploration lines.

The workspace has four connected regions:

1. Agent conversation explains learning state, answers planning questions and proposes actions. Local deterministic mode is always available. Cloud AI is an explicit per-message opt-in.
2. Learner profile shows evidence-backed mastery counts, current gaps, recent assessment evidence, learning days, hint-assisted attempt rate, task completion and active goal progress.
3. Goal management creates, edits, pauses, resumes, completes, cancels and archives goals.
4. Adaptive plan and execution shows a proposed plan separately from the active plan, with rationale, schedule, time budget, resource link, task status and action controls.

## Goal contract

A goal must name at least one existing topic or competency. It records description, target date, desired daily minutes, priority and acceptance criteria. Goal completion is not based on pages read or actions clicked. It is allowed only when all scoped competencies have stable mastery and no active gap according to Learning Intelligence.

Goal removal is a tombstone plus an audit event. Earlier goals and learning events remain in history.

## Plan contract

Plans can span 1–14 calendar days. Weekly study frequency controls the scheduled study-day pattern; the daily budget is applied independently to each scheduled day. The Planner selects from the existing deterministic candidate set, then allocates candidates to the earliest eligible study day with remaining budget and a maximum of three actions on a day.

Every task has a date, estimated minutes, knowledge scope, resource link, reason and evidence policy. A future task is stored as locked until its plan date. A plan is a proposal until accepted.

## Task contract

The supported states and transitions are:

- locked → ready only when the scheduled date has arrived and explicit dependencies are completed.
- ready → in_progress, skipped or cancelled.
- in_progress → paused, completed, failed or cancelled.
- paused → in_progress, skipped or cancelled.
- failed → ready for an explicit retry, or cancelled.
- completed, skipped and cancelled are terminal.

A read task can be learner-confirmed as completed, but it creates no mastery evidence. Assessment tasks require an assessment_passed event. Targeted gap-review tasks require a different variant, no hints, and a causal chain linking the original failure, review_started, a correct review attempt and assessment_passed.

## Agent behavior

Rule mode can inspect the real profile, explain current gaps, explain plan rationale, show the next action and generate plans. It does not imitate an LLM answer. When AI is enabled and configured, the Edge Function receives only a bounded summary of goals, mastery, active gaps and a small recent conversation window. Tool suggestions are still proposals and are not applied until the learner confirms them.

## Current experience boundaries

- AI-generated prose depends on an external provider configured by the site owner. Without secrets, the app reports the unavailable state and falls back to local rules.
- Cross-device cloud restore requires a logged-in, authorized account and the forward migration to be applied. Local offline restoration is independently available.
- Browser E2E covers Chromium desktop and a WebKit mobile viewport. It is not a physical iPhone certification.
