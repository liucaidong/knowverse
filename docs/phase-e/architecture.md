# Phase E — Personal AI Learning Agent Architecture

## 1. Design decision

Phase E extends the Phase D local-first learning architecture. It does not introduce a second learning database, a separate mastery snapshot, or an independent knowledge graph.

The authoritative boundaries are:

- Learning Intelligence derives mastery, confidence, review state and gaps from the append-only event journal and existing learning-map registry.
- Learner Profile combines those derived facts with user-editable preferences, goals and observed learning behavior.
- Goal Manager validates topic and competency references and owns the goal lifecycle.
- Planner is deterministic. It orders only candidates allowed by prerequisite, mastery, gap, review-variant and time-budget rules.
- Plan Manager versions proposals and accepted plans. Only a learner-confirmed proposal becomes active.
- Orchestrator validates task-state transitions and completion evidence.
- Agent Tools expose typed application-service calls. The model never receives repository or database access.
- LearningRepository remains the only domain-data access boundary.
- IndexedDB v4 remains the complete local learning database; Supabase is the authenticated synchronization copy.

## 2. Runtime architecture

The logical flow is:

1. AI Learning Workspace invokes Learner Profile and the Agent.
2. The Agent either uses the local deterministic rule mode or calls the authenticated server-side Provider.
3. The model returns prose and bounded tool proposals; typed Agent Tools validate inputs and require learner confirmation before mutation.
4. Goal Manager, Plan Manager and Orchestrator call LearningRepository.
5. LearningRepository commits append-only events, versioned documents and Outbox rows using the existing atomic IndexedDB transaction.
6. Learning Intelligence derives mastery and gaps from the event journal and the existing knowledge graph.
7. Planner reads Intelligence, goals, due reviews, variants, budget and task history to create a new proposal.
8. The Phase D Sync Engine uploads events and documents through the existing CAS RPCs.

The model request path is separate from the learning write path. A model response cannot directly mutate mastery or execute a tool.

## 3. Module ownership

| Layer | Module | Responsibility |
|---|---|---|
| Presentation | agent/index.html, assets/js/learning-agent/workspace.mjs | Responsive workspace, user input and explicit confirmation |
| Profile | learner-profile.mjs | Preference persistence and evidence-backed profile projection |
| Goal | goal-manager.mjs | Goal validation, lifecycle and audit events |
| Planning | learning-planner.mjs | Existing mastery-aware candidate generation and deterministic ranking |
| Plan lifecycle | plan-manager.mjs | Proposed / accepted / rejected / superseded revisions |
| Execution | task-orchestrator.mjs | Task mapping, state machine, evidence gates and resumable timing |
| Agent protocol | agent-tools.mjs | JSON input schemas, business-service dispatch and confirmation boundary |
| Provider | agent-provider.mjs | Authenticated Edge Function request, timeout and response validation |
| Offline Agent | local-agent.mjs | Deterministic answers and plan actions without a model |
| Session | agent-session-store.mjs | Individually versioned session and message documents |
| Persistence | backend/learning-repository.mjs | Account boundary, atomic events / documents and local Outbox |
| Cloud | supabase/functions/learning-agent | Authenticated server-side model proxy only |

## 4. Data flow

1. A learner creates or updates a goal. Goal Manager validates each topic and competency against the existing learning map, appends an audit event and commits a versioned goal document.
2. Planner reads the existing event journal, current Intelligence projection, active goals, review state and learner preferences.
3. Plan Manager saves a proposed revision and updates the plan-head pointer atomically. An older proposal is marked superseded; an accepted plan remains active.
4. The UI presents recommendation reasons, resource entry points, dates, time estimates and completion evidence rules.
5. Only explicit learner acceptance atomically changes the plan to accepted, updates the head pointer and creates task documents.
6. Orchestrator changes a task through its state machine and appends a task fact in the same Repository commit.
7. Existing challenge, checkpoint and review flows remain the owners of attempt, completed and assessment-passed evidence. Task events are not mastery evidence.
8. New learning facts trigger a new proposal. The active plan is retained until the learner accepts the proposal.

## 5. Replanning triggers

When the Agent workspace is open, it listens to the Repository learning-events-appended notification. Relevant events include attempts, assessment results, task completion/failure, goal changes and learner preference changes. When the workspace is reopened, it compares newer relevant events with the latest plan generation time and offers a fresh proposal.

Replanning creates a new revision; it does not mutate accepted task history. A newer proposal can supersede an older proposal, but never silently replaces the accepted plan.

## 6. Offline and synchronization boundary

All goal, plan, task, profile preference and Agent-session writes use LearningRepository commit / documents APIs. The current IndexedDB document store, CAS revision, Outbox, per-account binding and Phase D Sync Engine remain in use. New cloud document types are added to the existing document contract by a forward migration. No direct IndexedDB or PostgreSQL access is introduced in domain modules.

Conflict handling stays with the existing revision/CAS conflict queue. Phase E does not add last-write-wins conflict resolution.
