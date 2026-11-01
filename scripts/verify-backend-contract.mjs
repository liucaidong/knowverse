import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");

test("browser configuration contains public placeholders only", async () => {
  const config = await read("assets/js/backend/public-config.js");
  assert.match(config, /supabaseUrl/);
  assert.match(config, /publishableKey/);
  assert.doesNotMatch(config, /service_role|SUPABASE_SECRET|CLIENT_SECRET|DB_PASSWORD/i);
});

test("cloud migration protects the allowlist and enables row-level security", async () => {
  const sql = await read("supabase/migrations/20261101070000_learning_cloud_sync.sql");
  assert.match(sql, /create schema if not exists private/i);
  assert.match(sql, /private\.authorized_users/i);
  assert.match(sql, /revoke all on private\.authorized_users from public, anon, authenticated/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /private\.is_authorized_user/i);
  assert.match(sql, /unique \(user_id, device_id, device_seq\)/i);
  assert.match(sql, /unique \(user_id, user_seq\)/i);
  assert.match(sql, /sync_push_learning_events/i);
  assert.match(sql, /sync_pull_learning_events/i);
  assert.match(sql, /'checkpoint_started'/i);
});

test("learning event store preserves compatibility and prevents cloud echo", async () => {
  const source = await read("assets/js/learning-progress.mjs");
  assert.match(source, /appendMany\(newEvents, appendOptions = \{\}\)/);
  assert.match(source, /knowverse:learning-events-appended/);
  assert.match(source, /appendOptions\.remote !== true/);
});

test("Pages artifact excludes backend migrations and environment secrets", async () => {
  const workflow = await read(".github/workflows/pages.yml");
  assert.match(workflow, /--exclude='supabase\/'/);
  assert.match(workflow, /--exclude='\.env\*'/);
  assert.match(workflow, /path: _site/);
});

test("sync engine acknowledges Outbox only after server confirmation", async () => {
  const sync = await read("assets/js/backend/sync-engine.mjs");
  assert.ok(sync.indexOf("const confirmed") < sync.indexOf("acknowledgeOutbox(confirmed)"));
  assert.match(sync, /reconcileLocalSnapshot/);
  assert.match(sync, /setSyncCursor/);
  assert.match(sync, /previousCursor/);
});
