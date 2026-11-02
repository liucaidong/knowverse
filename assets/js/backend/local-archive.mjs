import {
  applyRemoteArchiveDocument,
  countLearningEvents,
  getLocalDevice,
  listArchiveDocuments,
  resolveArchiveConflict,
} from "./local-event-store.mjs";

/**
 * Phase D writes directly to IndexedDB in the business transaction. These
 * methods remain as diagnostic entry points for bootstrap / sync callers;
 * they no longer scan or mirror LocalStorage.
 */
export async function hydrateLearningArchiveDocuments() {
  const documents = await listArchiveDocuments(1000);
  return { restored: 0, localDocuments: documents.length, source: "indexeddb" };
}

export async function captureLocalLearningArchive() {
  const [device, documents, eventCount] = await Promise.all([
    getLocalDevice(),
    listArchiveDocuments(1000),
    countLearningEvents(),
  ]);
  return { deviceId: device.id, eventCount, documentCount: documents.length };
}

export async function applyRemoteLearningArchiveDocument(remote, accountId) {
  return applyRemoteArchiveDocument(remote, accountId);
}

export async function resolveLocalLearningArchiveConflict(conflictId, choice) {
  return resolveArchiveConflict(conflictId, choice);
}

export async function startLocalLearningArchive() {
  const status = await captureLocalLearningArchive();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("knowverse:archive-state", { detail: { status: "ready", ...status } }));
  }
  return () => {};
}
