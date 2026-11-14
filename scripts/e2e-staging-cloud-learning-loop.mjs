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
  // Restore the existing Staging baseline on a passive page before mounting the
  // Agent workspace. The workspace initializes learner defaults during mount;
  // doing that before the first pull would manufacture local/cloud CAS conflicts
  // for singleton documents such as preferences and strategy. This is test-order
  // isolation only: it does not alter the production sync engine or scheduler.
  await page.goto(baseURL + "/knowledge/", { waitUntil: "domcontentloaded" });
  const initialSync = await page.evaluate(async () => {
    const { getArchiveRuntime } = await import("/assets/js/backend/archive-bootstrap.mjs");
    const runtime = await getArchiveRuntime();
    return runtime.initialSyncPromise;
  });
  assert.equal(initialSync?.status, "synced",
    "the staging learner's existing cloud baseline must restore before the test writes: " + JSON.stringify(initialSync));
  assert.equal(initialSync.conflicts, 0,
    "the staging learner's initial cloud baseline must restore without document conflicts");
  await page.goto(baseURL + "/agent/", { waitUntil: "domcontentloaded" });
  await page.locator("#la-workspace").waitFor({ state: "visible" });
}

async function createGoalAndAcceptPlan(page) {
  await page.locator("#la-goal-title").fill(`E2E · AI 多模态云端闭环 ${RUN_ID.slice(0, 8)}`);
  await page.locator("#la-goal-description").fill(`Staging cloud learning loop ${RUN_ID}`);
  await page.locator("#la-goal-topics").selectOption("ai-education");
  await page.locator("#la-goal-minutes").selectOption("25");
  await page.locator("#la-goal-priority").selectOption("5");
  await page.locator("#la-create-goal button[type=submit]").click();
  await page.locator("#la-goals-list .la-goal-card").first().waitFor({ state: "visible" });

  await page.locator("#la-daily-minutes").selectOption("60");
  await page.locator("#la-weekly-days").selectOption("5");
  await page.locator("#la-pref-topics").selectOption("ai-education");
  await page.locator("#la-save-preferences").click();
  await waitForAsyncPageCondition(page, async () => {
    const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
    const repository = await getLearningRepository();
    const preferences = await repository.documents.get("learner_profile", "preferences");
    return preferences?.payload?.dailyMinutes === 60 &&
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
      proposal?.payload?.dailyMinutes === 60 &&
      proposal?.payload?.reason === "学习者在工作区点击重新规划";
  }, { label: "an adaptive learning plan proposal to persist", timeout: 30000 });
  const proposalText = await page.locator("#la-plan-proposal .la-proposal-card").innerText();
  assert.match(proposalText, /多模态教育|AI/);
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
  return page.evaluate(async ({ activePlanId, runId }) => {
    const [{ getLearningRepository }, { mapPlanActionToTask }, map] = await Promise.all([
      import("/assets/js/backend/learning-repository.mjs"),
      import("/assets/js/learning-agent/task-orchestrator.mjs"),
      fetch("/content/learning-map.json").then(response => response.json()),
    ]);
    const topic = map.topics.find(item => item.id === "ai-education");
    const competency = topic.competencies.find(item => item.id === "multimodal-learning-architecture");
    if (!competency?.assessmentHref) throw new Error("AI Education competency or assessment route is missing.");
    const planDate = new Date().toISOString().slice(0, 10);
    const reading = mapPlanActionToTask({
      type: "learn", actionId: "h1-pilot-read-multimodal:" + runId, planDate,
      href: competency.lessonHref, competencyId: competency.id, competencyTitle: competency.title,
      topicId: topic.id, topicTitle: topic.title, estimatedMinutes: 12,
      resourceType: "lesson", resourceTitle: competency.title, resourceLabel: "阅读课程", linkedGoalIds: [],
    }, activePlanId);
    const assessment = mapPlanActionToTask({
      type: "practice", actionId: "h1-pilot-assess-multimodal:" + runId, planDate,
      href: competency.assessmentHref, competencyId: competency.id, competencyTitle: competency.title,
      topicId: topic.id, topicTitle: topic.title, estimatedMinutes: 5,
      resourceType: "assessment", resourceTitle: competency.title,
      resourceLabel: "独立能力检查", linkedGoalIds: [],
    }, activePlanId, { dependsOnTaskIds: [reading.taskId] });
    const repository = await getLearningRepository();
    await repository.commit({ documents: [
      { type: "learning_task", key: reading.taskId, payload: reading, expectedLocalRevision: 0 },
      { type: "learning_task", key: assessment.taskId, payload: assessment, expectedLocalRevision: 0 },
    ] });
    return { planId: activePlanId,
      reading: { taskId: reading.taskId, href: reading.href, status: reading.status },
      assessment: { taskId: assessment.taskId, href: assessment.href, status: assessment.status } };
  }, { activePlanId: planId, runId: RUN_ID });
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
  const assessmentURL = new URL(task.href, baseURL + "/");
  assessmentURL.searchParams.set("taskId", task.taskId);
  await page.goto(assessmentURL.href, { waitUntil: "domcontentloaded" });
  await page.locator("#question-title").waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    document.querySelector("#question-title")?.textContent.includes("多模态学习台的双通路架构"));
  await page.locator('[data-option-id="a"]').click();
  await waitForAsyncPageCondition(page, async taskId => {
    const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
    const events = await (await getLearningRepository()).events.list();
    return events.some(event => event.type === "attempt" && event.correct === false &&
      event.taskId === taskId && event.gapId === "multimodal-path-conflation");
  }, { arg: task.taskId, label: "initial assessment failure evidence to persist" });

  const seeded = await page.evaluate(async input => {
    const [{ getLearningRepository }, { mapPlanActionToTask }, map] = await Promise.all([
      import("/assets/js/backend/learning-repository.mjs"),
      import("/assets/js/learning-agent/task-orchestrator.mjs"),
      fetch("/content/learning-map.json").then(response => response.json()),
    ]);
    const topic = map.topics.find(item => item.id === "ai-education");
    const competency = topic.competencies.find(item => item.id === "multimodal-learning-architecture");
    const action = mapPlanActionToTask({
      type: "repair", actionId: "h1-pilot-repair-multimodal:" + input.runId,
      planDate: new Date().toISOString().slice(0, 10),
      href: "./review/?competencyId=multimodal-learning-architecture&gapId=multimodal-path-conflation",
      competencyId: competency.id, competencyTitle: competency.title,
      topicId: topic.id, topicTitle: topic.title, estimatedMinutes: 8,
      resourceType: "review", resourceTitle: competency.title,
      resourceLabel: "针对性复习", gapId: "multimodal-path-conflation",
    }, input.planId);
    const repository = await getLearningRepository();
    await repository.commit({ documents: [{ type: "learning_task", key: action.taskId,
      payload: action, expectedLocalRevision: 0 }] });
    const [events, assessmentTask] = await Promise.all([
      repository.events.list(), repository.documents.get("learning_task", input.assessmentTaskId),
    ]);
    const failure = events.find(event => event.type === "attempt" && event.correct === false &&
      event.taskId === input.assessmentTaskId && event.gapId === "multimodal-path-conflation" &&
      (event.competencyIds || []).includes("multimodal-learning-architecture"));
    return { reviewTask: { taskId: action.taskId, href: action.href, status: action.status },
      failure: failure ? { id: failure.id, gapObservationId: failure.gapObservationId,
        gapId: failure.gapId, taskId: failure.taskId, variantId: failure.variantId } : null,
      assessmentStatus: assessmentTask?.payload?.status,
      failureCount: events.filter(event => event.type === "attempt" && event.correct === false &&
        event.taskId === input.assessmentTaskId && event.gapId === "multimodal-path-conflation").length };
  }, { planId, assessmentTaskId: task.taskId, runId: RUN_ID });
  assert.ok(seeded.failure, "the wrong independent assessment answer must create a persisted gap observation");
  assert.equal(seeded.failure.taskId, task.taskId);
  assert.equal(seeded.assessmentStatus, "failed");
  assert.equal(seeded.reviewTask.status, "ready");
  return seeded;
}

async function repairGapWithHintThenIndependentVariant(page, reviewTask) {
  const reviewURL = new URL(reviewTask.href, baseURL + "/");
  reviewURL.searchParams.set("taskId", reviewTask.taskId);
  await page.goto(reviewURL.href, { waitUntil: "domcontentloaded" });
  await page.locator("#question-title").waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    document.querySelector("#question-title")?.textContent.includes("多模态学习台的双通路架构"));
  assert.match(await page.locator("#question-title").innerText(), /多模态学习台的双通路架构/);
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
    const competency = insights.competencyInsights.find(item => item.id === "multimodal-learning-architecture");
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
  assert.ok(assisted.activeGapIds.includes("multimodal-path-conflation"),
    "hint-assisted pass must leave the original gap open");
  assert.equal(assisted.assistedPass?.independent, false);
  assert.equal(assisted.failedReviewTaskEvent, true);

  // Second review: a different registered variant, no hints, and the exact same target gap.
  const assistedVariant = await page.locator("#session-variant").innerText();
  await page.locator("#next-variant").click();
  await page.waitForFunction(previous => {
    const current = document.querySelector("#session-variant")?.textContent || "";
    return current && current !== previous &&
      document.querySelector("#question-title")?.textContent.includes("多模态学习台的双通路架构");
  }, assistedVariant);
  await page.locator('[data-option-id="b"]').click();
  await waitForAsyncPageCondition(page, async () => {
    const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
    const events = await (await getLearningRepository()).events.list();
    return events.some(event => event.type === "assessment_passed" &&
      event.sessionType === "review" && event.gapId === "multimodal-path-conflation" &&
      event.hintsUsed === 0 && event.independent === true);
  }, { label: "independent review pass evidence to persist" });
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
    const competency = insights.competencyInsights.find(item => item.id === "multimodal-learning-architecture");
    const started = events.filter(event => event.type === "review_started" &&
      event.sessionType === "review" && event.gapId === "multimodal-path-conflation");
    const passed = events.find(event => event.type === "assessment_passed" &&
      event.sessionType === "review" && event.gapId === "multimodal-path-conflation" && event.hintsUsed === 0);
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
  assert.ok(!result.activeGapIds.includes("multimodal-path-conflation"), "the precise original gap must be resolved");
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
    await page.clock.install({ time: new Date("2026-11-15T10:00:00+09:00") });

    await openAgent(page);
    const plan = await createGoalAndAcceptPlan(page);
    const tasks = await createPilotTasks(page, plan.activePlanId);
    assert.equal(tasks.reading.status, "ready");
    assert.equal(tasks.assessment.status, "locked",
      "checkpoint task must remain blocked until the prerequisite lesson task is completed");

    await readTask(page, tasks);
    const checkpointFailure = await failCheckpointAndCreateReviewTask(page, tasks.assessment, plan.activePlanId);
    assert.equal(checkpointFailure.failure.gapId, "multimodal-path-conflation");
    assert.ok(checkpointFailure.failure.gapObservationId);
    assert.equal(checkpointFailure.failureCount, 1);

    const review = await repairGapWithHintThenIndependentVariant(page, checkpointFailure.reviewTask);

    // Advance only the isolated browser clock well beyond the evidence date.
    // This is a scheduling simulation, not evidence of real human delayed recall.
    await page.clock.setFixedTime(new Date("2026-12-15T10:00:00+09:00"));
    await page.goto(baseURL + "/progress/", { waitUntil: "domcontentloaded" });
    await page.locator("#hero-tested").waitFor({ state: "visible" });
    await page.locator("#proactive-learning > summary").click();
    await page.locator("#proactive-review-queue").waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const links = [...document.querySelectorAll("#proactive-review-queue a")];
      return links.some(link => {
        const href = new URL(link.href);
        return href.searchParams.get("competencyId") === "multimodal-learning-architecture";
      });
    }, { timeout: 15000 }).catch(async error => {
      const state = await page.evaluate(() => ({
        reviewQueue: document.querySelector("#proactive-review-queue")?.innerText || null,
        tested: document.querySelector("#hero-tested")?.innerText || null,
        gaps: document.querySelector("#gap-list")?.innerText || null,
      }));
      throw new Error("The delayed review queue did not surface the AI Education competency: " +
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
      const competency = insights.competencyInsights.find(item => item.id === "multimodal-learning-architecture");
      const schedule = calculateReviewSchedule({
        competencyId: "multimodal-learning-architecture",
        events: events.filter(event => (event.competencyIds || []).includes("multimodal-learning-architecture")),
        intelligence: competency,
        now: new Date(),
      });
      const documentRows = await repository.documents.list(1000);
      const goal = documentRows.find(row => row.type === "learning_goal" &&
        row.payload?.title?.includes(input.runId.slice(0, 8)));
      if (!goal) throw new Error("Run-scoped learning goal is missing from the local archive.");
      const plans = documentRows.filter(row => row.type === "learning_plan" &&
        row.payload?.linkedGoalIds?.includes(goal.key));
      const acceptedPlan = documentRows.find(row => row.type === "learning_plan" && row.key === input.planId);
      if (!acceptedPlan) throw new Error("The run's accepted learning plan is missing from the local archive.");
      const planIds = new Set([...plans.map(row => row.key), input.planId]);
      const taskRows = documentRows.filter(row => row.type === "learning_task" &&
        (planIds.has(row.payload?.planId) || row.payload?.linkedGoalIds?.includes(goal.key)));
      const taskIds = new Set(taskRows.map(row => row.key));
      const runEvents = events.filter(event => event.goalId === goal.key ||
        planIds.has(event.planId) || planIds.has(event.sessionId) || taskIds.has(event.taskId));
      return {
        goals: 1,
        acceptedPlans: Number(Boolean(acceptedPlan.payload?.acceptedAt || acceptedPlan.payload?.status === "accepted" || acceptedPlan.payload?.status === "superseded")),
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
    }, { reviewEvidence: review.taskEvidence, runId: RUN_ID, planId: plan.activePlanId });
    assert.equal(audit.goals, 1);
    assert.equal(audit.acceptedPlans, 1);
    assert.ok(!audit.activeGapIds.includes("multimodal-path-conflation"),
      "the exact run-scoped identity gap must be resolved; other historical gaps remain independent");
    assert.ok(audit.mastery.evidenceCount >= 1 && audit.mastery.score >= 80,
      "the independent review must update the derived mastery score: " + JSON.stringify(audit.mastery));
    assert.ok(audit.mastery.independentReviewCount >= 1,
      "the spaced-repetition scheduler must count the independent no-hint review");
    assert.ok(audit.schedule.isDue || ["due", "overdue"].includes(audit.schedule.status),
      "a virtual +30-day clock should make the competency due or overdue for delayed review: " +
      JSON.stringify(audit.schedule));
    assert.ok(audit.tasks.some(task => task.taskType === "read" && task.status === "completed"));
    assert.ok(audit.tasks.some(task => task.taskType === "assessment" && task.status === "failed"));
    assert.ok(audit.tasks.some(task => task.taskType === "assessment" && task.status === "completed"));
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
    const localSnapshot = await page.evaluate(async input => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const repository = await getLearningRepository();
      const [documents, events] = await Promise.all([repository.documents.list(2000), repository.events.list()]);
      const goal = documents.find(row => row.type === "learning_goal" && row.payload?.title?.includes(input.runId.slice(0, 8)));
      if (!goal) throw new Error("Unique cloud E2E goal is missing from the local archive.");
      const plans = documents.filter(row => row.type === "learning_plan" &&
        (row.payload?.linkedGoalIds?.includes(goal.key) || row.key === input.planId));
      const planIds = new Set([...plans.map(row => row.key), input.planId]);
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
    }, { runId: RUN_ID, planId: plan.activePlanId });
    assert.ok(localSnapshot.eventCount >= 8, "the learning loop must create a meaningful set of cloud-persisted evidence events");

    // A fresh browser context has an empty IndexedDB. Pull-only restoration proves cross-device durability.
    const secondContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Tokyo" });
    await secondContext.addInitScript(({ url, key, session }) => {
      globalThis.KNOWVERSE_BACKEND_CONFIG = { supabaseUrl: url, publishableKey: key };
      localStorage.setItem("knowverse:supabase-session", JSON.stringify(session));
    }, { url: STAGING_ORIGIN, key: env.N2_SUPABASE_PUBLISHABLE_KEY, session: browserSession });
    const secondPage = await secondContext.newPage();
    await openAgent(secondPage);
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
        .competencyInsights.find(item => item.id === "multimodal-learning-architecture");
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
    assert.ok(restored.initialSync.pulled >= localSnapshot.documentKeys.length,
      "the fresh browser initial sync must pull the complete archive document set; event IDs are checked separately above");
    assert.deepEqual(restored.mastery.activeGapIds, [],
      "the second device must derive the same resolved gap state from cloud events");
    assert.ok(restored.mastery.score >= 80 && restored.mastery.evidenceCount >= 1,
      "the second device must rebuild the updated mastery score from restored evidence: " +
      JSON.stringify(restored.mastery));
    // Read-only Agent tool contracts are covered by verify-ai-agent-learning.mjs.
    // Keep this cloud E2E focused on persistence and second-device restoration;
    // model-provider availability is tested separately and must not mask sync results.
    assert.ok(restored.mastery.evidenceCount >= 1);
    assert.ok(restored.mastery.score >= 80);
  } finally {
    await browser.close();
  }
});
