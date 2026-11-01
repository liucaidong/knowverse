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


test("IndexedDB v2 stores the complete restorable archive and preserves legacy sources", async () => {
  const store = await read("assets/js/backend/local-event-store.mjs");
  const archive = await read("assets/js/backend/local-archive.mjs");
  assert.match(store, /const DB_VERSION = 2/);
  for (const name of ["events", "outbox", "meta", "documents", "migrations", "conflicts"]) {
    assert.match(store, new RegExp('STORE_' + name.toUpperCase()));
  }
  for (const type of ["challenge_progress", "review_session", "plan_preferences"]) {
    assert.ok(store.includes(type));
  }
  assert.match(archive, /legacy-localstorage-v1/);
  assert.match(archive, /knowverse:learning-progress:v1/);
  assert.match(archive, /knowverse:challenge:v1:/);
  assert.match(archive, /knowverse:review-session:v1:/);
  assert.match(archive, /knowverse:learning-plan:preferences:v1/);
  assert.match(archive, /原始 V1 数据仍保留/);
  assert.match(archive, /copy-and-verify; legacy keys are never removed/);
  assert.match(store, /getMigrationRecord/);
  assert.match(store, /setMigrationRecord/);
  assert.match(archive, /setMigrationRecord/);
});

test("document conflict handling uses optimistic revisions and never silently overwrites", async () => {
  const store = await read("assets/js/backend/local-event-store.mjs");
  const sync = await read("assets/js/backend/sync-engine.mjs");
  const migration = await read("supabase/migrations/20261101110000_learning_archive_documents.sql");
  assert.match(store, /baseRevision/);
  assert.match(store, /previous\?\.dirty && Number\(previous\.baseRevision \|\| 0\) < revision/);
  assert.match(store, /resolveArchiveConflict/);
  assert.match(sync, /sync_push_learning_documents/);
  assert.match(sync, /sync_pull_learning_documents/);
  assert.match(migration, /v_current\.revision <> v_base_revision/);
  assert.match(migration, /v_current\.payload_hash = v_payload_hash/);
  assert.match(migration, /user_document_sync_state/);
  assert.match(migration, /enable row level security/i);
});

test("sync retry, online recovery, visibility refresh and per-user account binding exist", async () => {
  const sync = await read("assets/js/backend/sync-engine.mjs");
  const auth = await read("assets/js/backend/auth.mjs");
  assert.match(sync, /Math\.min\(300000, 1200 \* \(2 \*\* retryAttempt\)\)/);
  assert.match(sync, /addEventListener\("online"/);
  assert.match(sync, /visibilitychange/);
  assert.match(sync, /setDocumentSyncCursor/);
  assert.match(sync, /bound-user-id/);
  assert.match(auth, /response\.status === 401/);
  assert.match(auth, /grant_type=refresh_token/);
  assert.match(auth, /this\.clearSession\(\)/);
});

test("cloud documents and events are isolated with authenticated RPC and RLS", async () => {
  const migration = await read("supabase/migrations/20261101110000_learning_archive_documents.sql");
  assert.match(migration, /auth\.uid\(\)/i);
  assert.match(migration, /private\.is_authorized_user/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /revoke all on function public\.sync_push_learning_documents[\s\S]*from public, anon/i);
  assert.match(migration, /grant execute on function public\.sync_push_learning_documents[\s\S]*to authenticated/i);
  assert.match(migration, /document_seq/);
  assert.match(migration, /revision/);
  assert.match(migration, /causation_event_ids/);
});

test("account panel exposes local, device, network, sync and conflict state", async () => {
  const panel = await read("assets/js/backend/account-panel.mjs");
  assert.match(panel, /当前设备/);
  assert.match(panel, /本地学习事件/);
  assert.match(panel, /待上传事件/);
  assert.match(panel, /最近成功同步/);
  assert.match(panel, /navigator\.onLine/);
  assert.match(panel, /保留本机版本/);
  assert.match(panel, /采用云端版本/);
  assert.match(panel, /退出登录/);
});


test("legacy V1 events remain readable when the V2 key is corrupt and V3 event schema is preserved", async () => {
  const source = await read("assets/js/learning-progress.mjs");
  assert.match(source, /isSupportedSnapshot/);
  assert.match(source, /parsedLegacy/);
  assert.match(source, /eventSchemaVersion: \[2, 3\]/);
});


test("one document conflict is counted once when both push and pull report the same revision", async () => {
  const sync = await read("assets/js/backend/sync-engine.mjs");
  assert.match(sync, /const conflictIds = new Set\(\)/);
  assert.match(sync, /new Set\(\[\.\.\.pushedDocuments\.conflictIds, \.\.\.pulledDocuments\.conflictIds\]\)\.size/);
});


test("one shared archive runtime auto-syncs from every page and powers the account panel", async () => {
  const bootstrap = await read("assets/js/backend/archive-bootstrap.mjs");
  const panel = await read("assets/js/backend/account-panel.mjs");
  assert.match(bootstrap, /createLearningSyncService/);
  assert.match(bootstrap, /syncService\.start\(\)/);
  assert.match(bootstrap, /syncService\.initialize\(\)/);
  assert.match(bootstrap, /getArchiveRuntime/);
  assert.match(panel, /getArchiveRuntime/);
  assert.doesNotMatch(panel, /createLearningSyncService|syncService\.start\(\)/);
  assert.match(panel, /立即同步/);
  assert.match(bootstrap, /BACKEND_CONFIG/);
});
