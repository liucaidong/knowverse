import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";
import { waitForAsyncPageCondition } from "./helpers/wait-for-async-page-condition.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
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
}

async function createGoalAndAcceptPlan(page) {
  await page.locator("#la-goal-title").fill("E2E · ES Promise 七日学习试点");
  await page.locator("#la-goal-description").fill("通过真实页面操作验证课程、挑战、薄弱点、独立复习与延迟复习链路。");
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

test("Chromium desktop: synthetic learner completes goal → plan → lesson → checkpoint → gap repair → delayed scheduling", {
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
    page.on("requestfailed", request => failedRequests.push(request.method() + " " + request.url()));

    // Each run uses a clean, isolated browser profile, local IndexedDB and no Supabase credentials.
    await page.addInitScript(() => {
      globalThis.KNOWVERSE_BACKEND_CONFIG = { supabaseUrl: "", publishableKey: "" };
    });
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

    // Advance only the isolated browser clock to test scheduler behavior without waiting several calendar days.
    // This is a scheduling simulation, not evidence of real human delayed recall.
    await page.clock.setFixedTime(new Date("2026-11-07T10:00:00+09:00"));
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

    const audit = await page.evaluate(async reviewEvidence => {
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
      const taskRows = await repository.documents.list(1000);
      return {
        goals: taskRows.filter(row => row.type === "learning_goal" && row.payload?._deleted !== true).length,
        acceptedPlans: taskRows.filter(row => row.type === "learning_plan" && row.payload?.status === "accepted").length,
        tasks: taskRows.filter(row => row.type === "learning_task" && row.payload?._deleted !== true).map(row => ({
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
        reviewEvidenceIds: reviewEvidence,
        eventCount: events.length,
      };
    }, review.taskEvidence);
    assert.equal(audit.goals, 1);
    assert.equal(audit.acceptedPlans, 1);
    assert.deepEqual(audit.activeGapIds, []);
    assert.ok(audit.schedule.isDue || audit.schedule.status === "due",
      "a virtual +4-day clock should make the competency due for delayed review");
    assert.ok(audit.tasks.some(task => task.taskType === "read" && task.status === "completed"));
    assert.ok(audit.tasks.some(task => task.taskType === "assessment" && task.status === "failed"));
    assert.ok(audit.tasks.some(task => task.taskType === "review" && task.status === "completed"));
    assert.ok(audit.eventCount >= 10);
    assert.deepEqual(errors, [], "no uncaught page or console errors");
    assert.deepEqual(failedRequests, [], "no failed network requests");
    await context.close();
  } finally {
    await browser.close();
  }
});
