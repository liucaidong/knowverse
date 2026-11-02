# ADR-001: Extend the existing local-first learning architecture for Personal AI Learning Agent

- Status: Accepted
- Date: 2026-11-03
- Scope: KNOWVERSE Phase E

## Context

KNOWVERSE already has an event-sourced learning journal, a knowledge prerequisite graph, Learning Intelligence, a deterministic Planner, IndexedDB v4, a unified LearningRepository, Outbox synchronization and Supabase document CAS. A standalone Agent database or AI chat feature would split the source of truth and risk treating model output as knowledge evidence.

## Decision

1. Keep current knowledge registries and mastery derivation as the only knowledge / mastery source.
2. Persist goals, plan revisions, tasks, learner preferences and Agent session messages as independently keyed documents in the existing archive document store.
3. Persist state transitions, goal changes, plan decisions and execution facts as append-only events.
4. Keep Planner deterministic and extend it with multi-goal ranking and time-horizon allocation.
5. Require learner confirmation before accepting a proposal or invoking any model-suggested mutation.
6. Require Orchestrator state and evidence checks before completing a task.
7. Keep the model server-side behind an authenticated Edge Function, with no service-role credential or model key in the browser.
8. Extend the existing archive document type constraint and CAS push RPC using a forward-only migration.

## Consequences

Positive:
- No duplicate mastery state or parallel learning database.
- Local-first work and offline tasks remain available without a model.
- Plan, task, goal and conversation history can use existing revision / Outbox / CAS behavior.
- Model providers are replaceable through server configuration.
- A model cannot promote its own answer into learning evidence.

Trade-offs:
- Document types share the existing 64 KiB document limit and CAS semantics.
- Long Agent conversation histories are split into one document per message and bounded.
- Replanning produces proposals; learner confirmation is an intentional workflow step.
- Real cloud restoration and AI use require an authorized account and owner-supplied provider configuration.

## Rejected alternatives

- A second Supabase schema or new learner_mastery tables: duplicates derivable facts and breaks the single Repository boundary.
- A giant LocalStorage or profile JSON snapshot: weakens atomicity and cross-device conflict behavior.
- Direct model-to-database or model-to-tool execution: bypasses deterministic constraints and user consent.
- Automatically overwriting the active plan: destroys user agency and audit history.
