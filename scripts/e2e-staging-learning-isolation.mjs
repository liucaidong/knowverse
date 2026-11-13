#!/usr/bin/env node
/**
 * Verify that the two synthetic KNOWVERSE Staging accounts cannot read each
 * other's actual learning-goal documents or append-only goal-created events.
 * Credentials are read only from the ignored .env.n2.local file and never logged.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const STAGING_ORIGIN = "https://ypthoicwrfsblaidllyy.supabase.co";
const envText = await readFile(new URL("../.env.n2.local", import.meta.url), "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/)
  .filter(line => line && !line.trimStart().startsWith("#") && line.includes("="))
  .map(line => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
  }));
assert.equal(env.N2_SUPABASE_URL, STAGING_ORIGIN,
  "Safety stop: this acceptance only permits the pinned KNOWVERSE Staging project.");
for (const key of ["N2_SUPABASE_PUBLISHABLE_KEY", "N2_SYNC_A_EMAIL", "N2_SYNC_A_PASSWORD", "N2_SYNC_B_EMAIL", "N2_SYNC_B_PASSWORD"]) {
  assert.ok(env[key], `Missing local Staging setting ${key}`);
}

const apiKey = env.N2_SUPABASE_PUBLISHABLE_KEY;
async function signIn(email, password) {
  const response = await fetch(STAGING_ORIGIN + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(response.ok, "Synthetic Staging Auth sign-in failed.");
  const session = await response.json();
  assert.ok(session.access_token && session.user?.id);
  return session.access_token;
}

async function rest(actor, resource, params) {
  const response = await fetch(STAGING_ORIGIN + "/rest/v1/" + resource + "?" + new URLSearchParams(params), {
    headers: { apikey: apiKey, Authorization: "Bearer " + actor, Accept: "application/json" },
  });
  assert.equal(response.status, 200, `RLS query failed for ${resource}: HTTP ${response.status}`);
  return response.json();
}

const [accountA, accountB] = await Promise.all([
  signIn(env.N2_SYNC_A_EMAIL, env.N2_SYNC_A_PASSWORD),
  signIn(env.N2_SYNC_B_EMAIL, env.N2_SYNC_B_PASSWORD),
]);
const [goalA, goalB] = await Promise.all([
  rest(accountA, "learning_archive_documents", {
    select: "document_key", document_type: "eq.learning_goal", order: "updated_at.desc", limit: "1",
  }),
  rest(accountB, "learning_archive_documents", {
    select: "document_key", document_type: "eq.learning_goal", order: "updated_at.desc", limit: "1",
  }),
]);
assert.equal(goalA.length, 1, "Account A must have a persisted synthetic learning goal.");
assert.equal(goalB.length, 1, "Account B must have a persisted synthetic learning goal.");
const goalIdA = goalA[0].document_key;
const goalIdB = goalB[0].document_key;
assert.notEqual(goalIdA, goalIdB, "Synthetic accounts must own different goal IDs.");

const [aOwnGoal, bOwnGoal, aSeesBGoal, bSeesAGoal] = await Promise.all([
  rest(accountA, "learning_archive_documents", { select: "document_key", document_type: "eq.learning_goal", document_key: "eq." + goalIdA }),
  rest(accountB, "learning_archive_documents", { select: "document_key", document_type: "eq.learning_goal", document_key: "eq." + goalIdB }),
  rest(accountA, "learning_archive_documents", { select: "document_key", document_type: "eq.learning_goal", document_key: "eq." + goalIdB }),
  rest(accountB, "learning_archive_documents", { select: "document_key", document_type: "eq.learning_goal", document_key: "eq." + goalIdA }),
]);
assert.equal(aOwnGoal.length, 1);
assert.equal(bOwnGoal.length, 1);
assert.equal(aSeesBGoal.length, 0, "Account A must not read Account B's learning goal.");
assert.equal(bSeesAGoal.length, 0, "Account B must not read Account A's learning goal.");

const eventIdA = `goal:${goalIdA}:learning_goal_created:1`;
const eventIdB = `goal:${goalIdB}:learning_goal_created:1`;
const [aOwnEvent, bOwnEvent, aSeesBEvent, bSeesAEvent] = await Promise.all([
  rest(accountA, "learning_events", { select: "event_id", event_id: "eq." + eventIdA }),
  rest(accountB, "learning_events", { select: "event_id", event_id: "eq." + eventIdB }),
  rest(accountA, "learning_events", { select: "event_id", event_id: "eq." + eventIdB }),
  rest(accountB, "learning_events", { select: "event_id", event_id: "eq." + eventIdA }),
]);
assert.equal(aOwnEvent.length, 1);
assert.equal(bOwnEvent.length, 1);
assert.equal(aSeesBEvent.length, 0, "Account A must not read Account B's learning event.");
assert.equal(bSeesAEvent.length, 0, "Account B must not read Account A's learning event.");

console.log("PASS: Staging RLS isolates learning-goal documents and goal-created events in both directions.");
