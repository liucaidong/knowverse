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

test("single initial schema is the complete database source of truth", async () => {
  const sql = await read("supabase/migrations/20261102032732_initial_schema.sql");
  assert.match(sql, /create schema if not exists private/i);
  assert.match(sql, /private\.authorized_users/i);
  assert.match(sql, /revoke all on private\.authorized_users from public, anon, authenticated/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /unique \(user_id, device_id, device_seq\)/i);
  assert.match(sql, /unique \(user_id, user_seq\)/i);
  const publicFunctions = [...sql.matchAll(/create function public\.[\s\S]*?\n\$\$;/gi)].map(match => match[0]);
  assert.equal(publicFunctions.length, 6);
  for (const routine of publicFunctions) {
    assert.match(routine, /security invoker/i);
    assert.doesNotMatch(routine, /security definer/i);
  }
  assert.equal((sql.match(/create table public\.learning_events/gi) || []).length, 1);
  assert.equal((sql.match(/security definer/gi) || []).length, 2, "only the two private helper functions may run as definer");
  const policyNames = [...sql.matchAll(/create policy "([^"]+)"/gi)].map(match => match[1]);
  assert.equal(policyNames.length, 15);
  assert.equal(new Set(policyNames).size, 15);
  assert.doesNotMatch(sql, /schema_version\s+in\s*\(2\s*,\s*3\)/i);
  assert.doesNotMatch(sql, /drop policy if exists|legacy|compatibility|V1\s*→\s*V2/i);
  assert.match(sql, /alter table public\.learning_archive_documents enable row level security/i);
  assert.match(sql, /create policy "append own authorized learning events"/i);
  assert.match(sql, /create policy "update own authorized archive documents"/i);
});

test("repository preserves the applied baseline and adds one forward event-envelope migration", async () => {
  const { readdir } = await import("node:fs/promises");
  const migrations = (await readdir(new URL("../supabase/migrations/", import.meta.url)))
    .filter(name => name.endsWith(".sql")).sort();
  assert.deepEqual(migrations, [
    "20261102032732_initial_schema.sql",
    "20261102090144_gap_causality_v3.sql",
  ]);
  const forward = await read("supabase/migrations/20261102090144_gap_causality_v3.sql");
  assert.match(forward, /schema_version set default 3/i);
  assert.match(forward, /check \(schema_version = 3\)/i);
  assert.match(forward, /targetGapEventIds/i);
  assert.match(forward, /gapObservationId/i);
  assert.match(forward, /security invoker/i);
  assert.match(forward, /payload_hash = encode/i);
  assert.doesNotMatch(forward, /security definer/i);
});

test("local event journal keeps cloud events out of the outbound queue", async () => {
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
  assert.ok(sync.includes("persistLearningEvents(event.detail?.events || [], { queue: true })"));
  assert.match(sync, /setSyncCursor/);
  assert.match(sync, /previousCursor/);
  assert.match(sync, /async function restoreFromCloud\(\)/);
  const restore = sync.slice(sync.indexOf("async function restoreFromCloud()"), sync.indexOf("async function sync()"));
  assert.match(restore, /pullEvents\(userId\)/);
  assert.match(restore, /pullDocuments\(userId\)/);
  assert.match(restore, /captureLocalLearningArchive/);
  assert.match(restore, /bound-user-id/);
  assert.match(restore, /while \(running\)/);
  assert.match(restore, /setTimeout\(resolve, 25\)/);
  assert.doesNotMatch(restore, /pushEvents|pushDocuments|reconcileLocalSnapshot/,
    "explicit restore must not upload local data before the user chooses to sync");
});


test("one current IndexedDB archive stores events, Outbox, documents and conflicts", async () => {
  const store = await read("assets/js/backend/local-event-store.mjs");
  const archive = await read("assets/js/backend/local-archive.mjs");
  assert.match(store, /const DB_VERSION = 1/);
  for (const name of ["outbox", "meta", "documents", "conflicts"]) {
    assert.match(store, new RegExp('STORE_' + name.toUpperCase()));
  }
  assert.doesNotMatch(store, /STORE_MIGRATIONS|getMigrationRecord|setMigrationRecord|STORE_EVENTS/);
  assert.match(store, /LearningStateStorage envelope is the single local domain-state source/i);
  assert.match(archive, /createLearningStateStorage/);
  assert.doesNotMatch(archive, /legacy|compatibility|migrateLegacyLocalStorage|knowverse:learning-progress:v1/);
  for (const type of ["challenge_progress", "review_session", "plan_preferences"]) assert.ok(store.includes(type));
  assert.match(archive, /hydrateLearningArchiveDocuments/);
  assert.match(archive, /captureLocalLearningArchive/);
});

test("document conflict handling uses optimistic revisions and never silently overwrites", async () => {
  const store = await read("assets/js/backend/local-event-store.mjs");
  const sync = await read("assets/js/backend/sync-engine.mjs");
  const migration = await read("supabase/migrations/20261102032732_initial_schema.sql");
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
  const migration = await read("supabase/migrations/20261102032732_initial_schema.sql");
  assert.match(migration, /auth\.uid\(\)/i);
  assert.match(migration, /private\.is_authorized_user/i);
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /create or replace function public\.[\s\S]{0,180}security definer/i);
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
  assert.match(panel, /退出登录统一使用页面顶部的「全站账户」入口/);
  assert.doesNotMatch(panel, /signIn[.]addEventListener|signOut[.]addEventListener/);
});


test("learning journal uses one current schema and never falls back to legacy keys", async () => {
  const source = await read("assets/js/learning-progress.mjs");
  assert.match(source, /const SCHEMA_VERSION = 1/);
  assert.match(source, /const STORAGE_KEY = "knowverse:learning-progress"/);
  assert.match(source, /createLearningStateStorage/);
  assert.doesNotMatch(source, /LEGACY_STORAGE_KEY|parsedLegacy|schemaVersion === 0|schemaVersion === 2/);
  assert.match(source, /EVENT_SCHEMA_VERSION = 3/);
  assert.match(source, /normalizeLearningEvent/);
  assert.match(source, /stable event ID must always describe the same immutable fact/);
  assert.match(source, /fingerprintLearningEvent/);
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
  assert.match(panel, /从云端恢复/);
  assert.match(panel, /最近云端恢复/);
  assert.match(bootstrap, /BACKEND_CONFIG/);
  assert.match(bootstrap, /stopSyncRuntime?.()/);
  assert.match(bootstrap, /bootstrapError/);
  assert.match(panel, /runtime.bootstrapError/);
  assert.match(bootstrap, /createLearningSyncService/);
});


test("single baseline defines each archive object exactly once", async () => {
  const migration = await read("supabase/migrations/20261102032732_initial_schema.sql");
  const count = fragment => migration.split(fragment).length - 1;
  assert.equal(count("create function private.normalize_learning_event_envelope()"), 1);
  assert.equal(count("create table public.learning_archive_documents"), 1);
  assert.equal(count("create function public.sync_push_learning_documents("), 1);
  assert.equal(count("create function public.sync_pull_learning_documents("), 1);
  assert.match(migration, /v_schema_text <> '2'/i);
  assert.match(migration, /security invoker/i);
  assert.equal((migration.match(/security definer/gi) || []).length, 2);
  assert.match(migration, /revoke all on function public.rls_auto_enable\(\)/i);
});


test("all local learning domains share one versioned atomic persistence envelope", async () => {
  const storage = await read("assets/js/learning-state-storage.mjs");
  const challenge = await read("assets/js/challenge-engine.mjs");
  const review = await read("assets/js/review-engine.mjs");
  const planner = await read("assets/js/learning-planner.mjs");
  assert.match(storage, /LEARNING_STATE_STORAGE_KEY = "knowverse:learning-state"/);
  assert.match(storage, /transaction\(callback\)/);
  assert.match(storage, /afterCommit\(callback\)/);
  assert.match(storage, /External effects \(Outbox enqueue/);
  assert.match(storage, /storage\.setItem\(LEARNING_STATE_STORAGE_KEY/);
  assert.match(storage, /Supabase Auth keys are never included/);
  assert.match(challenge, /createLearningStateStorage/);
  assert.match(challenge, /return storage\.transaction\(\(\) =>/);
  assert.match(review, /createLearningStateStorage/);
  assert.match(review, /storage\.transaction\(\(\) =>/);
  assert.match(planner, /createLearningStateStorage/);
});


test("a clean WebKit mobile profile exercises pull-only recovery of active learning state", async () => {
  const e2e = await read("scripts/e2e-cross-device-archive.mjs");
  const fixture = await read("scripts/fixtures/archive-harness.html");
  assert.match(e2e, /import \{ chromium, webkit, devices \} from "playwright"/);
  assert.match(e2e, /WebKit iPhone cold start/);
  assert.match(e2e, /restoreFromCloud\(\)/);
  assert.match(e2e, /activeReview\.status, "active"/);
  assert.match(e2e, /restoredDocuments, 4/);
  assert.match(fixture, /createLearningStateStorage/);
  assert.match(fixture, /restoreFromCloud: \(\) => service\.restoreFromCloud\(\)/);
  assert.match(e2e, /initialSync = service\.sync\(\)/);
  assert.match(e2e, /queuedRestore = service\.restoreFromCloud\(\)/);
  assert.match(fixture, /manualRestore/);
  assert.match(fixture, /capture: \(\) => captureLocalLearningArchive\(store\)/);
});
