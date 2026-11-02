# Phase E — Adaptive Planner Engine

## Existing algorithm retained

buildAdaptiveLearningPlan() remains the core candidate and prerequisite engine. It derives Intelligence from actual events and the current map; Phase E adds a multi-goal ranking layer and multi-day allocation around it.

## Candidate constraints

1. The existing prerequisite graph is evaluated recursively. A missing, unverified or actively weak prerequisite blocks downstream candidates.
2. Existing active gaps and their lifecycle outrank ordinary new-learning candidates.
3. Existing due-review timing and historical evidence determine review candidates.
4. Previously used assessment variants are excluded by the existing candidate/resource selection.
5. Completed actions are read from append-only planner/orchestrator events; repeated actions with no new value are filtered.
6. A task completion event alone never changes mastery or confidence.

## Multi-goal scoring overlay

Each candidate is linked to active goals by exact competency and topic IDs. Its base priority is preserved; a goal bonus adds the goal priority and deadline urgency. Selection adds a coverage bonus for goals not yet represented in the selected set, reducing the chance that one high-priority goal consumes every slot. Shared competencies can serve more than one goal.

The plan stores a per-goal allocation projection so the learner can see selected task time. Goal dailyMinutes is a desired target; the global learner daily budget remains the hard upper bound.

## Time horizon

horizonDays is clamped to 1–14. weeklyDays distributes study days through the horizon. Planner selects from its eligible candidate set using the aggregate scheduled-day budget, then places each selected candidate on the earliest study date with sufficient remaining capacity and fewer than three actions. Today's completed task minutes reduce today's remaining capacity.

The plan records each day budget, planned minutes and action IDs. Tasks scheduled after today are persisted as locked with lockedReason=scheduled-date. They can become ready only after the local calendar reaches the plan date and explicit task dependencies (if present) are complete.

## Replanning

A new goal, preference change, failed attempt, assessment result, task completion or task failure can produce a new proposal. When the Agent workspace was closed, the next open compares recent relevant events against the latest plan generation. New plans receive a new ID and version; old plan and task documents remain available for audit and restore.

The user must accept a new proposal to replace the active plan pointer.
