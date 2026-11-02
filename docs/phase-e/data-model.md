# Phase E — Data Model

## Persistence choices

Phase E uses the existing IndexedDB v4 learningDocuments store and learningEvents journal through LearningRepository. Computed mastery is not copied into another table or profile JSON snapshot.

| Document type | Key | Purpose | Update behavior |
|---|---|---|---|
| learner_profile | preferences | Editable learner preferences only | Versioned CAS |
| learning_goal | goalId | One learner-owned goal | Versioned CAS plus lifecycle events |
| learning_plan | planId | One plan revision and status transition | Versioned CAS; previous revisions retained |
| learning_plan_head | current | Active and proposed plan pointers | Versioned CAS |
| learning_task | taskId | Executable task and recoverable execution state | Versioned CAS plus transition events |
| learning_agent_session | sessionId | Session metadata and message count | Versioned CAS |
| learning_agent_message | messageId | One user / assistant message | Individually keyed message document |
| plan_preferences | preferences | Existing deterministic Planner options | Existing document contract |

## Goal fields

goalId, title, description, topicIds, competencyIds, targetAt, dailyMinutes, priority, acceptanceCriteria, status, createdAt, updatedAt, revision and source.

Topic and competency IDs are validated against the existing registry. Goal progress is a derived projection. Topic-scoped goals evaluate all competencies in those topics; competency-scoped goals evaluate the selected competency set.

## Plan fields

planId, version, date, horizonDays, activeStudyDays, schedule, generatedAt, status, reason, supersedesPlanId, supersedesProposalId, linkedGoalIds, goalAllocations, dailyMinutes, totalBudgetMinutes, plannedMinutes, remainingMinutes, actions, plannerVersion, acceptedAt and rejectedAt.

Each action carries actionId, planDate, sequence, competency/topic, goal links, priority, priority reasons, estimated minutes, resource type/title/URL, variant and gap ID.

## Task fields

taskId, planId, planDate, actionId, taskType, title, competency/topic, linked goals, priority and reasons, estimated minutes, resource entry point, variantId, gapId, dependsOnTaskIds, evidencePolicy, status, revision, timestamps, currentStartedAt, accumulated time and evidenceEventIds.

## Agent session fields

Session metadata contains title, created / updated / latest-message timestamps, message count, context scope and version. Message documents contain messageId, sessionId, role, text, creation time and bounded metadata. Messages are stored independently rather than inside a growing session JSON document.

## Event facts

Events remain append-only. New event families include:

- learner_preferences_updated
- learning_goal_created, learning_goal_updated, learning_goal_paused, learning_goal_resumed, learning_goal_completed, learning_goal_cancelled, learning_goal_deleted
- learning_plan_generated, learning_plan_accepted, learning_plan_rejected, learning_plan_superseded
- learning_tasks_created, learning_task_created, learning_task_in_progress, learning_task_paused, learning_task_completed, learning_task_failed, learning_task_skipped, learning_task_cancelled, learning_task_ready

All use the established event envelope and causal-reference normalization. A task lifecycle event is not a completed or assessment_passed mastery event.

## Cloud migration

20261103000000_phase_e_learning_documents.sql extends the check constraint on the existing learning_archive_documents table and replaces the existing sync_push_learning_documents function with the same authenticated-user, active-device, payload-size, idempotency and CAS conflict semantics. It does not add a parallel table, drop data, truncate, reset the schema or rewrite an applied migration.
