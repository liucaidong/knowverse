import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20261113041514_phase_n_learning_agent_event_sync.sql", import.meta.url), "utf8");
const phaseF = await readFile(new URL("../supabase/migrations/20261102190100_phase_f_proactive_projection.sql", import.meta.url), "utf8");
const proactive = await readFile(new URL("../assets/js/proactive-learning-engine.mjs", import.meta.url), "utf8");

function allowedEventTypes() {
  const match = migration.match(/v_allowed_types\s+text\[\]\s*:=\s*array\[([\s\S]*?)\];/i);
  assert.ok(match, "the server must keep an explicit event allowlist");
  return new Set([...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]));
}

test("Staging sync allowlist covers every learning-agent domain event", () => {
  const allowed = allowedEventTypes();
  const required = [
    "attempt", "hint", "hint_revealed", "completed", "checkpoint_started",
    "review_started", "assessment_passed", "activity", "plan_action_started",
    "plan_action_completed", "learner_preferences_updated",
    "learning_goal_created", "learning_goal_updated", "learning_goal_paused",
    "learning_goal_resumed", "learning_goal_completed", "learning_goal_cancelled",
    "learning_goal_deleted", "learning_plan_generated", "learning_plan_superseded",
    "learning_plan_accepted", "learning_plan_rejected", "learning_tasks_created",
    "learning_task_created", "learning_task_ready", "learning_task_in_progress",
    "learning_task_paused", "learning_task_completed", "learning_task_failed",
    "learning_task_skipped", "learning_task_cancelled", "learning_strategy_calibrated",
    "learning_strategy_feedback",
  ];
  for (const type of required) assert.ok(allowed.has(type), "cloud sync must accept " + type);
  assert.equal(allowed.size, required.length, "avoid silently broadening the server event allowlist");
});

test("event sync keeps auth, allowlist, device, idempotency, payload and schema guards", () => {
  for (const fragment of [
    "auth.uid()", "private.is_authorized_user(v_user_id)", "device_not_registered_or_revoked",
    "event_id_payload_conflict", "device_sequence_conflict", "v_event_type = any(v_allowed_types)",
    "octet_length(v_payload::text) > 16384", "eventSchemaVersion",
    "for update", "public.learning_events",
  ]) assert.ok(migration.includes(fragment), "migration must preserve security guard: " + fragment);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /grant execute on function public\.sync_push_learning_events\(uuid, jsonb\) to authenticated/i);
});

test("document migration permits the versioned goal, plan, task and Agent records", () => {
  for (const type of [
    "learner_profile", "learning_goal", "learning_plan", "learning_plan_head",
    "learning_task", "learning_agent_session", "learning_agent_message",
    "proactive_learning_projection",
  ]) assert.ok(phaseF.includes("'" + type + "'"), "cloud document schema must permit " + type);
});

test("oversized disposable projections do not block the learning page", () => {
  assert.match(proactive, /new TextEncoder\(\)\.encode\(JSON\.stringify\(payload\)\)\.byteLength/);
  assert.match(proactive, /if \(payloadBytes > 65536\)/);
  assert.match(proactive, /cachePersisted: false/);
  assert.match(proactive, /cacheSkipReason: "local-cache-payload-limit"/);
});
