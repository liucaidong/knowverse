import { createLearningProgressStore } from "./learning-progress.mjs";

const randomId = () => "activity-" + Date.now().toString(36) + "-" +
  (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));

export function startLearningActivityTelemetry(options = {}) {
  if (typeof document === "undefined" || typeof location === "undefined") return () => {};
  const store = options.store || createLearningProgressStore();
  if (!store.available) return () => {};
  const path = location.pathname;
  const section = options.section || document.body?.dataset.learningSection ||
    (path.includes("/lab/") ? "principle-lab" :
      path.includes("/gallery/") ? "immersive-gallery" :
        path.includes("/puzzles/") ? "puzzle-world" : "knowledge-space");
  const sessionId = randomId();
  let sequence = 0;

  function record(action, control = null) {
    const event = {
      id: sessionId + ":" + (++sequence),
      eventSchemaVersion: 2,
      type: "activity",
      at: new Date().toISOString(),
      topicId: section,
      challengeId: "activity:" + section,
      challengeTitle: section,
      stepId: action,
      stepTitle: action === "page_view" ? "页面访问" : "交互探索",
      competencyIds: [],
      sessionId,
      sessionType: "exploration",
      action,
      pagePath: path,
      pageTitle: document.title,
      elementId: control?.id || control?.getAttribute?.("data-learning-action") || control?.localName || null,
      destinationPath: control?.getAttribute?.("href")
        ? new URL(control.getAttribute("href"), location.href).pathname
        : null,
    };
    if (!store.appendMany([event])) {
      console.warn("[KNOWVERSE] Learning activity could not be persisted; export a backup and check browser storage quota.");
    }
  }

  record("page_view");
  const onClick = event => {
    const control = event.target?.closest?.("a,button,[role='button']");
    if (!control || control.closest("#search-overlay") || control.closest("[data-no-learning-telemetry]")) return;
    const main = document.querySelector("main");
    if (main && !main.contains(control)) return;
    record("interaction", control);
  };
  document.addEventListener("click", onClick, { passive: true });
  return () => document.removeEventListener("click", onClick);
}

startLearningActivityTelemetry();
