import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { mockSupabaseProjectRequests } from "./helpers/mock-supabase-project.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
};
async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      let file = resolve(root, pathname.replace(/^\/+/, "") || "index.html");
      if (file !== root && !file.startsWith(root + sep)) return response.writeHead(403).end("Forbidden");
      try { if ((await stat(file)).isDirectory()) file = resolve(file, "index.html"); }
      catch { return response.writeHead(404).end("Not found"); }
      response.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      response.end(await readFile(file));
    } catch { response.writeHead(500).end("Internal error"); }
  });
  await new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveServer);
  });
  return { server, baseURL: "http://127.0.0.1:" + server.address().port };
}
const { server, baseURL } = await startServer();
test.after(() => new Promise(resolveServer => server.close(resolveServer)));

const validCandidate = {
  title: "Thenable 内部再注册微任务：日志追踪",
  taskType: "trace",
  prompt: "预测下面代码的所有日志顺序，并解释 then 函数内部新注册的微任务为什么排在 outer 之后。",
  stimulus: "const t = { get then() { console.log('get'); return resolve => { console.log('call'); queueMicrotask(() => console.log('inner')); resolve(1); }; } }; Promise.resolve(t); queueMicrotask(() => console.log('outer')); console.log('end');",
  expectedReasoning: "getter 在同步解析阶段读取；同步代码继续输出 end。ThenableJob 先于后注册的 outer 微任务入队；执行 then 函数时才把 inner 入队，因此 inner 排在 outer 之后。",
  exemplarAnswer: "get → end → call → outer → inner。",
  commonTrap: "把 getter 读取与 then 函数调用混为一谈，或误以为函数内部新注册的任务会插到已有微任务之前。",
  hints: ["先列出当前同步调用栈中的日志，再考虑微任务队列。", "ThenableJob 执行时，outer 已经入队；inner 是之后才注册的。"],
  rubric: [
    { id: "sync-get", criterion: "指出 getter 是同步读取", expectedSignal: "get 在同步阶段，且出现在 end 前" },
    { id: "job-first", criterion: "指出 ThenableJob 先执行", expectedSignal: "call 在微任务阶段先于 outer" },
    { id: "fifo-inner", criterion: "解释 inner 的入队时机", expectedSignal: "inner 在 call 期间入队，排在已等待的 outer 后" },
  ],
  difficulty: "stretch",
  sourceVariantIds: ["review-thenable-get-vs-call-a", "review-thenable-get-vs-call-b"],
};

function validationReport(candidate, fail = false) {
  const checks = [
    ["source.competency", "Competency 来源"],
    ["source.gap", "Learning Gap 来源"],
    ["source.original-anchors", "Phase L 原始来源锚点"],
    ["source.variants", "两个官方来源变体"],
    ["content.title", "题目标题"],
    ["content.prompt", "题目要求完整性"],
    ["content.stimulus", "上下文与输入材料"],
    ["content.expected-reasoning", "预期推理"],
    ["content.exemplar-answer", "参考答案"],
    ["content.common-trap", "常见误区"],
    ["content.task-type", "题型合法性"],
    ["content.difficulty", "难度合法性"],
    ["content.hints", "分级提示"],
    ["content.rubric", "评分参考结构"],
    ["content.duplicate", "题目复制与重复"],
    ["safety.content", "内容安全"],
    ["code.runtime-execution", "代码执行验证"],
  ].map(([id, label]) => ({
    id, label,
    status: id === "code.runtime-execution" ? "warning" : fail && id === "safety.content" ? "failed" : "passed",
    detail: id === "code.runtime-execution"
      ? "E2E Mock 未执行候选代码；不宣称运行时行为已被验证。"
      : fail && id === "safety.content" ? "候选题要求提供 API Key，安全规则阻断。"
      : "Mock deterministic result for UI lifecycle testing.",
  }));
  const errors = fail ? [{ code: "safety.content", message: "候选题可能要求泄露 API Key 或其他凭证。" }] : [];
  return {
    validationStatus: fail ? "failed" : "passed",
    checks, errors, warnings: [],
    duplicateMatches: [],
    sourceValidation: { status: fail ? "passed" : "passed", sourceVariantIds: candidate.exercise.sourceVariantIds, officialSources: [] },
    contentValidation: { status: fail ? "failed" : "passed", codeRuntimeExecution: "not_run" },
    evaluatedAt: new Date().toISOString(), validatorVersion: "e2e-mock-only",
  };
}

function reviewPayload(candidate, verdict, reviewId) {
  const finding = {
    category: "solvability", severity: verdict === "needs_revision" ? "medium" : "info",
    description: verdict === "needs_revision" ? "题目存在未明确的任务边界。" : "未发现阻断性问题。",
    evidence: "Mock fixture used only to test UI state transitions.",
    suggestedFix: verdict === "needs_revision" ? "明确日志范围和输出假设。" : "无。",
  };
  return {
    reviewId, candidateId: candidate.candidateId, reviewerVersion: "e2e-mock-reviewer",
    reviewerModel: "mock-independent-reviewer", candidateHash: "a".repeat(64),
    reviewedAt: new Date().toISOString(), verdict, riskLevel: "low",
    overallAssessment: verdict === "pass" ? "Mock Reviewer 未发现阻断问题。" : "Mock Reviewer 要求修改后再审。",
    findings: verdict === "pass" ? [] : [finding],
    sourceAlignment: { status: "pass", assessment: "Mock source mapping passed.", evidence: ["Mock official source fixture."] },
    solvability: { status: verdict === "pass" ? "pass" : "concern", assessment: "Mock solvability result.", evidence: ["Mock candidate fixture."] },
    answerConsistency: { status: "pass", assessment: "Mock answer check.", evidence: ["No live model evaluation was performed."] },
    pedagogicalQuality: { status: "pass", assessment: "Mock pedagogical result.", evidence: ["Test fixture only."] },
    suggestedRevisions: verdict === "needs_revision"
      ? [{ field: "prompt", reason: "Clarify the task boundary.", proposal: "补充输出范围与执行假设。 " }]
      : [],
    reviewerLimitations: ["This is an E2E mock. It is not a real AI review.", "No candidate code was executed."],
    registrationAssessment: {
      title: "Thenable 时序 · 正式验证版本",
      prompt: "根据给定代码判断同步日志与 ThenableJob 的执行先后。",
      code: "Promise.resolve(thenable); queueMicrotask(() => console.log('outer'));",
      options: [
        { id: "a", label: "then 函数与 getter 同步执行。", gapId: "thenable-get-vs-call" },
        { id: "b", label: "getter 同步读取，then 函数由后续 ThenableJob 调用。" },
      ],
      answer: "b",
      explanation: "这是独立的选择题 companion，不把开放式练习伪装成唯一答案。",
      hints: ["区分 Get(then) 与函数调用。", "检查 ThenableJob 的调度边界。"],
    },
  };
}

async function setupBrowserContext(browser, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    localStorage.setItem("knowverse:supabase-session", JSON.stringify({
      access_token: "e2e-access-token",
      refresh_token: "e2e-refresh-token",
      token_type: "bearer",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "phase-m-e2e-user" },
    }));
  });
  const page = await context.newPage();
  await mockSupabaseProjectRequests(page);
  const errors = [];
  const httpErrors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 400 && !response.url().includes("/functions/v1/practice-quality-review")) {
      httpErrors.push(response.status() + " " + response.url());
    }
  });
  page.on("console", message => {
    const text = message.text();
    const expectedForbiddenProbe = text.includes("Failed to load resource") && text.includes("403 (Forbidden)");
    if (message.type() === "error" && !text.includes("favicon.ico") && !expectedForbiddenProbe) errors.push(text);
  });
  await page.route("**/rest/v1/rpc/get_learning_sync_profile", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authorized: true }) });
  });
  return { context, page, errors, httpErrors };
}

async function seedGap(page, fixture = validCandidate) {
  await page.goto(baseURL + "/review/", { waitUntil: "domcontentloaded" });
  await page.locator("#target-list .rw-target").first().waitFor({ state: "visible", timeout: 15000 });
  await page.evaluate(async () => {
    const { createLearningProgressStore } = await import("/assets/js/learning-progress.mjs");
    await createLearningProgressStore().appendMany([{
      id: "phase-m-seeded-gap", eventSchemaVersion: 3, type: "attempt",
      at: new Date().toISOString(), topicId: "promise",
      challengeId: "phase-m-source-challenge", challengeTitle: "Promise 来源挑战",
      stepId: "phase-m-failure-step", stepTitle: "thenable 顺序判断",
      competencyIds: ["thenable-adoption"], sessionId: "phase-m-seed-session",
      sessionType: "challenge", variantId: "phase-m-source-variant",
      hintsUsed: 0, correct: false, gapId: "thenable-get-vs-call",
      gapObservationId: "phase-m-seeded-gap", causationEventIds: [], targetGapEventIds: [],
    }]);
  });
  await page.goto(baseURL + "/review/?competencyId=thenable-adoption&gapId=thenable-get-vs-call", {
    waitUntil: "domcontentloaded",
  });
  await page.locator("#generate-practice-candidate").waitFor({ state: "visible", timeout: 15000 });
  await page.locator("#practice-candidate-workbench").waitFor({ state: "visible" });
  await page.route("**/functions/v1/learning-agent", async route => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ version: 1, reply: JSON.stringify(fixture), suggestions: [], dataRequests: [] }),
    });
  });
}

function installQualityMock(page, options = {}) {
  const candidates = new Map();
  const verdicts = [...(options.verdicts || ["pass"])];
  const canApprove = options.canApprove === true;
  const calls = [];
  const registrationRequests = new Map();
  page.route("**/functions/v1/practice-quality-review", async route => {
    const body = route.request().postDataJSON() || {};
    calls.push({ action: body.action, body });
    const id = body.candidate?.candidateId || body.candidateId || "unknown-candidate";
    let state = candidates.get(id);
    if (!state) {
      state = { status: "draft", records: [], approvalCount: 0, registrationCount: 0 };
      candidates.set(id, state);
    }
    const respond = (value, status = 200) => route.fulfill({
      status, contentType: "application/json", body: JSON.stringify(value),
    });
    if (body.action === "history") {
      return respond({ ok: true, candidateId: id, status: state.status, canApprove, records: state.records });
    }
    if (body.action === "validate") {
      const fail = options.failValidation === true ||
        /API Key|password|密钥/i.test(body.candidate?.exercise?.prompt || "");
      const report = validationReport(body.candidate, fail);
      state.records.push({
        recordType: "validation", recordId: "validation-" + (state.records.length + 1),
        candidateHash: "a".repeat(64), payload: report, createdAt: new Date().toISOString(),
      });
      state.status = fail ? "needs_revision" : "validation";
      state.records.push({
        recordType: "state", recordId: "state-validation-" + state.records.length,
        candidateHash: "a".repeat(64), payload: { from: "draft", to: state.status },
        createdAt: new Date().toISOString(),
      });
      return respond({ ok: true, candidateId: id, status: state.status, report, canApprove });
    }
    if (body.action === "review") {
      if (state.status !== "validation") return respond({ error: { code: "validation_required" } }, 409);
      const verdict = verdicts.shift() || "pass";
      const review = reviewPayload(body.candidate, verdict, "review-" + (state.records.length + 1));
      state.records.push({
        recordType: "review", recordId: review.reviewId, candidateHash: "a".repeat(64),
        payload: review, createdAt: new Date().toISOString(),
      });
      state.status = verdict === "pass" ? "machine_reviewed" : verdict === "reject" ? "rejected" : "needs_revision";
      state.records.push({
        recordType: "state", recordId: "state-review-" + state.records.length,
        candidateHash: "a".repeat(64), payload: { to: state.status },
        createdAt: new Date().toISOString(),
      });
      return respond({ ok: true, candidateId: id, status: state.status, review, canApprove });
    }
    if (body.action === "approve") {
      if (!canApprove || state.status !== "machine_reviewed" || body.explicitConfirmation !== true) {
        return respond({ error: { code: "reviewer_authorization_required" } }, 403);
      }
      state.approvalCount += 1;
      state.status = "approved";
      state.records.push({
        recordType: "approval", recordId: "approval-" + state.approvalCount,
        candidateHash: "a".repeat(64),
        payload: { reviewId: state.records.filter(row => row.recordType === "review").at(-1).payload.reviewId, explicitConfirmation: true },
        createdAt: new Date().toISOString(),
      });
      state.records.push({
        recordType: "state", recordId: "state-approved-" + state.approvalCount,
        candidateHash: "a".repeat(64), payload: { to: "approved" },
        createdAt: new Date().toISOString(),
      });
      return respond({ ok: true, candidateId: id, status: state.status, approvalId: "approval-" + state.approvalCount, canApprove });
    }
    if (body.action === "prepare_registration") {
      if (registrationRequests.has(id) && state.status === "registration_pending") {
        return respond({ ...registrationRequests.get(id), idempotent: true });
      }
      if (!canApprove || state.status !== "approved") {
        return respond({ error: { code: "human_approval_required" } }, 403);
      }
      if (!registrationRequests.has(id)) {
        state.registrationCount += 1;
        const result = {
          ok: true, candidateId: id, status: "registration_pending", idempotent: false,
          registrationPendingRecordId: "registration-pending-1", assessmentId: "review-ai-" + id,
          workflowUrl: "https://github.com/liucaidong/knowverse/actions/workflows/publish-approved-practice-candidate.yml",
          publicationStatus: "pending_manual_github_review",
        };
        registrationRequests.set(id, result);
        state.status = "registration_pending";
        state.records.push({
          recordType: "registration_pending", recordId: result.registrationPendingRecordId,
          candidateHash: "a".repeat(64),
          payload: { assessmentId: result.assessmentId, publicationStatus: result.publicationStatus },
          createdAt: new Date().toISOString(),
        });
        state.records.push({
          recordType: "state", recordId: "state-registration-pending",
          candidateHash: "a".repeat(64), payload: { to: "registration_pending" },
          createdAt: new Date().toISOString(),
        });
        return respond(result);
      }
      return respond({ ...registrationRequests.get(id), idempotent: true });
    }
    return respond({ error: { code: "reviewer_authorization_required" } }, 403);
  });
  return { calls, candidates };
}

async function generateCandidate(page, fixture = validCandidate) {
  if (fixture !== validCandidate) {
    await page.unroute("**/functions/v1/learning-agent");
    await page.route("**/functions/v1/learning-agent", async route => {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ version: 1, reply: JSON.stringify(fixture), suggestions: [], dataRequests: [] }),
      });
    });
  }
  await page.locator("#practice-ai-consent").check();
  await page.locator("#generate-practice-candidate").click();
  await page.locator("#practice-quality-panel").waitFor({ state: "visible", timeout: 15000 });
  await page.locator("#practice-quality-validate").waitFor({ state: "visible" });
  await page.locator("#practice-quality-state").waitFor({ state: "visible" });
}

async function validateAndReview(page) {
  await page.locator("#practice-quality-validate").click();
  await page.locator("#practice-quality-validation h5").waitFor({ state: "visible", timeout: 10000 });
  const validationHeading = await page.locator("#practice-quality-validation h5").innerText();
  if (!validationHeading.includes("通过") || validationHeading.includes("未通过")) {
    throw new Error("Quality validation failed in E2E fixture: " +
      await page.locator("#practice-quality-validation").innerText());
  }
  await page.locator("#practice-quality-review").waitFor({ state: "visible" });
  await page.locator("#practice-quality-review").click();
  await page.locator("#practice-quality-review-report h5").waitFor({ state: "visible", timeout: 15000 });
}

test("Chromium: deterministic validation → independent review → unprivileged approval and registration bypass are rejected", {
  timeout: 60_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page, errors, httpErrors } = await setupBrowserContext(browser, { width: 1440, height: 1100 });
    const mock = installQualityMock(page, { verdicts: ["pass"], canApprove: false });
    await seedGap(page);
    await generateCandidate(page);
    assert.equal(await page.locator("#practice-quality-review").isDisabled(), true,
      "AI review is gated until deterministic validation passes");
    const sourceCount = await page.locator("#practice-quality-source-list .rw-quality-source").count();
    assert.equal(sourceCount, 2, "both official source variants are visible");
    await validateAndReview(page);
    await page.getByText(/Mock Reviewer 未发现阻断问题/).waitFor();
    assert.equal(await page.locator("#practice-quality-state").innerText(), "机器审查通过 · 等待人工批准");
    assert.equal(await page.locator("#practice-quality-approve").isVisible(), false,
      "no user-facing approval control exists without a server-authorized content_admin role");
    assert.equal(await page.locator("#practice-quality-approval-confirm").isChecked(), false);

    const candidateId = await page.locator("#practice-candidate-title").getAttribute("data-candidate-id");
    const id = candidateId || mock.calls.find(item => item.action === "validate")?.body.candidate.candidateId;
    const bypass = await page.evaluate(async candidateId => {
      const response = await fetch("/functions/v1/practice-quality-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer e2e-access-token" },
        body: JSON.stringify({ version: 1, action: "approve", candidateId, explicitConfirmation: true }),
      });
      return { status: response.status, body: await response.json() };
    }, id);
    assert.equal(bypass.status, 403, "direct approval request is denied by the server contract");
    const registrationBypass = await page.evaluate(async candidateId => {
      const response = await fetch("/functions/v1/practice-quality-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer e2e-access-token" },
        body: JSON.stringify({ version: 1, action: "prepare_registration", candidateId }),
      });
      return { status: response.status, body: await response.json() };
    }, id);
    assert.equal(registrationBypass.status, 403, "direct registration request is denied without human approval");
    assert.equal(mock.candidates.get(id).status, "machine_reviewed");
    assert.deepEqual(errors, []);
    assert.deepEqual(httpErrors, [], "the expected 403 bypass responses are returned through fetch and are not page navigation failures");
    await context.close();
  } finally {
    await browser.close();
  }
});

test("Chromium: needs_revision displays findings, allows editing, and creates a new review record after revalidation", {
  timeout: 60_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page, errors, httpErrors } = await setupBrowserContext(browser, { width: 1440, height: 1100 });
    const mock = installQualityMock(page, { verdicts: ["needs_revision", "pass"], canApprove: false });
    await seedGap(page);
    await generateCandidate(page);
    await page.locator("#practice-quality-validate").click();
    await page.locator("#practice-quality-validation h5").waitFor({ state: "visible", timeout: 10000 });
    assert.match(await page.locator("#practice-quality-validation h5").innerText(), /通过/);
    await page.locator("#practice-quality-review").click();
    await page.getByText(/题目存在未明确的任务边界/).waitFor();
    assert.equal(await page.locator("#practice-quality-state").innerText(), "需要修改");
    assert.equal(await page.locator("#practice-quality-editor").isVisible(), true);
    assert.equal(await page.locator("#practice-quality-history-list .rw-quality-history-row").count() >= 3, true);
    await page.locator("#practice-quality-editor summary").click();

    const edited = JSON.parse(await page.locator("#practice-quality-edit-json").inputValue());
    edited.prompt = "请追踪另一组 Thenable 对象的属性读取和后续队列执行顺序，并解释每一步的调度边界？";
    await page.locator("#practice-quality-edit-json").fill(JSON.stringify(edited, null, 2));
    await page.locator("#practice-quality-save-edit").click();
    await page.locator("#practice-quality-validate").click();
    await page.locator("#practice-quality-validation h5").waitFor({ state: "visible", timeout: 10000 });
    assert.match(await page.locator("#practice-quality-validation h5").innerText(), /通过/);
    await page.locator("#practice-quality-review").click();
    await page.getByText(/Mock Reviewer 未发现阻断问题/).waitFor();
    assert.equal(await page.locator("#practice-quality-state").innerText(), "机器审查通过 · 等待人工批准");
    const reviewCalls = mock.calls.filter(item => item.action === "review");
    assert.equal(reviewCalls.length, 2, "edited content is independently reviewed again");
    assert.notEqual(
      mock.candidates.get(reviewCalls[0].body.candidate.candidateId).records
        .filter(row => row.recordType === "review")[0].recordId,
      mock.candidates.get(reviewCalls[0].body.candidate.candidateId).records
        .filter(row => row.recordType === "review")[1].recordId,
      "each review must receive a fresh immutable reviewId",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(httpErrors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("Chromium: deterministic safety failure blocks the Reviewer and keeps the candidate out of the approval path", {
  timeout: 60_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const unsafe = {
      ...validCandidate,
      title: "API Key 安全风险验证练习",
      prompt: "请发送你的 API Key 以完成验证？这段题目用于测试安全校验的阻断行为。",
    };
    const { context, page, errors, httpErrors } = await setupBrowserContext(browser, { width: 1440, height: 1000 });
    const mock = installQualityMock(page, { failValidation: true, canApprove: false });
    await seedGap(page);
    await generateCandidate(page, unsafe);
    await page.locator("#practice-quality-validate").click();
    await page.locator("#practice-quality-validation h5").waitFor({ state: "visible", timeout: 10000 });
    assert.match(await page.locator("#practice-quality-validation h5").innerText(), /未通过/);
    assert.equal(await page.locator("#practice-quality-review").isDisabled(), true);
    assert.equal(await page.locator("#practice-quality-approval").isVisible(), false);
    assert.equal(mock.calls.some(item => item.action === "review"), false);
    assert.equal(mock.candidates.get(mock.calls.find(item => item.action === "validate").body.candidate.candidateId).status, "needs_revision");
    assert.deepEqual(errors, []);
    assert.deepEqual(httpErrors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("Chromium: authorized human approval is explicit and repeated registration requests are idempotent", {
  timeout: 60_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page, errors, httpErrors } = await setupBrowserContext(browser, { width: 1440, height: 1100 });
    const mock = installQualityMock(page, { verdicts: ["pass"], canApprove: true });
    await seedGap(page);
    await generateCandidate(page);
    await validateAndReview(page);
    await page.locator("#practice-quality-approval").waitFor({ state: "visible" });
    assert.equal(await page.locator("#practice-quality-approval-confirm").isChecked(), false,
      "approval acknowledgement is never preselected");
    assert.equal(await page.locator("#practice-quality-approve").isDisabled(), true);
    await page.locator("#practice-quality-approval-confirm").check();
    await page.locator("#practice-quality-approve").click();
    await page.waitForFunction(() =>
      document.querySelector("#practice-quality-state")?.textContent === "人工已批准 · 待发布"
    );
    assert.equal(await page.locator("#practice-quality-state").innerText(), "人工已批准 · 待发布");
    assert.equal(await page.locator("#practice-quality-registration").isVisible(), true);
    await page.locator("#practice-quality-prepare-registration").click();
    await page.waitForFunction(() =>
      document.querySelector("#practice-quality-state")?.textContent === "发布请求已生成 · 待合并"
    );
    assert.equal(await page.locator("#practice-quality-state").innerText(), "发布请求已生成 · 待合并");
    const id = mock.calls.find(item => item.action === "approve").body.candidateId;
    const second = await page.evaluate(async candidateId => {
      const response = await fetch("/functions/v1/practice-quality-review", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer e2e-access-token" },
        body: JSON.stringify({ version: 1, action: "prepare_registration", candidateId }),
      });
      return response.json();
    }, id);
    assert.equal(second.idempotent, true);
    assert.equal(mock.candidates.get(id).registrationCount, 1);
    assert.equal(mock.candidates.get(id).records.filter(row => row.recordType === "registration_pending").length, 1);
    assert.deepEqual(errors, []);
    assert.deepEqual(httpErrors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("WebKit mobile: quality controls, reports and audit history fit a 390px viewport without horizontal overflow", {
  timeout: 60_000,
}, async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const { context, page, errors, httpErrors } = await setupBrowserContext(browser, { width: 390, height: 844 });
    installQualityMock(page, { verdicts: ["pass"], canApprove: false });
    await seedGap(page);
    await generateCandidate(page);
    await validateAndReview(page);
    await page.locator("#practice-quality-history-list .rw-quality-history-row").first().waitFor();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      panel: document.querySelector("#practice-quality-panel").getBoundingClientRect().width,
      controls: [...document.querySelectorAll("#practice-quality-controls button, .rw-quality-controls button")]
        .filter(item => item.offsetParent !== null)
        .map(item => item.getBoundingClientRect().right),
      report: document.querySelector("#practice-quality-review-report").getBoundingClientRect().width,
    }));
    assert.ok(dimensions.panel <= 390 && dimensions.panel >= 300, JSON.stringify(dimensions));
    assert.ok(dimensions.scroll <= dimensions.viewport, JSON.stringify(dimensions));
    assert.ok(dimensions.report <= dimensions.viewport, JSON.stringify(dimensions));
    assert.ok(dimensions.controls.every(right => right <= dimensions.viewport), JSON.stringify(dimensions));
    assert.deepEqual(errors, []);
    assert.deepEqual(httpErrors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
