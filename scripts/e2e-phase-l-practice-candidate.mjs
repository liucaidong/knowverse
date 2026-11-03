import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit } from "playwright";

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

const responseCandidate = {
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

async function createContext(browser, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    localStorage.setItem("knowverse:supabase-session", JSON.stringify({
      access_token: "e2e-access-token",
      refresh_token: "e2e-refresh-token",
      token_type: "bearer",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "phase-l-e2e-user" },
    }));
  });
  const page = await context.newPage();
  const errors = [];
  const httpErrors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 400) httpErrors.push(response.status() + " " + response.url());
  });
  page.on("console", message => {
    if (message.type() === "error" && !message.text().includes("favicon.ico")) errors.push(message.text());
  });
  await page.route("**/rest/v1/rpc/get_learning_sync_profile", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authorized: true }) });
  });
  await page.route("**/functions/v1/practice-quality-review", async route => {
    const body = route.request().postDataJSON();
    if (body?.action === "history") {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, candidateId: body.candidateId, status: "draft", canApprove: false, records: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 403, contentType: "application/json",
      body: JSON.stringify({ error: { code: "reviewer_authorization_required", message: "E2E mock approval is disabled." } }),
    });
  });
  return { context, page, errors, httpErrors };
}

async function seedGap(page, competencyId = "thenable-adoption", gapId = "thenable-get-vs-call") {
  await page.goto(baseURL + "/review/", { waitUntil: "domcontentloaded" });
  await page.locator("#target-list .rw-target").first().waitFor({ state: "visible", timeout: 15000 });
  await page.evaluate(async ({ competencyId, gapId }) => {
    const { createLearningProgressStore } = await import("/assets/js/learning-progress.mjs");
    await createLearningProgressStore().appendMany([{
      id: "phase-l-seeded-gap",
      eventSchemaVersion: 3,
      type: "attempt",
      at: new Date().toISOString(),
      topicId: "promise",
      challengeId: "phase-l-source-challenge",
      challengeTitle: "Promise 来源挑战",
      stepId: "phase-l-failure-step",
      stepTitle: "thenable 顺序判断",
      competencyIds: [competencyId],
      sessionId: "phase-l-seed-session",
      sessionType: "challenge",
      variantId: "phase-l-source-variant",
      hintsUsed: 0,
      correct: false,
      gapId,
      gapObservationId: "phase-l-seeded-gap",
      causationEventIds: [],
      targetGapEventIds: [],
    }]);
  }, { competencyId, gapId });
  await page.goto(baseURL + "/review/?competencyId=thenable-adoption&gapId=thenable-get-vs-call", {
    waitUntil: "domcontentloaded",
  });
  await page.locator("#generate-practice-candidate").waitFor({ state: "visible", timeout: 15000 });
  await page.locator("#practice-candidate-workbench").waitFor({ state: "visible" });
}

test("Chromium desktop: AI practice candidate is gap-bound, saved privately, self-checked without evidence or score", {
  timeout: 60_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page, errors, httpErrors } = await createContext(browser, { width: 1440, height: 1100 });
    let payload = null;
    await page.route("**/functions/v1/learning-agent", async route => {
      payload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: 1, reply: JSON.stringify(responseCandidate), suggestions: [], dataRequests: [] }),
      });
    });
    await seedGap(page);
    const before = await page.evaluate(async () => {
      const { createLearningProgressStore } = await import("/assets/js/learning-progress.mjs");
      return (await createLearningProgressStore().load()).events.map(item => item.id);
    });
    await page.locator("#generate-practice-candidate").click();
    assert.match(await page.locator("#practice-candidate-status").innerText(), /请先明确授权/);
    assert.equal(payload, null, "without explicit consent, the AI endpoint must not be called");
    await page.locator("#practice-ai-consent").check();
    await page.locator("#generate-practice-candidate").click();
    try {
      await page.locator("#practice-candidate-title").filter({ hasText: "Thenable 内部再注册微任务：日志追踪" }).waitFor({ state: "visible", timeout: 8000 });
    } catch {
      throw new Error(JSON.stringify({
        status: await page.locator("#practice-candidate-status").innerText().catch(() => "missing"),
        providerPayload: payload,
        errors,
        httpErrors,
        active: await page.locator("#practice-candidate-active").isVisible().catch(() => false),
        list: await page.locator("#practice-candidate-list").innerText().catch(() => "missing"),
      }));
    }
    assert.equal(payload.mode, "tutor");
    assert.equal(payload.tutorMode, "practice");
    assert.equal(payload.context.learningScene.gaps[0].id, "thenable-get-vs-call");
    assert.equal(payload.context.learningScene.practiceGeneration.officialSources.length, 2);
    assert.match(await page.locator("#practice-candidate-state").innerText(), /^未评分草案/);
    assert.equal(await page.locator("#practice-ai-consent").isChecked(), false,
      "consent is one-request only and resets after candidate generation");
    await page.locator("#practice-candidate-answer").fill("getter 同步读取后先输出 end，再执行 ThenableJob 调用 then，最后按入队顺序执行 outer 与 inner。");
    await page.locator("#practice-candidate-submit").click();
    await page.getByText(/你的原始推理已保存/).waitFor();
    await page.getByText(/参考答案（AI 草案，未独立审核）/).waitFor();
    const persisted = await page.evaluate(async () => {
      const { createLearningPracticeCandidateStore } = await import("/assets/js/learning-practice-candidates.mjs");
      const { createLearningProgressStore } = await import("/assets/js/learning-progress.mjs");
      const registry = await (await fetch("/content/review-assessments.json")).json();
      return {
        candidates: await createLearningPracticeCandidateStore({ registry }).list({
          competencyId: "thenable-adoption", gapId: "thenable-get-vs-call",
        }),
        eventIds: (await createLearningProgressStore().load()).events.map(item => item.id),
      };
    });
    assert.equal(persisted.candidates.length, 1);
    assert.equal(persisted.candidates[0].status, "attempted");
    assert.equal(persisted.candidates[0].exercise.sourceVariantIds.length, 2);
    assert.equal("variantId" in persisted.candidates[0], false);
    assert.deepEqual(persisted.eventIds, before, "AI draft and candidate answer must not alter Learning Events");
    assert.deepEqual(errors, [], httpErrors.join("\n"));
    assert.deepEqual(httpErrors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});


test("Chromium desktop: a formally resolved Gap disables new AI practice generation", {
  timeout: 60_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page, errors, httpErrors } = await createContext(browser, { width: 1440, height: 1000 });
    let aiRequests = 0;
    await page.route("**/functions/v1/learning-agent", async route => {
      aiRequests += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 1, reply: "{}", suggestions: [], dataRequests: [] }) });
    });
    await seedGap(page);
    await page.locator("#answer-options button[data-option-id='b']").click();
    await page.getByText(/独立验证通过，薄弱点/).waitFor();
    await page.waitForFunction(() => {
      const button = document.querySelector("#generate-practice-candidate");
      return button && button.disabled;
    });
    assert.equal(aiRequests, 0, "the resolved Gap must not request new AI content");
    assert.match(await page.locator("#practice-candidate-status").innerText(), /当前 Gap 已由正式评估纠正/);
    assert.deepEqual(errors, []);
    assert.deepEqual(httpErrors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("WebKit mobile: the gap practice candidate workbench and answer editor fit a 390px viewport", {
  timeout: 60_000,
}, async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const { context, page, errors, httpErrors } = await createContext(browser, { width: 390, height: 844 });
    await seedGap(page);
    const panel = await page.locator("#practice-candidate-workbench").boundingBox();
    assert.ok(panel && panel.width <= 390 && panel.width >= 350);
    await page.locator("#practice-ai-consent").check();
    const consent = await page.locator("#practice-ai-consent").boundingBox();
    const generate = await page.locator("#generate-practice-candidate").boundingBox();
    assert.ok(consent && generate && consent.x + consent.width <= 390 && generate.x + generate.width <= 390);
    await page.locator("#practice-candidate-workbench").scrollIntoViewIfNeeded();
    assert.deepEqual(errors, []);
    assert.deepEqual(httpErrors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
