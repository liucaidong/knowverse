import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");

test("browser configuration contains public Supabase credentials only", async () => {
  const config = await read("assets/js/backend/public-config.js");
  assert.match(config, /supabaseUrl/);
  assert.match(config, /publishableKey/);
  assert.doesNotMatch(config, /service_role|SUPABASE_SECRET|CLIENT_SECRET|DB_PASSWORD/i);
});

test("the established PostgreSQL schema remains the source of truth and all learning tables retain RLS", async () => {
  const sql = await read("supabase/migrations/20261102032732_initial_schema.sql");
  assert.match(sql, /create schema if not exists private/i);
  assert.match(sql, /private\.authorized_users/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /unique \(user_id, device_id, device_seq\)/i);
  assert.match(sql, /unique \(user_id, user_seq\)/i);
  for (const table of ["learning_events", "learning_archive_documents", "user_devices", "user_sync_state", "user_document_sync_state"]) {
    assert.match(sql, new RegExp("alter table public\\." + table + " enable row level security", "i"));
  }
  const policies = [...sql.matchAll(/create policy "([^"]+)"/gi)].map(match => match[1]);
  assert.equal(new Set(policies).size, policies.length);
  assert.match(sql, /private\.is_authorized_user/i);
  assert.match(sql, /security invoker/i);
});

test("the Phase D database migration is additive, atomic and tightly permissioned", async () => {
  const migration = await read("supabase/migrations/20261102114344_phase_d_atomic_learning_batch.sql");
  for (const routine of [
    "sync_commit_learning_batch",
    "sync_pull_learning_events_for_account",
    "sync_pull_learning_documents_for_account",
  ]) assert.match(migration, new RegExp("create function public\\." + routine, "i"));
  assert.equal((migration.match(/security invoker/gi) || []).length, 3);
  assert.equal((migration.match(/set search_path = ''/gi) || []).length, 3);
  assert.match(migration, /auth\.uid\(\)/i);
  assert.match(migration, /private\.is_authorized_user/i);
  assert.match(migration, /p_expected_user_id is distinct from v_user_id/i);
  assert.match(migration, /sync_push_learning_documents/);
  assert.match(migration, /sync_push_learning_events/);
  assert.match(migration, /phase_d_document_cas_conflict/);
  assert.match(migration, /revoke all on function public\.sync_commit_learning_batch[\s\S]*from public, anon/i);
  assert.match(migration, /grant execute on function public\.sync_commit_learning_batch[\s\S]*to authenticated/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.doesNotMatch(migration, /drop table|truncate|delete from public\./i);
});

test("local IndexedDB is the complete canonical learning database", async () => {
  const store = await read("assets/js/backend/local-event-store.mjs");
  assert.match(store, /const DB_VERSION = 4/);
  for (const name of [
    "learningEvents", "learningDocuments", "outbox", "syncMetadata",
    "devices", "conflicts", "migrationMetadata",
  ]) assert.ok(store.includes('"' + name + '"'), name);
  assert.match(store, /function upgradeDatabase/);
  assert.match(store, /deleteObjectStore/);
  assert.match(store, /byAccountOccurredAt/);
  assert.match(store, /byOrderedAt/);
  assert.match(store, /byAccountOrderedAt/);
  assert.match(store, /outboxCursor/);
  assert.match(store, /pendingLegacyStores/);
  assert.match(store, /finishLegacyStore/);
  assert.doesNotMatch(store, /oldVersion >= 2 && oldVersion < 3/);
  assert.match(store, /function withTransaction/);
  assert.match(store, /commitLearningBatch/);
  assert.match(store, /expectedLocalRevision/);
  assert.match(store, /QuotaExceededError/);
  assert.match(store, /acquireSyncLease/);
});

test("local learning writes persist state, evidence and Outbox in one transaction", async () => {
  const store = await read("assets/js/backend/local-event-store.mjs");
  const challenge = await read("assets/js/challenge-engine.mjs");
  const review = await read("assets/js/review-engine.mjs");
  assert.match(store, /\[STORE_EVENTS, STORE_OUTBOX, STORE_DEVICES, STORE_SYNC, STORE_DOCUMENTS, STORE_MIGRATIONS\]/);
  assert.match(challenge, /repository\.commit\(\{\s*events,\s*documents:/s);
  assert.match(challenge, /expectedLocalRevision/);
  assert.match(review, /repository\.commit\(\{\s*events,\s*documents:/s);
  assert.match(review, /expectedLocalRevision/);
});

test("Learning Repository is the only business access surface and checks active account identity", async () => {
  const repository = await read("assets/js/backend/learning-repository.mjs");
  const progress = await read("assets/js/learning-progress.mjs");
  const challenge = await read("assets/js/challenge-engine.mjs");
  const review = await read("assets/js/review-engine.mjs");
  const planner = await read("assets/js/learning-planner.mjs");
  assert.match(repository, /class LearningRepository/);
  assert.match(repository, /assertAccountBoundary/);
  assert.match(repository, /readStoredSession/);
  assert.match(repository, /getLocalAccountBinding/);
  assert.match(repository, /另一个账户/);
  assert.match(progress, /getLearningRepository/);
  assert.match(challenge, /getLearningRepository/);
  assert.match(review, /getLearningRepository/);
  assert.match(planner, /getLearningRepository/);
  for (const source of [progress, challenge, review, planner]) {
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB\s*\./);
  }
});

test("Phase C migration validates, imports atomically, verifies and only then cleans learning keys", async () => {
  const migration = await read("assets/js/backend/phase-c-migration.mjs");
  assert.match(migration, /PHASE_C_MIGRATION_KEY/);
  assert.match(migration, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(migration, /importPhaseCLearningState/);
  assert.match(migration, /sourceFingerprint/);
  assert.match(migration, /getMigrationMetadata/);
  assert.match(migration, /cleanupSource/);
  assert.ok(migration.includes("Auth,"));
  assert.ok(migration.includes("PKCE, callback state"));
  assert.match(migration, /迁移已停止/);
  assert.match(migration, /迁移后事件核验失败/);
});

test("sync pushes a single atomic batch and advances pull cursors only after local merge", async () => {
  const sync = await read("assets/js/backend/sync-engine.mjs");
  assert.match(sync, /sync_commit_learning_batch/);
  assert.match(sync, /sync_pull_learning_events_for_account/);
  assert.match(sync, /sync_pull_learning_documents_for_account/);
  assert.match(sync, /p_expected_user_id: userId/);
  assert.match(sync, /await acknowledgeOutbox\(confirmedEvents\)/);
  assert.match(sync, /await acknowledgeArchiveDocuments\(confirmedDocuments\)/);
  assert.match(sync, /mergeRemoteLearningEvents\(rows, userId\)/);
  assert.match(sync, /setSyncCursor\(userId, cursor\)/);
  assert.match(sync, /setDocumentSyncCursor\(userId, cursor\)/);
  assert.match(sync, /async function restoreOperation/);
  const restore = sync.slice(sync.indexOf("async function restoreOperation"), sync.indexOf("async function syncOperation"));
  assert.match(restore, /pullEvents\(userId\)/);
  assert.match(restore, /pullDocuments\(userId\)/);
  assert.doesNotMatch(restore, /pushChanges/);
  assert.match(sync, /acquireSyncLease/);
  assert.match(sync, /releaseSyncLease/);
  assert.match(sync, /retryAttempt/);
  assert.match(sync, /addEventListener\("online"/);
  assert.match(sync, /visibilitychange/);
});

test("local documents use explicit revisions, conflict records and tombstones", async () => {
  const store = await read("assets/js/backend/local-event-store.mjs");
  const challenge = await read("assets/js/challenge-engine.mjs");
  const review = await read("assets/js/review-engine.mjs");
  assert.match(store, /expectedLocalRevision/);
  assert.match(store, /baseRevision/);
  assert.match(store, /previous\?\.dirty && Number\(previous\.baseRevision \|\| 0\) < revision/);
  assert.match(store, /resolveArchiveConflict/);
  assert.match(store, /_deleted: true/);
  assert.match(challenge, /expectedLocalRevision/);
  assert.match(review, /expectedLocalRevision/);
});

test("archive bootstrap and account panel use the same repository and sync runtime", async () => {
  const bootstrap = await read("assets/js/backend/archive-bootstrap.mjs");
  const panel = await read("assets/js/backend/account-panel.mjs");
  assert.match(bootstrap, /createLearningProgressStore/);
  assert.match(bootstrap, /createLearningSyncService/);
  assert.match(bootstrap, /syncService\.start\(\)/);
  assert.match(bootstrap, /syncService\.initialize\(\)/);
  assert.match(panel, /getArchiveRuntime/);
  assert.match(panel, /立即同步/);
  assert.match(panel, /从云端恢复/);
  assert.match(panel, /保留本机版本/);
  assert.match(panel, /采用云端版本/);
});

test("Pages deployment excludes Supabase migrations and environment secrets", async () => {
  const workflow = await read(".github/workflows/pages.yml");
  assert.ok(workflow.includes("--exclude='supabase/'"));
  assert.ok(workflow.includes("--exclude='.env*'"));
  assert.match(workflow, /path: _site/);
});

test("the repository has no permanent monolithic learning-state storage facade", async () => {
  const files = await readdir(new URL("../assets/js/", import.meta.url));
  assert.equal(files.includes("learning-state-storage.mjs"), false);
  const modules = [
    "assets/js/learning-progress.mjs",
    "assets/js/challenge-engine.mjs",
    "assets/js/review-engine.mjs",
    "assets/js/learning-planner.mjs",
    "assets/js/backend/local-archive.mjs",
    "assets/js/backend/archive-bootstrap.mjs",
  ];
  for (const path of modules) assert.doesNotMatch(await read(path), /learning-state-storage|createLearningStateStorage/);
});

test("remote archive restores active review sessions and preferences through IndexedDB documents", async () => {
  const engine = await read("assets/js/review-engine.mjs");
  const workspace = await read("assets/js/review-workspace.mjs");
  assert.match(engine, /getActiveSessions/);
  assert.match(engine, /repository\.documents\.list/);
  assert.match(workspace, /getActiveSessions/);
  assert.match(workspace, /自动恢复最近一次未完成的复习现场/);
  assert.match(workspace, /继续复习/);
});

test("all applied SQL migration filenames are present in the repository", async () => {
  const migrations = (await readdir(new URL("../supabase/migrations/", import.meta.url)))
    .filter(name => name.endsWith(".sql")).sort();
  assert.deepEqual(migrations, [
    "20261102032732_initial_schema.sql",
    "20261102090144_gap_causality_v3.sql",
    "20261102114344_phase_d_atomic_learning_batch.sql",
  ]);
});
