import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";
import { waitForAsyncPageCondition } from "./helpers/wait-for-async-page-condition.mjs";
import { validateAgentProviderResponse } from "../assets/js/learning-agent/agent-provider.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUN_ID = randomUUID();
const STAGING_ORIGIN = "https://ypthoicwrfsblaidllyy.supabase.co";
const envText = await readFile(new URL("../.env.n2.local", import.meta.url), "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/).filter(line => line && !line.trimStart().startsWith("#") && line.includes("="))
  .map(line => { const index = line.indexOf("="); return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['\"]|['\"]$/g, "")]; }));
assert.equal(env.N2_SUPABASE_URL, STAGING_ORIGIN, "Safety stop: cloud learning loop is restricted to the pinned Staging project.");
for (const key of ["N2_SUPABASE_PUBLISHABLE_KEY", "N2_SYNC_B_EMAIL", "N2_SYNC_B_PASSWORD"]) {
  assert.ok(env[key], `Missing local staging setting ${key}`);
}
const authResponse = await fetch(STAGING_ORIGIN + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { apikey: env.N2_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: env.N2_SYNC_B_EMAIL, password: env.N2_SYNC_B_PASSWORD }),
});
assert.ok(authResponse.ok, "Staging synthetic learner sign-in failed.");
const stagingSession = await authResponse.json();
assert.ok(stagingSession.access_token && stagingSession.refresh_token && stagingSession.user?.id,
  "Staging sign-in did not return a complete session.");
// The browser clock is virtualized for spaced-repetition tests. Keep the client-side
// refresh threshold beyond that virtual window; the real JWT is still verified by
// Supabase on every request and the run completes well before its actual expiry.
const browserSession = { ...stagingSession, expires_at: Math.floor(Date.now() / 1000) + 365 * 86400 };
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const relative = pathname.startsWith("/") ? pathname.slice(1) : pathname;
      let file = resolve(root, relative || "index.html");
      if (file !== root && !file.startsWith(root + sep)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      try {
        if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
      } catch {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, {
        "content-type": mime[extname(file)] || "application/octet-stream",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(500).end("Internal error");
    }
  });
  await new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveServer);
  });
  return { server, baseURL: "http://127.0.0.1:" + server.address().port };
}

const { server, baseURL } = await startServer();
test.after(() => new Promise(resolveServer => server.close(resolveServer)));

async function openAgent(page) {
  await page.goto(baseURL + "/agent/", { waitUntil: "domcontentloaded" });
  await page.locator("#la-workspace").waitFor({ state: "visible" });
  // This account is intentionally reused across isolated E2E runs. Restore its
  // remote baseline before creating run-scoped documents, otherwise singleton
  // documents (plan head / preferences) can race the first sync and report CAS
  // conflicts unrelated to the learning-loop assertions below.
  const initialSync = await page.evaluate(async () => {
    const { getArchiveRuntime } = await import("/assets/js/backend/archive-bootstrap.mjs");
    const runtime = await getArchiveRuntime();
    return runtime.initialSyncPromise;
  });
  assert.equal(initialSync?.status, "synced",
    "the staging learner's existing cloud baseline must restore before the test writes: " + JSON.stringify(initialSync));
  assert.equal(initialSync.conflicts, 0,
    "the staging learner's initial cloud baseline must restore without document conflicts");
}

async function createGoalAndAcceptPlan(page) {
  await page.locator("#la-goal-title").fill(`E2E · ES Promise 云端闭环 ${RUN_ID.slice(0, 8)}`);
  await page.locator("#la-goal-description").fill(`Staging cloud learning loop ${RUN_ID}`);
  await page.locator("#la-goal-topics").selectOption("promise");
  await page.locator("#la-goal-minutes").selectOption("25");
  await page.locator("#la-goal-priority").selectOption("5");
  await page.locator("#la-create-goal button[type=submit]").click();
  await page.locator("#la-goals-list .la-goal-card").first().waitFor({ state: "visible" });

  await page.locator("#la-daily-minutes").selectOption("25");
  await page.locator("#la-weekly-days").selectOption("5");
  await page.locator("#la-pref-topics").selectOption("promise");
  await page.locator("#la-save-preferences").click();
  await waitForAsyncPageCondition(page, async () => {
    const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
    const repository = await getLearningRepository();
    const preferences = await repository.documents.get("learner_profile", "preferences");
    return preferences?.payload?.dailyMinutes === 25 &&
      preferences?.payload?.weeklyDays === 5;
  }, { label: "synthetic learner preferences to persist" });

  await page.locator("#la-regenerate-plan").click();
  await waitForAsyncPageCondition(page, async () => {
    const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
    const repository = await getLearningRepository();
    const head = await repository.documents.get("learning_plan_head", "current");
    const proposalId = head?.payload?.proposedPlanId;
    if (!proposalId) return false;
    const proposal = await repository.documents.get("learning_plan", proposalId);
    return proposal?.payload?.status === "proposed" &&
      proposal?.payload?.dailyMinutes === 25 &&
      proposal?.payload?.reason === "学习者在工作区点击重新规划";
  }, { label: "an adaptive learning plan proposal to persist", timeout: 30000 });
  const proposalText = await page.locator("#la-plan-proposal .la-proposal-card").innerText();
  assert.match(proposalText, /Promise/);
  const proposedPlanId = await page.locator("#la-plan-proposal .la-proposal-card").getAttribute("data-plan-id");
  await page.locator("#la-plan-proposal").getByRole("button", { name: "接受计划并创建任务" }).click();
  const activePlanId = await waitForAsyncPageCondition(page, async () => {
    const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
    const repository = await getLearningRepository();
    const head = await repository.documents.get("learning_plan_head", "current");
    const planId = head?.payload?.activePlanId;
    if (!planId) return false;
    const plan = await repository.documents.get("learning_plan", planId);
    return plan?.payload?.status === "accepted" ? planId : false;
  }, { label: "accepted learning plan", timeout: 30000 });
  await page.locator("#la-active-tasks .la-task-card").first().waitFor({ state: "visible" });
  return { proposedPlanId, activePlanId };
}

async function createPilotTasks(page, planId) {
  return page.evaluate(async activePlanId => {
    const [{ getLearningRepository }, { mapPlanActionToTask }, map, checkpoints] = await Promise.all([
      import("/assets/js/backend/learning-repository.mjs"),
      import("/assets/js/learning-agent/task-orchestrator.mjs"),
      fetch("/content/learning-map.json").then(response => response.json()),
      fetch("/content/learning-checkpoints.json").then(response => response.json()),
    ]);
    const topic = map.topics.find(item => item.id === "promise");
    const competency = topic.competencies.find(item => item.id === "thenable-adoption");
    const checkpoint = checkpoints.checkpoints.find(item => item.id === "cp-promise-identity");
    if (!competency || !checkpoint) throw new Error("Promise pilot registry entries are missing.");
    const planDate = new Date().toISOString().slice(0, 10);
    const reading = mapPlanActionToTask({
      type: "learn",
      actionId: "h1-pilot-read-thenable-adoption",
      planDate,
      href: competency.lessonHref,
      competencyId: competency.id,
      competencyTitle: competency.title,
      topicId: topic.id,
      topicTitle: topic.title,
      estimatedMinutes: 12,
      resourceType: "lesson",
      resourceTitle: competency.title,
      resourceLabel: "阅读课程",
      linkedGoalIds: [],
    }, activePlanId);
    const assessment = mapPlanActionToTask({
      type: "validate",
      actionId: "h1-pilot-check-resolved-settled",
      planDate,
      href: "./lab/experiments/promise-identity/",
      competencyId: checkpoint.competencyId,
      competencyTitle: competency.title,
      topicId: checkpoint.topicId,
      topicTitle: topic.title,
      estimatedMinutes: 5,
      resourceType: "checkpoint",
      resourceTitle: checkpoint.title,
      resourceLabel: "独立检查点",
      variantId: checkpoint.id,
      workId: checkpoint.workId,
    }, activePlanId, { dependsOnTaskIds: [reading.taskId] });

    const repository = await getLearningRepository();
    await repository.commit({
      documents: [
        { type: "learning_task", key: reading.taskId, payload: reading, expectedLocalRevision: 0 },
        { type: "learning_task", key: assessment.taskId, payload: assessment, expectedLocalRevision: 0 },
      ],
    });
    return {
      planId: activePlanId,
      reading: { taskId: reading.taskId, href: reading.href, status: reading.status },
      assessment: { taskId: assessment.taskId, href: assessment.href, status: assessment.status },
    };
  }, planId);
}

async function readTask(page, tasks) {
  const task = tasks.reading;
  await page.goto(new URL(task.href, baseURL + "/").href, { waitUntil: "domcontentloaded" });
  await page.locator("#kv-course-learning-task").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "开始本节阅读" }).click();
  await page.getByRole("button", { name: "暂停阅读" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "暂停阅读" }).click();
  await waitForAsyncPageCondition(page, async taskId => {
    const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
    const row = await (await getLearningRepository()).documents.get("learning_task", taskId);
    return row?.payload?.status === "paused";
  }, { arg: task.taskId, label: "reading task pause to persist" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#kv-course-learning-task").waitFor({ state: "visible" });
  await page.locator(".kv-course-task-status").waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    document.querySelector(".kv-course-task-status")?.textContent.includes("已暂停")
  , { timeout: 15000 }).catch(async error => {
    const diagnostic = await page.locator("#kv-course-learning-task").innerText();
    throw new Error("Reading state did not restore as paused: " + diagnostic + " | " + error.message);
  });
  await page.getByRole("button", { name: "继续阅读" }).click();
  await page.getByRole("button", { name: "确认完成本节阅读" }).click();
  await waitForAsyncPageCondition(page, async taskId => {
    const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
    const row = await (await getLearningRepository()).documents.get("learning_task", taskId);
    return row?.payload?.status === "completed";
  }, { arg: task.taskId, label: "reading task completion to persist" });
  const result = await page.evaluate(async input => {
    const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
    const { createLearningTaskOrchestrator } = await import("/assets/js/learning-agent/task-orchestrator.mjs");
    const repository = await getLearningRepository();
    const orchestrator = createLearningTaskOrchestrator({ repository });
    const [reading, assessment, events] = await Promise.all([
      orchestrator.get(input.readingId),
      orchestrator.get(input.assessmentId),
      repository.events.list(),
    ]);
    return {
      readingStatus: reading?.status,
      readingEvidence: reading?.evidenceEventIds || [],
      assessmentStatus: assessment?.status,
      relevantEvents: events.filter(event => event.taskId === input.readingId),
    };
  }, { readingId: task.taskId, assessmentId: tasks.assessment.taskId });
  assert.equal(result.readingStatus, "completed");
  assert.equal(result.assessmentStatus, "ready", "reader completion must unlock the dependent checkpoint");
  assert.equal(result.readingEvidence.length, 0, "reading completion is execution evidence, not mastery evidence");
  assert.ok(result.relevantEvents.some(event => event.type === "learning_task_completed"));
}

async function failCheckpointAndCreateReviewTask(page, task, planId) {
  await page.goto(new URL(task.href, baseURL + "/").href, { waitUntil: "domcontentloaded" });
  await page.locator("#kv-learning-launcher").waitFor({ state: "visible" });
  await page.locator("#kv-learning-launcher").click();
  await page.locator("#kv-learning-checkpoint").waitFor({ state: "visible" });
  await page.locator('#kv-learning-checkpoint [data-option-id="a"]').click();
  await page.getByText("还需要补强这个概念", { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("link", { name: "前往针对性复习" }).waitFor({ state: "visible" });

  const seeded = await page.evaluate(async input => {
    const [{ getLearningRepository }, { mapPlanActionToTask }, map] = await Promise.all([
      import("/assets/js/backend/learning-repository.mjs"),
      import("/assets/js/learning-agent/task-orchestrator.mjs"),
      fetch("/content/learning-map.json").then(response => response.json()),
    ]);
    const competency = map.topics.find(item => item.id === "promise")
      .competencies.find(item => item.id === "thenable-adoption");
    const action = mapPlanActionToTask({
      type: "repair",
      actionId: "h1-pilot-repair-resolved-vs-settled",
      planDate: new Date().toISOString().slice(0, 10),
      href: "./review/?competencyId=thenable-adoption&gapId=resolved-vs-settled",
      competencyId: "thenable-adoption",
      competencyTitle: competency.title,
      topicId: "promise",
      topicTitle: "JavaScript · Promise",
      estimatedMinutes: 8,
      resourceType: "review",
      resourceTitle: "解决权与落定状态",
      resourceLabel: "针对性复习",
      gapId: "resolved-vs-settled",
    }, input.planId);
    const repository = await getLearningRepository();
    await repository.commit({
      documents: [{ type: "learning_task", key: action.taskId, payload: action, expectedLocalRevision: 0 }],
    });
    const [events, checkpointTask] = await Promise.all([
      repository.events.list(),
      repository.documents.get("learning_task", input.checkpointTaskId),
    ]);
    const failure = events.find(event =>
      event.type === "attempt" && event.correct === false &&
      event.gapId === "resolved-vs-settled" &&
      (event.competencyIds || []).includes("thenable-adoption"));
    return {
      reviewTask: { taskId: action.taskId, href: action.href, status: action.status },
      failure: failure ? {
        id: failure.id,
        gapObservationId: failure.gapObservationId,
        gapId: failure.gapId,
        taskId: failure.taskId,
        variantId: failure.variantId,
      } : null,
      checkpointStatus: checkpointTask?.payload?.status,
      failureCount: events.filter(event => event.type === "attempt" && event.correct === false &&
        event.gapId === "resolved-vs-settled").length,
    };
  }, { planId, checkpointTaskId: task.taskId });
  assert.ok(seeded.failure, "the wrong checkpoint answer must create a real persisted gap observation");
  assert.equal(seeded.failure.taskId, task.taskId);
  assert.equal(seeded.checkpointStatus, "failed");
  assert.equal(seeded.reviewTask.status, "ready");
  return seeded;
}

async function repairGapWithHintThenIndependentVariant(page, reviewTask) {
  const reviewURL = new URL(reviewTask.href, baseURL + "/");
  reviewURL.searchParams.set("taskId", reviewTask.taskId);
  await page.goto(reviewURL.href, { waitUntil: "domcontentloaded" });
  await page.locator("#question-title").waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    document.querySelector("#question-title")?.textContent.includes("解决权与落定状态"));
  assert.match(await page.locator("#question-title").innerText(), /解决权与落定状态/);
  assert.equal(await page.locator("#question-progress").innerText(), "TARGETED GAP REVIEW");

  // First review: assisted pass. It must not close the original gap or complete the review task.
  await page.locator("#reveal-hint").click();
  await page.locator('[data-option-id="b"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#answer-feedback")?.textContent.includes("提示辅助证据"));
  const assisted = await page.evaluate(async taskId => {
    const [{ getLearningRepository }, { deriveLearningInsights }] = await Promise.all([
      import("/assets/js/backend/learning-repository.mjs"),
      import("/assets/js/learning-progress.mjs"),
    ]);
    const [map, challengeRegistry] = await Promise.all([
      fetch("/content/learning-map.json").then(response => response.json()),
      fetch("/content/challenges.json").then(response => response.json()),
    ]);
    const repository = await getLearningRepository();
    const [events, task] = await Promise.all([
      repository.events.list(),
      repository.documents.get("learning_task", taskId),
    ]);
    const insights = deriveLearningInsights(map, challengeRegistry, { events });
    const competency = insights.competencyInsights.find(item => item.id === "thenable-adoption");
    return {
      taskStatus: task?.payload?.status,
      activeGapIds: (competency?.activeGaps || []).map(item => item.id),
      assistedPass: events.find(event => event.type === "assessment_passed" &&
        event.sessionType === "review" && event.hintsUsed > 0),
      failedReviewTaskEvent: events.some(event => event.type === "learning_task_failed" &&
        event.taskId === taskId),
    };
  }, reviewTask.taskId);
  assert.equal(assisted.taskStatus, "failed", "hint-assisted pass must not complete an independent review task");
  assert.ok(assisted.activeGapIds.includes("resolved-vs-settled"),
    "hint-assisted pass must leave the original gap open");
  assert.equal(assisted.assistedPass?.independent, false);
  assert.equal(assisted.failedReviewTaskEvent, true);

  // Second review: a different registered variant, no hints, and the exact same target gap.
  await page.locator("#next-variant").click();
  await page.waitForFunction(() =>
    document.querySelector("#question-title")?.textContent.includes("解决权与落定状态：延迟观察"));
  await page.locator('[data-option-id="b"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#answer-feedback")?.textContent.includes("精确纠正"));
  const result = await page.evaluate(async taskId => {
    const [{ getLearningRepository }, { deriveLearningInsights }] = await Promise.all([
      import("/assets/js/backend/learning-repository.mjs"),
      import("/assets/js/learning-progress.mjs"),
    ]);
    const [map, challengeRegistry] = await Promise.all([
      fetch("/content/learning-map.json").then(response => response.json()),
      fetch("/content/challenges.json").then(response => response.json()),
    ]);
    const repository = await getLearningRepository();
    const [events, task] = await Promise.all([
      repository.events.list(),
      repository.documents.get("learning_task", taskId),
    ]);
    const insights = deriveLearningInsights(map, challengeRegistry, { events });
    const competency = insights.competencyInsights.find(item => item.id === "thenable-adoption");
    const started = events.filter(event => event.type === "review_started" &&
      event.sessionType === "review" && event.gapId === "resolved-vs-settled");
    const passed = events.find(event => event.type === "assessment_passed" &&
      event.sessionType === "review" && event.gapId === "resolved-vs-settled" && event.hintsUsed === 0);
    const attempt = passed && events.find(event => event.type === "attempt" &&
      event.id === passed.causationEventIds?.find(id => id.includes(":attempt:")) &&
      event.correct === true);
    return {
      taskStatus: task?.payload?.status,
      taskEvidence: task?.payload?.evidenceEventIds || [],
      activeGapIds: (competency?.activeGaps || []).map(item => item.id),
      reviewStarted: started.map(event => ({
        id: event.id, sessionId: event.sessionId, variantId: event.variantId,
        parents: event.causationEventIds, targets: event.targetGapEventIds,
      })),
      passed: passed ? {
        id: passed.id,
        sessionId: passed.sessionId,
        variantId: passed.variantId,
        hintsUsed: passed.hintsUsed,
        independent: passed.independent,
        targetGapEventIds: passed.targetGapEventIds,
        causationEventIds: passed.causationEventIds,
      } : null,
      attempt: attempt ? { id: attempt.id, variantId: attempt.variantId, correct: attempt.correct, hintsUsed: attempt.hintsUsed } : null,
      completionEvent: events.find(event => event.type === "learning_task_completed" && event.taskId === taskId),
      history: events.filter(event => event.sessionType === "review"),
    };
  }, reviewTask.taskId);

  assert.equal(result.taskStatus, "completed");
  assert.ok(result.taskEvidence.length > 0);
  assert.deepEqual(result.activeGapIds, [], "the precise original gap must be resolved");
  assert.ok(result.passed);
  assert.equal(result.passed.hintsUsed, 0);
  assert.equal(result.passed.independent, true);
  assert.ok(result.passed.targetGapEventIds.length > 0);
  assert.ok(result.passed.causationEventIds.length >= 2);
  assert.equal(result.completionEvent?.taskId, reviewTask.taskId);
  assert.equal(result.history.some(event => event.type === "attempt" && event.hintsUsed > 0), true);
  const independentStart = result.reviewStarted.find(item => item.sessionId === result.passed.sessionId);
  assert.ok(independentStart?.targets?.includes(result.passed.targetGapEventIds[0]),
    "independent review start must retain the exact original failed observation in targetGapEventIds: " +
      JSON.stringify(result.reviewStarted));
  assert.notEqual(independentStart?.variantId, result.reviewStarted.find(item => item.sessionId !== result.passed.sessionId)?.variantId,
    "independent correction must use a different registered variant from the assisted session");
  return result;
}

test("Chromium desktop: Staging learner completes goal → plan → lesson → checkpoint → gap repair → delayed scheduling → cloud sync → second-device restore", {
  timeout: 180000,
}, async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.KNOWVERSE_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.KNOWVERSE_CHROMIUM_EXECUTABLE }
      : {}),
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      timezoneId: "Asia/Tokyo",
    });
    const page = await context.newPage();
    const errors = [];
    const failedRequests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error" && !message.text().includes("favicon.ico")) errors.push(message.text());
    });
    page.on("requestfailed", request => {
      const url = request.url();
      // Mermaid is an optional enhancement for static diagrams. Its loader has an
      // explicit source-preserving fallback, so a third-party CDN outage must not
      // fail an otherwise local-first learning-pilot test. Keep every first-party
      // asset/API request under the strict no-failure assertion below.
      if (url.startsWith("https://cdn.jsdelivr.net/npm/mermaid@12/")) return;
      failedRequests.push(request.method() + " " + url);
    });

    // Each run uses an isolated browser profile, but authenticates against the pinned Staging project.
    await page.addInitScript(({ url, key, session }) => {
      globalThis.KNOWVERSE_BACKEND_CONFIG = { supabaseUrl: url, publishableKey: key };
      localStorage.setItem("knowverse:supabase-session", JSON.stringify(session));
    }, { url: STAGING_ORIGIN, key: env.N2_SUPABASE_PUBLISHABLE_KEY, session: browserSession });
    // Pin browser time for deterministic plan dates; only the browser clock is virtualized.
    await page.clock.install({ time: new Date("2026-11-03T10:00:00+09:00") });

    await openAgent(page);
    const plan = await createGoalAndAcceptPlan(page);
    const tasks = await createPilotTasks(page, plan.activePlanId);
    assert.equal(tasks.reading.status, "ready");
    assert.equal(tasks.assessment.status, "locked",
      "checkpoint task must remain blocked until the prerequisite lesson task is completed");

    await readTask(page, tasks);
    const checkpointFailure = await failCheckpointAndCreateReviewTask(page, tasks.assessment, plan.activePlanId);
    assert.equal(checkpointFailure.failure.gapId, "resolved-vs-settled");
    assert.ok(checkpointFailure.failure.gapObservationId);
    assert.equal(checkpointFailure.failureCount, 1);

    const review = await repairGapWithHintThenIndependentVariant(page, checkpointFailure.reviewTask);

    // Advance only the isolated browser clock well beyond the evidence date.
    // This is a scheduling simulation, not evidence of real human delayed recall.
    await page.clock.setFixedTime(new Date("2026-12-03T10:00:00+09:00"));
    await page.goto(baseURL + "/progress/", { waitUntil: "domcontentloaded" });
    await page.locator("#hero-tested").waitFor({ state: "visible" });
    await page.locator("#proactive-learning > summary").click();
    await page.locator("#proactive-review-queue").waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const links = [...document.querySelectorAll("#proactive-review-queue a")];
      return links.some(link => {
        const href = new URL(link.href);
        return href.searchParams.get("competencyId") === "thenable-adoption";
      });
    }, { timeout: 15000 }).catch(async error => {
      const state = await page.evaluate(() => ({
        reviewQueue: document.querySelector("#proactive-review-queue")?.innerText || null,
        tested: document.querySelector("#hero-tested")?.innerText || null,
        gaps: document.querySelector("#gap-list")?.innerText || null,
      }));
      throw new Error("The delayed review queue did not surface the Promise competency: " +
        JSON.stringify(state) + " | " + error.message);
    });

    const audit = await page.evaluate(async input => {
      const [{ getLearningRepository }, { calculateReviewSchedule }, { deriveLearningInsights }] = await Promise.all([
        import("/assets/js/backend/learning-repository.mjs"),
        import("/assets/js/spaced-repetition-engine.mjs"),
        import("/assets/js/learning-progress.mjs"),
      ]);
      const [map, challenges, repository] = await Promise.all([
        fetch("/content/learning-map.json").then(response => response.json()),
        fetch("/content/challenges.json").then(response => response.json()),
        getLearningRepository(),
      ]);
      const events = await repository.events.list();
      const insights = deriveLearningInsights(map, challenges, { events }, new Date());
      const competency = insights.competencyInsights.find(item => item.id === "thenable-adoption");
      const schedule = calculateReviewSchedule({
        competencyId: "thenable-adoption",
        events: events.filter(event => (event.competencyIds || []).includes("thenable-adoption")),
        intelligence: competency,
        now: new Date(),
      });
      const documentRows = await repository.documents.list(1000);
      const goal = documentRows.find(row => row.type === "learning_goal" &&
        row.payload?.title?.includes(input.runId.slice(0, 8)));
      if (!goal) throw new Error("Run-scoped learning goal is missing from the local archive.");
      const plans = documentRows.filter(row => row.type === "learning_plan" &&
        row.payload?.linkedGoalIds?.includes(goal.key));
      const planIds = new Set(plans.map(row => row.key));
      const taskRows = documentRows.filter(row => row.type === "learning_task" &&
        (planIds.has(row.payload?.planId) || row.payload?.linkedGoalIds?.includes(goal.key)));
      const taskIds = new Set(taskRows.map(row => row.key));
      const runEvents = events.filter(event => event.goalId === goal.key ||
        planIds.has(event.planId) || planIds.has(event.sessionId) || taskIds.has(event.taskId));
      return {
        goals: 1,
        acceptedPlans: plans.filter(row => row.payload?.status === "accepted").length,
        tasks: taskRows.map(row => ({
          taskType: row.payload.taskType, status: row.payload.status, title: row.payload.title,
        })),
        schedule: {
          status: schedule.status,
          dueAt: schedule.dueAt,
          intervalDays: schedule.intervalDays,
          independentReviewCount: schedule.independentReviewCount,
          latestQuality: schedule.latestQuality,
        },
        activeGapIds: competency.activeGaps.map(item => item.id),
        mastery: {
          status: competency.status,
          score: competency.masteryScore,
          evidenceCount: competency.evidenceCount,
          independentReviewCount: schedule.independentReviewCount,
        },
        reviewEvidenceIds: input.reviewEvidence,
        eventCount: runEvents.length,
      };
    }, { reviewEvidence: review.taskEvidence, runId: RUN_ID });
    assert.equal(audit.goals, 1);
    assert.equal(audit.acceptedPlans, 1);
    assert.deepEqual(audit.activeGapIds, []);
    assert.ok(audit.mastery.evidenceCount >= 1 && audit.mastery.score >= 80,
      "the independent review must update the derived mastery score: " + JSON.stringify(audit.mastery));
    assert.ok(audit.mastery.independentReviewCount >= 1,
      "the spaced-repetition scheduler must count the independent no-hint review");
    assert.ok(audit.schedule.isDue || ["due", "overdue"].includes(audit.schedule.status),
      "a virtual +30-day clock should make the competency due or overdue for delayed review: " +
      JSON.stringify(audit.schedule));
    assert.ok(audit.tasks.some(task => task.taskType === "read" && task.status === "completed"));
    assert.ok(audit.tasks.some(task => task.taskType === "assessment" && task.status === "failed"));
    assert.ok(audit.tasks.some(task => task.taskType === "review" && task.status === "completed"));
    assert.ok(audit.eventCount >= 10);
    assert.deepEqual(errors, [], "no uncaught page or console errors");
    assert.deepEqual(failedRequests, [], "no failed network requests");
    // Force a final atomic cloud sync, then verify the exact run's events and documents are acknowledged.
    const cloudPush = await page.evaluate(async () => {
      const { getArchiveRuntime } = await import("/assets/js/backend/archive-bootstrap.mjs");
      const runtime = await getArchiveRuntime();
      if (!runtime.syncService) throw new Error("Staging sync runtime did not start.");
      return runtime.syncService.sync();
    });
    assert.equal(cloudPush.status, "synced", "the complete learning run must sync to Staging PostgreSQL");
    assert.equal(cloudPush.conflicts, 0, "the cloud learning run must not contain document conflicts");
    assert.equal(cloudPush.pending, 0, "the cloud sync must acknowledge every event in the Outbox");
    const localSnapshot = await page.evaluate(async runId => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const repository = await getLearningRepository();
      const [documents, events] = await Promise.all([repository.documents.list(2000), repository.events.list()]);
      const goal = documents.find(row => row.type === "learning_goal" && row.payload?.title?.includes(runId.slice(0, 8)));
      if (!goal) throw new Error("Unique cloud E2E goal is missing from the local archive.");
      const plans = documents.filter(row => row.type === "learning_plan" &&
        row.payload?.linkedGoalIds?.includes(goal.key));
      const planIds = new Set(plans.map(row => row.key));
      const taskRows = documents.filter(row => row.type === "learning_task" &&
        (planIds.has(row.payload?.planId) || row.payload?.linkedGoalIds?.includes(goal.key)));
      const linked = documents.filter(row => row.type === "learning_goal" && row.key === goal.key ||
        row.type === "learning_plan_head" || plans.includes(row) || taskRows.includes(row));
      const taskIds = new Set(taskRows.map(row => row.key));
      const goalEvents = events.filter(event => event.goalId === goal.key ||
        planIds.has(event.planId) || planIds.has(event.sessionId) || taskIds.has(event.taskId));
      return { goalKey: goal.key, goalTitle: goal.payload.title,
        planIds: [...planIds], taskIds: [...taskIds],
        documentKeys: linked.map(row => ({ type: row.type, key: row.key, revision: row.revision })),
        eventIds: goalEvents.map(event => event.id), eventCount: goalEvents.length,
        eventTypes: goalEvents.map(event => event.type) };
    }, RUN_ID);
    assert.ok(localSnapshot.eventCount >= 8, "the learning loop must create a meaningful set of cloud-persisted evidence events");

    // A fresh browser context has an empty IndexedDB. Pull-only restoration proves cross-device durability.
    const secondContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Tokyo" });
    await secondContext.addInitScript(({ url, key, session }) => {
      globalThis.KNOWVERSE_BACKEND_CONFIG = { supabaseUrl: url, publishableKey: key };
      localStorage.setItem("knowverse:supabase-session", JSON.stringify(session));
    }, { url: STAGING_ORIGIN, key: env.N2_SUPABASE_PUBLISHABLE_KEY, session: browserSession });
    const secondPage = await secondContext.newPage();
    await secondPage.goto(baseURL + "/agent/", { waitUntil: "domcontentloaded" });
    await secondPage.locator("#la-workspace").waitFor({ state: "visible" });
    const restored = await secondPage.evaluate(async () => {
      const { getArchiveRuntime } = await import("/assets/js/backend/archive-bootstrap.mjs");
      const runtime = await getArchiveRuntime();
      const initialSync = await runtime.initialSyncPromise;
      const result = await runtime.syncService.restoreFromCloud();
      const [{ getLearningRepository }, { deriveLearningInsights }] = await Promise.all([
        import("/assets/js/backend/learning-repository.mjs"),
        import("/assets/js/learning-progress.mjs"),
      ]);
      const [map, challenges, repository] = await Promise.all([
        fetch("/content/learning-map.json").then(response => response.json()),
        fetch("/content/challenges.json").then(response => response.json()),
        getLearningRepository(),
      ]);
      const [documents, events] = await Promise.all([repository.documents.list(2000), repository.events.list()]);
      const competency = deriveLearningInsights(map, challenges, { events }, new Date())
        .competencyInsights.find(item => item.id === "thenable-adoption");
      return { initialSync, result, documents: documents.map(row => ({ type: row.type, key: row.key, revision: row.revision })),
        eventIds: events.map(event => event.id),
        mastery: { status: competency?.status, score: competency?.masteryScore,
          evidenceCount: competency?.evidenceCount, activeGapIds: competency?.activeGaps?.map(item => item.id) || [] } };
    });
    assert.equal(restored.result.status, "restored", "a fresh browser must restore from Staging cloud");
    assert.ok(localSnapshot.documentKeys.every(item => restored.documents.some(row =>
      row.type === item.type && row.key === item.key && row.revision === item.revision)),
      "the second browser must restore every document from the cloud run");
    assert.ok(localSnapshot.eventIds.every(id => restored.eventIds.includes(id)),
      "the second browser must restore every learning evidence event from the cloud run");
    assert.equal(restored.initialSync.status, "synced", "the fresh browser initial cloud restore must finish successfully");
    assert.ok(restored.initialSync.pulled >= localSnapshot.eventCount,
      "the fresh browser must pull the complete learning evidence stream during initial sync");
    assert.deepEqual(restored.mastery.activeGapIds, [],
      "the second device must derive the same resolved gap state from cloud events");
    assert.ok(restored.mastery.score >= 80 && restored.mastery.evidenceCount >= 1,
      "the second device must rebuild the updated mastery score from restored evidence: " +
      JSON.stringify(restored.mastery));
    // Exercise the real Agent -> read-only tool -> Agent response loop against the restored learner.
    const agentMessage = "请先调用只读工具 get_learner_profile 获取我的当前目标、掌握度和薄弱点，然后基于真实资料建议下一步。不要调用任何写工具。";
    const agentCall = async context => {
      const response = await fetch(STAGING_ORIGIN + "/functions/v1/learning-agent", {
        method: "POST",
        headers: { apikey: env.N2_SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + stagingSession.access_token,
          "Content-Type": "application/json" },
        signal: AbortSignal.timeout(70_000),
        body: JSON.stringify({ version: 1, mode: "agent", message: agentMessage, context }),
      });
      const data = await response.json().catch(() => ({}));
      assert.equal(response.status, 200, "contextual Agent call must succeed: " + JSON.stringify(data.error || {}));
      return validateAgentProviderResponse(data);
    };
    const emptyAgentContext = {
      goals: [], mastery: [], weakPoints: [], competencyStates: [], activePlan: null,
      recentConversation: [], requestedToolResults: [],
    };
    const firstAgentPass = await agentCall(emptyAgentContext);
    assert.ok(firstAgentPass.dataRequests.length > 0,
      "the contextual Agent must request the learner profile before recommending");
    const safeToolNames = new Set([
      "get_learner_profile", "get_learning_goals", "get_mastery_snapshot",
      "get_active_gaps", "get_learning_history", "get_learning_graph", "explain_plan",
      "get_next_learning_action", "get_review_recommendations",
    ]);
    const safeToolRequests = firstAgentPass.dataRequests.map(request => {
      assert.ok(safeToolNames.has(request.toolName), "Agent requested an unsupported read-only tool: " + request.toolName);
      return request;
    });
    const agentToolResults = await secondPage.evaluate(async requests => {
      const [
        { executeAgentTool, AGENT_TOOL_SCHEMAS },
        { getLearningRepository },
        { createLearnerProfileStore },
        { createLearningGoalManager },
        { createLearningTaskOrchestrator },
        { createLearningPlanManager },
      ] = await Promise.all([
        import("/assets/js/learning-agent/agent-tools.mjs"),
        import("/assets/js/backend/learning-repository.mjs"),
        import("/assets/js/learning-agent/learner-profile.mjs"),
        import("/assets/js/learning-agent/goal-manager.mjs"),
        import("/assets/js/learning-agent/task-orchestrator.mjs"),
        import("/assets/js/learning-agent/plan-manager.mjs"),
      ]);
      const [learningMap, challengeRegistry, repository] = await Promise.all([
        fetch("/content/learning-map.json").then(response => response.json()),
        fetch("/content/challenges.json").then(response => response.json()),
        getLearningRepository(),
      ]);
      const profileStore = createLearnerProfileStore({ repository });
      const goalManager = createLearningGoalManager({ repository, learningMap });
      const taskOrchestrator = createLearningTaskOrchestrator({ repository });
      const planManager = createLearningPlanManager({ repository, taskOrchestrator });
      const projectionRow = await repository.documents.get("proactive_learning_projection", "current");
      const context = { repository, profileStore, goalManager, taskOrchestrator, planManager,
        learningMap, challengeRegistry, proactiveProjection: projectionRow?.payload || null, now: new Date() };
      const before = await Promise.all([repository.events.list(), repository.documents.list(2000)]);
      const results = [];
      for (const request of requests) {
        const definition = AGENT_TOOL_SCHEMAS[request.toolName];
        if (!definition || definition.mutating) throw new Error("model requested a non-read-only Agent tool");
        if (request.toolName === "get_next_learning_action" && !context.proactiveProjection?.nextBestActions?.length) {
          throw new Error("read-only next-action snapshot is unavailable; refusing a fallback that could refresh task state");
        }
        const result = await executeAgentTool(request.toolName, request.input, context,
          { origin: "model", confirmed: false });
        let compact;
        if (request.toolName === "get_learner_profile") {
          compact = {
            generatedAt: result.generatedAt, goals: (result.goals || []).slice(0, 10),
            mastery: { summary: result.mastery?.summary,
              weakCompetencies: (result.mastery?.weakCompetencies || []).slice(0, 12),
              unverifiedCompetencies: (result.mastery?.unverifiedCompetencies || []).slice(0, 12),
              activeGaps: (result.mastery?.activeGaps || []).slice(0, 12) },
            behavior: { learningDaysLast7: result.behavior?.learningDaysLast7,
              taskCompletionRate: result.behavior?.taskCompletionRate,
              hintDependencyRate: result.behavior?.hintDependencyRate },
            growth: { evidenceLast7Days: result.growth?.evidenceLast7Days,
              recentActivityAt: result.growth?.recentActivityAt },
          };
        } else if (request.toolName === "get_learning_goals") {
          compact = result.slice(0, 20).map(goal => ({ goalId: goal.goalId, title: goal.title,
            status: goal.status, topicIds: goal.topicIds, competencyIds: goal.competencyIds,
            targetAt: goal.targetAt, priority: goal.priority, dailyMinutes: goal.dailyMinutes }));
        } else if (request.toolName === "get_mastery_snapshot") compact = result.slice(0, 20);
        else if (request.toolName === "get_active_gaps") compact = result.slice(0, 12);
        else if (request.toolName === "get_learning_history") compact = result.slice(0, 30);
        else if (request.toolName === "get_learning_graph") compact = result;
        else compact = result;
        results.push({ toolName: request.toolName, input: request.input, result: compact });
      }
      const after = await Promise.all([repository.events.list(), repository.documents.list(2000)]);
      if (before[0].length !== after[0].length || before[1].length !== after[1].length) {
        throw new Error("read-only Agent tools changed local learning records");
      }
      return { results, eventCount: after[0].length, documentCount: after[1].length };
    }, safeToolRequests);
    assert.ok(JSON.stringify(agentToolResults.results).includes(localSnapshot.goalTitle),
      "the read-only learner-profile tool must return the actual Staging goal");
    const secondAgentPass = await agentCall({ ...emptyAgentContext,
      requestedToolResults: agentToolResults.results });
    assert.ok(secondAgentPass.reply.trim().length > 0);
    assert.ok(secondAgentPass.suggestions.length <= 4);
    assert.ok(secondAgentPass.dataRequests.length <= 3);
    const { AGENT_TOOL_SCHEMAS, executeAgentTool, validateAgentToolInput } =
      await import("../assets/js/learning-agent/agent-tools.mjs");
    const deniedMutationSuggestions = [];
    for (const suggestion of secondAgentPass.suggestions) {
      const definition = AGENT_TOOL_SCHEMAS[suggestion.toolName];
      if (!definition?.mutating) continue;
      validateAgentToolInput(suggestion.toolName, suggestion.input);
      await assert.rejects(
        () => executeAgentTool(suggestion.toolName, suggestion.input, {}, { origin: "model", confirmed: false }),
        /只能提出建议/,
        "a model-generated mutation proposal must not execute without learner confirmation",
      );
      deniedMutationSuggestions.push(suggestion.toolName);
    }
    const afterAgentCounts = await secondPage.evaluate(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const repository = await getLearningRepository();
      const [events, documents] = await Promise.all([repository.events.list(), repository.documents.list(2000)]);
      return { events: events.length, documents: documents.length };
    });
    assert.equal(afterAgentCounts.events, agentToolResults.eventCount,
      "the Agent read/recommendation loop must not append learning events");
    assert.equal(afterAgentCounts.documents, agentToolResults.documentCount,
      "the Agent read/recommendation loop must not mutate learning documents");

    console.log("STAGING CLOUD LOOP:", JSON.stringify({
      project: "knowverse-staging", userId: stagingSession.user.id,
      runId: RUN_ID, goalKey: localSnapshot.goalKey,
      cloudDocumentsVerified: localSnapshot.documentKeys.length,
      cloudEventsVerified: localSnapshot.eventIds.length,
      secondDeviceEventsPulled: restored.initialSync.pulled,
      secondDeviceMastery: restored.mastery,
      agentReadTools: safeToolRequests.map(item => item.toolName),
      agentFollowUpReplyChars: secondAgentPass.reply.length,
      agentSuggestionsProposed: secondAgentPass.suggestions.map(item => item.toolName),
      mutationSuggestionsDenied: deniedMutationSuggestions,
      agentLocalEventCount: agentToolResults.eventCount,
      syncStatus: cloudPush.status, pending: cloudPush.pending, conflicts: cloudPush.conflicts,
    }));
    await secondContext.close();
    await context.close();
  } finally {
    await browser.close();
  }
});
