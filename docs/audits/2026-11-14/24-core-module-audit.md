# KNOWVERSE 4.1 — 四大核心模块深度审计

审计基于源码、注册表、单元测试、Chromium / WebKit 浏览器实测及 Production 只读数据。`通过`仅表示对应已执行的检查通过，不代表所有真实 AI / 生产账号路径均已验收。

## A. 原理实验室

### Promise 调试工作台

- 入口：`lab/experiments/promise-debugger/index.html`。
- 执行 / 调试代码：`lab/experiments/promise-debugger/debugger.js`、`workspace-enhancements.js` 与打包工作台模块。
- 原生行为对照：Promise model / runtime 测试使用 Node 原生 Promise 作为差分参照；覆盖 13 个运行时场景、resolution procedure、thenable getter / call、反应作业 FIFO、异常传播等不变量。
- 课程和挑战：`assets/js/promise-quest.mjs`、`assets/js/challenge-engine.mjs`；挑战答案由真实选项提交产生，保存尝试和完成状态。
- 测试：`verify-promise-debugger.mjs`、`verify-promise-model.mjs`、`verify-promise-quest.mjs`、`verify-promise-workbench-layout.mjs`、`e2e-promise-course-learning.mjs`、`e2e-promise-workbench-css-delivery.mjs`。
- 结论：工作台有真实执行模型与原生差分验证，不是单纯逐帧动画。课程中的部分静态时间线（如 Promise Identity / Queue）属于预先解释的教学场景，旁边的原生验证按钮才是浏览器真实输出；两者应明确区分。
- 限制：浏览器不能直接暴露 V8 / JavaScriptCore 私有内部 Job Queue 对象；UI 中的 Job 名称和队列可视化属于依据可观察行为建立的教学模型，不能宣称为引擎内部内存快照。

### 其他实验

- Checkpoint Engine：`assets/js/learning-checkpoint-engine.mjs`；开始时绑定 topic / work / competency / task / plan / strategy，提交答案产生 attempt，独立正确提交才产生 `assessment_passed`。
- `assessment_passed` 事件必须由应用测评引擎写入；阅读完成、Agent 对话、Tutor 反思和任务完成不能冒充能力证据。
- 已运行 Promise 原理课程、Monorepo / React Native 相关静态完整性与浏览器测试。

## B. 复习工作台

- 入口：`review/index.html`；主交互：`assets/js/review-workspace.mjs`；业务引擎：`assets/js/review-engine.mjs`。
- 正式题目来自 `content/review-assessments.json`（112 项），并通过 competency / topic / gap / source lesson 关联。
- 答题流程：`start` 建立 session → hint 记录提示 → `submit` 记录 attempt → 独立正确才生成 assessment_passed；session / attempt / pass 通过 sessionId、taskId、gapId、variantId、causationEventIds 与 targetGapEventIds 关联。
- Gap reducer：`assets/js/learning-progress.mjs` 仅根据失败 attempt 识别 Gap；通过同一 Gap 的不同变体、零提示和完整因果链验证后才能关闭 Gap。
- Task orchestrator：`assets/js/learning-agent/task-orchestrator.mjs` 对 review task 完成执行因果链校验，普通阅读任务完成不增加 mastery evidence；重复终态转换幂等，非法状态转换拒绝。
- 质量审核候选与正式学习测评隔离：候选题质量审查是内容治理，不会直接产生学习者掌握证据；正式注册仍需独立校验、机器审查、人工批准和发布链路。
- 测试：`verify-phase-e.mjs`、`verify-learning-progress.mjs`、`verify-learning-intelligence.mjs`、`verify-phase-f.mjs`、`verify-phase-g.mjs`、`e2e-phase-k-learning-loop.mjs`、`e2e-phase-l-practice-candidate.mjs`、`e2e-phase-m-practice-quality.mjs`、`e2e-review-workspace-layout.mjs`、`e2e-weekly-learning-review.mjs`。
- 已修复：Gap → Plan Action → Plan Event → Learning Task → Task Event 之前缺少来源事件 ID 的贯通；计划生命周期 event builder 忽略 extra metadata。修复后 18 项 Phase E、92 项学习核心回归与 13 项闭环浏览器专项通过。

## C. 沉浸式知识展厅

- 作品注册表：`content/works.json`；场景页面位于 `gallery/exhibits/**`，运行时位于 `assets/js/**`。
- Monorepo WebGL、Promise Challenge、Promise Realm、Promise Cosmos 已有隐藏页面 / 离屏停止检查。
- 新增审计发现 `gallery/exhibits/promise-universe/exhibit.js` 原来每帧无条件申请下一帧，既不在页面隐藏时暂停，也不在离屏时暂停。
- 修复后采用可见性状态、IntersectionObserver、单个 RAF 句柄与 reduced-motion 单帧更新；场景切换、鼠标交互和 resize 按需唤醒，pagehide 停止，pageshow 恢复。
- 新增 Chromium 生命周期测试覆盖 Promise Universe 离屏与隐藏行为；五个场景生命周期测试全部通过。
- Promise Universe 页面自身明确声明“三维机制示意 · 非引擎内部实时截图”，因此它是空间叙事教学场景，不应作为 Promise 执行状态的实时证据。
- 尚需进一步检查低端 GPU / WebGL context loss 的恢复 UX 与移动设备性能档位；当前不把这些未实测项标记为通过。

## D. 知识专题与课程

- 构建期知识注册表：`content/knowledge.json`、`content/learning-map.json`、`content/routes.json`、`content/works.json`、`content/sources.json`。
- 结构快照：12 个专题、35 个 Concept、34 个 Competency、51 个 Gap、14 个 Checkpoint、115 个 Review Assessment、17 个作品、17 个来源、63 条规范路由。
- Promise 课程有 20 课、5 阶段挑战、原理工作台和展厅出口；Monorepo 课程有 10 章、3 个实验、1 个展厅和 1 个解谜；React Native 课程固定到 v0.88.1 源码路径与 patch 级事实；AI Agent 专题有 4 课和 Concept 详情页。
- 当前只有 Promise、Monorepo、React Native、AI Agent 四个专题有正式 Competency / Gap 图谱；其余 8 个专题可以浏览学习，但没有同等粒度的能力掌握推断。系统不得为这些专题伪造掌握分数。
- `validate-v2.py` 扫描 6,663 条本地链接、22 个 Mermaid 图和 134 条搜索记录；全站 63 条 canonical route 有 Chromium route smoke coverage。
- 仍需人工内容质量审查：专题前置关系、知识来源时效、重复段落和所有非核心专题的 competency mapping 不属于静态链接测试能证明的内容。

## 总结

- 原理实验室：核心 Promise 工作台的真实运行模型有测试证据；静态教学时间线须与真实执行区分。
- 复习工作台：已有真实事件、Gap、独立变体与任务状态机；本次补齐计划和任务的来源证据传递。
- 沉浸展厅：发现并修复 Promise Universe 的持续 RAF 性能缺陷；五个场景生命周期回归通过。
- 知识课程：静态结构完整性高，但12/12 专题已建立正式能力图谱；新增专题的掌握状态仍需真实学习证据持续验证。
