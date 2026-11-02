# Phase E — Agent Tool Protocol

## Contract

The model cannot access LearningRepository, IndexedDB or Supabase SQL. It can request up to three read-only data reads and return user-facing text plus a maximum of four structured mutation proposals. The application executes read-only requests with the typed tools, sends a bounded result summary to one follow-up model call, and stops after that second pass. The client validates every mutation proposal against AGENT_TOOL_SCHEMAS; the learner explicitly confirms; the business operation is then validated again by the service.

All schemas use additionalProperties=false. Unknown tool names, properties, IDs, states or out-of-range values are rejected.

## Read tools

| Tool | Purpose |
|---|---|
| get_learner_profile | Evidence-backed learner projection and editable preferences |
| get_learning_goals | Active, paused, completed and cancelled goals |
| get_mastery_snapshot | Existing Learning Intelligence competency states |
| get_active_gaps | Unresolved gap lifecycle and evidence |
| get_learning_graph | Existing topic / competency prerequisite graph |
| get_learning_history | Bounded append-only event history |
| explain_plan | Reasons, budget, dependencies, entry points and completion rules |
| get_next_learning_action | Next in-progress / ready / locked action |
| get_review_recommendations | Existing review queue |

## Mutation proposals

| Tool | Service boundary |
|---|---|
| create_learning_goal | Goal Manager |
| update_learning_goal | Goal Manager plus derived profile |
| generate_learning_plan | Plan Manager plus deterministic Planner |
| replan_learning | Plan Manager plus deterministic Planner |
| start_learning_task | Orchestrator |
| complete_learning_task | Orchestrator plus evidence validator |
| pause_learning_task | Orchestrator |
| accept_learning_plan | Plan Manager; creates tasks atomically |
| reject_learning_plan | Plan Manager; keeps revision history |

The tool executor rejects a mutation request when its origin is the model or when the learner has not confirmed it.

## Provider response

Version 1 response shape:

- version: 1
- reply: string
- dataRequests: up to three read-only tool requests with toolName and schema-validated input
- suggestions: up to four mutation proposals with toolName, schema-validated input, label and reason

Read-only data requests execute without a confirmation prompt because they do not mutate user state. Their result is bounded and returned to the model for one final pass. A second set of data requests is not executed, preventing unbounded tool loops.

Only known mutating tools are permitted as suggestions. A suggestion is not executed on receipt. Both Edge Function and browser validate its shape; the business layer validates graph IDs and state transitions again.

## Error and fallback contract

Authentication, authorization, provider missing, quota, HTTP failure, timeout, invalid JSON and schema failure have distinct error codes. The UI preserves the local learning journal and falls back to deterministic local responses.
