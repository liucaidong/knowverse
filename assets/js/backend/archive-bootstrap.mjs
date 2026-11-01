import { createLearningProgressStore } from "../learning-progress.mjs";
import { startLocalLearningArchive } from "./local-archive.mjs";

let bootstrapPromise = null;

export function startArchiveBootstrap() {
  if (bootstrapPromise) return bootstrapPromise;
  const store = createLearningProgressStore();
  bootstrapPromise = startLocalLearningArchive(store).catch(error => {
    bootstrapPromise = null;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("knowverse:archive-state", {
        detail: { status: "error", message: error.message || "本地档案初始化失败" },
      }));
    }
    throw error;
  });
  return bootstrapPromise;
}
