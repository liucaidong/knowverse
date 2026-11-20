// Generate the static "today workbench" fragment for the new IA (T1.2).
// Inert by default: rendered into a hidden container that only shows when
// NEW_IA_ENABLED is on. Content is pre-rendered so it is visible without JS.

const STEPS = [
  { verb: "探索", label: "改变输入，观察状态如何变化", duration: "~40s" },
  { verb: "自测", label: "用两道题检验你的理解", duration: "~30s" },
  { verb: "输出", label: "用自己的话讲一遍", duration: "~2min" },
];

/**
 * @param {string} prefix relative path prefix (e.g. "" or "../")
 * @param {Array<{problemId:string,title:string,legacyHref:string}>} problems
 */
export function renderWorkbench(prefix, problems) {
  const first = problems.find((p) => p.mvp) || problems[0];
  // Strangler: until the new /q/ pages exist (T1.3+), workbench steps link to the
  // real legacy works so no broken links are introduced. resolveRoute() in the
  // manifest maps these back to problem IDs when the new IA is enabled.
  const href = first ? prefix + String(first.legacyHref).replace(/^\.\//, "") : prefix + "lab/";
  const steps = STEPS.map((s, i) =>
    `<a class="kv-wb-step" href="${href}"><small>0${i + 1} · ${s.verb}</small><strong>${s.label}</strong><span>${s.duration} ↗</span></a>`
  ).join("\n");
  return `<section class="kv-workbench" data-kv-workbench="true" data-kv-flag="NEW_IA_ENABLED" hidden>
  <div class="kv-wb-head"><span>KNOWVERSE / TODAY · 问题驱动理解工作台</span><h2>今天搞懂什么？</h2></div>
  <div class="kv-wb-card">
    <div class="kv-wb-problem"><small>今日问题</small><strong>${first ? first.title : "从一个真问题开始"}</strong></div>
    <div class="kv-wb-steps">
      <p class="kv-wb-steps-label">你的 3 步行动</p>
      ${steps}
    </div>
  </div>
</section>`;
}

export const WORKBENCH_START = "<!-- kv-workbench:start -->";
export const WORKBENCH_END = "<!-- kv-workbench:end -->";
