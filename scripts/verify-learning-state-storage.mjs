import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");

test("Phase C envelope migration is a one-time bridge, not a runtime storage layer", async () => {
  const migration = await read("assets/js/backend/phase-c-migration.mjs");
  const repository = await read("assets/js/backend/learning-repository.mjs");
  assert.match(migration, /knowverse:learning-state/);
  assert.match(migration, /phase-c-localstorage-to-indexeddb-v1/);
  assert.match(migration, /importPhaseCLearningState/);
  assert.match(migration, /cleanupSource/);
  assert.match(repository, /migratePhaseCLearningState/);
  assert.doesNotMatch(repository, /createLearningStateStorage/);
});

test("Phase C migration preserves old data on invalid source and does not touch Auth or PKCE", async () => {
  const migration = await read("assets/js/backend/phase-c-migration.mjs");
  assert.match(migration, /损坏/);
  assert.match(migration, /原始数据已保留/);
  assert.ok(migration.includes("Auth,"));
  assert.ok(migration.includes("PKCE, callback state"));
  assert.doesNotMatch(migration, /sb-[\w-]+-auth-token|code-verifier|supabase-session/i);
});

test("production learning modules no longer read or write a giant localStorage snapshot", async () => {
  for (const path of [
    "assets/js/learning-progress.mjs",
    "assets/js/challenge-engine.mjs",
    "assets/js/review-engine.mjs",
    "assets/js/learning-planner.mjs",
    "assets/js/backend/local-archive.mjs",
    "assets/js/backend/sync-engine.mjs",
  ]) {
    const source = await read(path);
    assert.doesNotMatch(source, /createLearningStateStorage|knowverse:learning-state|localStorage/);
  }
});
