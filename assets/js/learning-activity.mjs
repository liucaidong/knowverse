import { createLearningProgressStore } from "./learning-progress.mjs";

const randomId = () => "activity-" + Date.now().toString(36) + "-" +
  (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));

/** Records privacy-safe exploration events; activity has no competency IDs and is never mastery evidence. */
export function startLearningActivityTelemetry(options = {}) {
  if (typeof document === "undefined" || typeof location === "undefined") return () => {};
  const store = options.store || createLearningProgressStore();
  if (!store.available) return () => {};
  const work = options.work || {};
  const path = location.pathname;
  const workId = work.id || options.workId || null;
  const knowledgeIds = Array.isArray(work.knowledge_ids) ? work.knowledge_ids : [];
  const topicId = knowledgeIds[0] || options.section || "knowledge-space";
  const sessionId = randomId();
  let sequence = 0;

  function record(action, control = null) {
    const event = {
      id: sessionId + ":" + (++sequence), eventSchemaVersion: 2, type: "activity",
      at: new Date().toISOString(), topicId,
      challengeId: "activity:" + (workId || topicId),
      challengeTitle: work.title || topicId, stepId: action,
      stepTitle: action === "page_view" ? "页面访问" : action === "checkpoint_open" ? "打开知识检查" : "交互探索",
      competencyIds: [], sessionId, sessionType: "exploration", action, workId, knowledgeIds,
      pagePath: path, pageTitle: document.title,
      elementId: control?.id || control?.getAttribute?.("data-learning-action") || control?.localName || null,
      destinationPath: control?.getAttribute?.("href")
        ? new URL(control.getAttribute("href"), location.href).pathname : null
    };
    if (!store.appendMany([event])) console.warn("[KNOWVERSE] Learning activity could not be persisted; export a backup and check browser storage quota.");
  }

  record("page_view");
  const onClick = event => {
    const control = event.target?.closest?.("a,button,[role='button']");
    if (!control || control.closest("#search-overlay") || control.closest("[data-no-learning-telemetry]")) return;
    const main = document.querySelector("main");
    if (main && !main.contains(control)) return;
    record(control.getAttribute("data-learning-action") || "interaction", control);
  };
  document.addEventListener("click", onClick, { passive: true });
  return () => document.removeEventListener("click", onClick);
}
