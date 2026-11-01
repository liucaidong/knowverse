import { createLearningProgressStore } from "../learning-progress.mjs";
import { BACKEND_CONFIG } from "./config.mjs";
import { createSupabaseAuthClient } from "./auth.mjs";
import { createLearningSyncService } from "./sync-engine.mjs";
import { startLocalLearningArchive } from "./local-archive.mjs";

let bootstrapPromise = null;
let archiveStore = null;
let authClient = null;
let syncService = null;
let stopSyncRuntime = null;
let bootstrapError = null;

function reportBootstrapError(error) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("knowverse:archive-state", {
      detail: { status: "error", message: error.message || "本地档案初始化失败" },
    }));
  }
}

export function startArchiveBootstrap() {
  if (bootstrapPromise) return bootstrapPromise;

  archiveStore = createLearningProgressStore();
  authClient = createSupabaseAuthClient();
  // The same sync runtime is started on every page so Lab, Gallery, Puzzles,
  // courses and the progress dashboard all write to the same local Outbox.
  syncService = createLearningSyncService(authClient, archiveStore);
  stopSyncRuntime = syncService.start();

  bootstrapPromise = startLocalLearningArchive(archiveStore).then(() => {
    bootstrapError = null;
    // Do not block page navigation on network activity. initialize() is
    // best-effort and leaves the local-first learning path available.
    syncService.initialize().catch(reportBootstrapError);
    return { store: archiveStore, auth: authClient, syncService };
  }).catch(error => {
    bootstrapError = error;
    stopSyncRuntime?.();
    stopSyncRuntime = null;
    bootstrapPromise = null;
    reportBootstrapError(error);
    throw error;
  });
  return bootstrapPromise;
}

export async function getArchiveRuntime() {
  try {
    await startArchiveBootstrap();
  } catch {
    // Keep the account panel mountable even if IndexedDB is unavailable.
    // The returned error is presented as a local archive warning; learning
    // itself continues to use the legacy LocalStorage compatibility layer.
  }
  return {
    store: archiveStore,
    auth: authClient,
    syncService,
    bootstrapError,
  };
}
