import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createLearningSyncService } from "../assets/js/backend/sync-engine.mjs";
import {
  countLearningEvents,
  deleteLocalDatabaseForTests,
  setDocumentSyncCursor,
  setSyncCursor,
} from "../assets/js/backend/local-event-store.mjs";

const userId = "79256d8a-d64d-4af6-ae0b-87f764037956";
const remoteEvents = [{
  event_id: "remote-attempt-001",
  user_seq: 1,
  event_payload: {
    id: "remote-attempt-001",
    type: "attempt",
    at: "2026-11-03T09:00:00.000Z",
    topicId: "promise",
    challengeId: "promise-realm",
    stepId: "thenable",
    competencyIds: ["thenable-adoption"],
    correct: false,
    gapId: "thenable-job-timing",
    eventSchemaVersion: 2,
  },
}];

const remoteDocuments = [
  {
    document_id: "challenge_progress:promise-realm",
    document_type: "challenge_progress",
    document_key: "promise-realm",
    revision: 1,
    document_seq: 1,
    device_id: "00000000-0000-4000-8000-000000000001",
    updated_at: "2026-11-03T10:00:00.000Z",
    document_payload: {
      engineVersion: 1, challengeId: "promise-realm", status: "in-progress",
      steps: [{ id: "thenable", status: "active", attempts: 1, hintsUsed: 0, data: {} }],
    },
  },
  {
    document_id: "learner_profile:strategy",
    document_type: "learner_profile",
    document_key: "strategy",
    revision: 1,
    document_seq: 3,
    device_id: "00000000-0000-4000-8000-000000000001",
    updated_at: "2026-11-03T10:01:00.000Z",
    document_payload: { evidence: [], history: [], preferences: {} },
  },
  {
    document_id: "proactive_learning_projection:current",
    document_type: "proactive_learning_projection",
    document_key: "current",
    revision: 4,
    document_seq: 6,
    device_id: "00000000-0000-4000-8000-000000000001",
    updated_at: "2026-11-03T10:02:00.000Z",
    document_payload: { sourceEventCount: 0 },
  },
];

beforeEach(async () => {
  await deleteLocalDatabaseForTests();
});

function createAuth() {
  return {
    async getSession() { return { user: { id: userId, email: "test@example.invalid" } }; },
    async request(path) {
      if (path.endsWith("/get_learning_sync_profile")) return { authorized: true, user_id: userId };
      if (path.endsWith("/register_device")) return { registered: true };
      if (path.endsWith("/sync_pull_learning_events_for_account")) {
        return { events: remoteEvents, next_cursor: 1, has_more: false };
      }
      if (path.endsWith("/sync_pull_learning_documents_for_account")) {
        return { documents: remoteDocuments, next_cursor: 6, has_more: false };
      }
      throw new Error("Unexpected RPC: " + path);
    },
  };
}

test("manual restore replays cloud history even when the saved cursor is already ahead", async () => {
  const service = createLearningSyncService(createAuth(), null, { enabled: true });
  // Simulate a cursor surviving while the corresponding local archive rows are missing.
  await setSyncCursor(userId, 1);
  await setDocumentSyncCursor(userId, 6);
  const first = await service.restoreFromCloud();
  assert.equal(first.status, "restored");
  assert.equal(first.receivedEvents, 1);
  assert.equal(first.restoredEvents, 1);
  assert.equal(await countLearningEvents(), 1);
  assert.equal(first.receivedDocuments, 3);
  assert.equal(first.restoredDocuments, 2);
  assert.equal(first.unchangedDocuments, 0);
  assert.equal(first.skippedDocuments, 1);
  assert.equal(first.localDocuments, 2);
  assert.equal(first.documentCursor, 6);

  const second = await service.restoreFromCloud();
  assert.equal(second.receivedEvents, 1, "manual restore must rescan event history from sequence zero");
  assert.equal(second.restoredEvents, 0, "event replay must remain idempotent");
  assert.equal(await countLearningEvents(), 1);
  assert.equal(second.receivedDocuments, 3, "manual restore must rescan from sequence zero");
  assert.equal(second.restoredDocuments, 0, "replaying the same revisions must not duplicate local documents");
  assert.equal(second.unchangedDocuments, 2);
  assert.equal(second.skippedDocuments, 1);
  assert.equal(second.localDocuments, 2);
  assert.equal(second.documentCursor, 6);
});
