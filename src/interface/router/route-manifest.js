// KNOWVERSE route manifest — SINGLE SOURCE OF TRUTH for the new IA (P1 / T1.1).
// Maps problem-oriented new paths to legacy canonical routes/works so the old IA
// stays reachable and the new IA can be rolled out behind NEW_IA_ENABLED.
//
// Invariants (enforced by scripts/verify-route-manifest.mjs):
//   - one canonical problem per line, anchored to a real Concept ID
//   - every legacyPath must exist in content/routes.json or content/works.json
//   - newPath must match /q/:problemId/<stage>
//   - no duplicate problemId / legacyPath across entries
//
// This file is declarative only. P1 T1.2/T1.3 consume it; nothing here changes
// current page behavior. Promise is the MVP domain (default decision #2).

/** @typedef {{problemId:string, conceptId:string, title:string, newPath:string, legacyPaths:string[], stage:'explore'|'check'|'express', mvp:boolean}} RouteEntry */

/** @type {RouteEntry[]} */
export const ROUTE_MANIFEST = Object.freeze([
  {
    problemId: "promise-state",
    conceptId: "promise.state-model",
    title: "Promise 为什么会有状态？",
    newPath: "/q/promise-state/explore",
    legacyPaths: ["./lab/experiments/promise-debugger/", "./concept/promise.state-model/"],
    stage: "explore",
    mvp: true,
  },
  {
    problemId: "promise-identity",
    conceptId: "promise.thenable-adoption",
    title: "Promise.resolve 什么时候返回同一个对象？",
    newPath: "/q/promise-identity/explore",
    legacyPaths: ["./lab/experiments/promise-identity/", "./concept/promise.thenable-adoption/"],
    stage: "explore",
    mvp: true,
  },
  {
    problemId: "microtask-order",
    conceptId: "promise.microtask-scheduling",
    title: "微任务的执行顺序怎么推导？",
    newPath: "/q/microtask-order/explore",
    legacyPaths: ["./lab/experiments/queue-observatory/", "./lab/experiments/microtask-resolution/"],
    stage: "explore",
    mvp: true,
  },
  {
    problemId: "promise-chain-errors",
    conceptId: "promise.chain-error-propagation",
    title: "链式调用里的错误去了哪里？",
    newPath: "/q/promise-chain-errors/explore",
    legacyPaths: ["./concept/promise.chain-error-propagation/"],
    stage: "explore",
    mvp: true,
  },
  {
    problemId: "promise-combinators",
    conceptId: "promise.combinator-semantics",
    title: "组合子各自解决什么问题？",
    newPath: "/q/promise-combinators/explore",
    legacyPaths: ["./concept/promise.combinator-semantics/"],
    stage: "explore",
    mvp: false,
  },
  {
    problemId: "promise-integrated",
    conceptId: "promise.integrated-execution-model",
    title: "把微任务、状态与链串成完整模型",
    newPath: "/q/promise-integrated/explore",
    legacyPaths: ["./concept/promise.integrated-execution-model/"],
    stage: "explore",
    mvp: false,
  },
]);

/** Look up the manifest entry for a new path or a legacy path. */
export function resolveRoute(path) {
  const normalized = "/" + String(path || "").replace(/^\.?\//, "").replace(/\/$/, "") + "/";
  return ROUTE_MANIFEST.find((entry) =>
    entry.newPath.replace(/\/$/, "") + "/" === normalized ||
    entry.legacyPaths.some((p) => p.replace(/^\.\//, "/").replace(/\/$/, "") + "/" === normalized)
  ) || null;
}

export { ROUTE_MANIFEST as default };
