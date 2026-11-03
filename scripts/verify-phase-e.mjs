import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { beforeEach } from "node:test";
import { deleteLocalDatabaseForTests } from "../assets/js/backend/local-event-store.mjs";
import { getLearningRepository, resetLearningRepositoryForTests } from "../assets/js/backend/learning-repository.mjs";
import { deriveLearningInsights } from "../assets/js/learning-progress.mjs";
import { createLearnerProfileStore, deriveLearnerProfile } from "../assets/js/learning-agent/learner-profile.mjs";
import { createLearningGoalManager } from "../assets/js/learning-agent/goal-manager.mjs";
import { createLearningPlanManager } from "../assets/js/learning-agent/plan-manager.mjs";
import { createLearningTaskOrchestrator, mapPlanActionToTask, LEARNING_TASK_TRANSITIONS } from "../assets/js/learning-agent/task-orchestrator.mjs";
import { createAgentSessionStore } from "../assets/js/learning-agent/agent-session-store.mjs";
import { AGENT_TOOL_SCHEMAS, executeAgentTool, validateAgentToolInput } from "../assets/js/learning-agent/agent-tools.mjs";
import { createLearningAgentProvider, validateAgentProviderResponse } from "../assets/js/learning-agent/agent-provider.mjs";
import { answerWithLocalRules } from "../assets/js/learning-agent/local-agent.mjs";

const NOW = new Date();
const nowIso = () => NOW.toISOString();
const dateKey = value => {
  const date = new Date(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")].join("-");
};
const addDays = (value, days) => {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
};
const readJSON = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

beforeEach(async () => {
  resetLearningRepositoryForTests();
  await deleteLocalDatabaseForTests();
});

async function setup() {
  const [learningMap, challengeRegistry, worksManifest, checkpointRegistry] = await Promise.all([
    readJSON("../content/learning-map.json"),
    readJSON("../content/challenges.json"),
    readJSON("../content/works.json"),
    readJSON("../content/learning-checkpoints.json"),
  ]);
  const repository = await getLearningRepository();
  const profileStore = createLearnerProfileStore({ repository });
  const goalManager = createLearningGoalManager({ repository, learningMap });
  const taskOrchestrator = createLearningTaskOrchestrator({ repository });
  const planManager = createLearningPlanManager({ repository, taskOrchestrator });
  const context = {
    repository, profileStore, goalManager, taskOrchestrator, planManager,
    learningMap, challengeRegistry, worksManifest, checkpointRegistry,
    now: NOW,
    profilePreferences: {
      dailyMinutes: 15, weeklyDays: 5, preferredTopicIds: [],
      learningModes: ["read", "challenge"],
    },
  };
  return { ...context, context };
}

function learningEvent(id, type, at, fields = {}) {
  return {
    id, type, at,
    topicId: "promise",
    challengeId: "test",
    challengeTitle: "Phase E test",
    stepId: "thenable-adoption",
    stepTitle: "Thenable",
    competencyIds: ["thenable-adoption"],
    sessionId: "test-session",
    sessionType: "checkpoint",
    ...fields,
  };
}

test("learner preferences persist as a typed Repository document and are normalized", async () => {
  const s = await setup();
  const saved = await s.profileStore.savePreferences({
    dailyMinutes: 500, weeklyDays: 0,
    preferredTopicIds: ["promise", "promise", "unknown"],
    learningModes: ["read", "unknown", "challenge"],
    goal: "  Learn Promise  ",
    targetAt: "2026-12-31T00:00:00Z",
  });
  assert.equal(saved.dailyMinutes, 240);
  assert.equal(saved.weeklyDays, 1);
  assert.deepEqual(saved.preferredTopicIds, ["promise", "unknown"]);
  assert.deepEqual(saved.learningModes, ["read", "challenge"]);
  assert.equal(saved.goal, "Learn Promise");
  const persisted = await s.repository.documents.get("learner_profile", "preferences");
  assert.equal(persisted.payload.dailyMinutes, 240);
  assert.ok(persisted.localRevision > 0);
  assert.equal((await s.repository.events.list()).filter(item => item.type === "learner_preferences_updated").length, 1);
});

test("learner profile derives behavior and evidence refs without treating browsing or AI as mastery", async () => {
  const s = await setup();
  const at = nowIso();
  await s.repository.events.append([
    learningEvent("page-view", "page_viewed", new Date(NOW.getTime() - 10 * 86_400_000).toISOString()),
    learningEvent("agent-message", "agent_message_created", new Date(NOW.getTime() - 8 * 86_400_000).toISOString()),
    learningEvent("wrong", "attempt", new Date(NOW.getTime() - 2 * 86_400_000).toISOString(), {
      correct: false, gapId: "thenable-get-vs-call", hintsUsed: 1,
    }),
  ]);
  const profile = deriveLearnerProfile({
    learningMap: s.learningMap,
    challengeRegistry: s.challengeRegistry,
    snapshot: { events: await s.repository.events.list() },
    preferences: await s.profileStore.loadPreferences(),
    goals: [],
    now: NOW,
  });
  const unknownState = profile.mastery.weakCompetencies.find(item => item.id === "thenable-adoption");
  assert.ok(unknownState);
  assert.equal(unknownState.masteryScore, null);
  assert.equal(profile.mastery.summary.testedCount, 0);
  assert.equal(profile.behavior.attempts, 1);
  assert.equal(profile.behavior.hintAssistedAttempts, 1);
  assert.equal(profile.behavior.learningDaysLast7, 1);
  assert.equal(profile.behavior.learningDaysLast30, 1);
  assert.deepEqual(profile.growth.recentEvents.map(item => item.eventId), ["wrong"]);
  assert.ok(profile.mastery.activeGaps.some(item => item.id === "thenable-get-vs-call"));
  assert.ok(profile.evidenceRefs.gaps.includes("wrong"));
});

test("goal manager validates existing graph IDs and legal lifecycle transitions", async () => {
  const s = await setup();
  await assert.rejects(
    () => s.goalManager.create({ title: "非法专题", topicIds: ["not-a-topic"] }),
    /至少关联/,
  );
  const goal = await s.goalManager.create({
    title: "精通 ES Promise",
    description: "掌握 Promise 解析和任务调度",
    topicIds: ["promise"],
    priority: 5,
    dailyMinutes: 25,
    acceptanceCriteria: "所有关联能力达到稳定掌握",
  });
  assert.equal(goal.status, "active");
  const paused = await s.goalManager.pause(goal.goalId);
  assert.equal(paused.status, "paused");
  const resumed = await s.goalManager.resume(goal.goalId);
  assert.equal(resumed.status, "active");
  await assert.rejects(() => s.goalManager.complete(goal.goalId, { goals: [] }), /尚未全部达到稳定掌握/);
  assert.equal((await s.goalManager.get(goal.goalId)).status, "active");
  assert.ok((await s.repository.events.list()).some(item => item.type === "learning_goal_paused"));
});

test("multi-goal planner prioritizes linked competencies and builds a 14-day budgeted schedule", async () => {
  const s = await setup();
  const goal = await s.goalManager.create({
    title: "Promise 优先目标", topicIds: ["promise"], priority: 5, dailyMinutes: 15,
  });
  await s.profileStore.savePreferences({
    dailyMinutes: 15, weeklyDays: 5, preferredTopicIds: ["promise"],
    learningModes: ["read", "challenge"],
  });
  s.context.profilePreferences = await s.profileStore.loadPreferences();
  const plan = await s.planManager.generate(s.context, "two-week test", { horizonDays: 14 });
  assert.equal(plan.horizonDays, 14);
  assert.equal(plan.schedule.length, 10);
  assert.equal(plan.activeStudyDays, 10);
  assert.ok(plan.linkedGoalIds.includes(goal.goalId));
  assert.ok(plan.actions.some(item => item.linkedGoalIds.includes(goal.goalId)));
  assert.ok(plan.actions.length > 0);
  assert.ok(plan.plannedMinutes <= plan.totalBudgetMinutes);
  assert.ok(plan.schedule.every(day => day.plannedMinutes <= day.dailyBudgetMinutes));
  assert.ok(plan.actions.every(item => item.planDate));
  assert.ok(plan.actions.some(item => item.planDate > dateKey(NOW)), "horizon must distribute eligible work beyond day one");
  const current = await s.planManager.current();
  assert.equal(current.proposal.planId, plan.planId);
  assert.equal(current.active, null);
});

test("plan history is immutable, a new proposal supersedes only the previous proposal, and acceptance is explicit", async () => {
  const s = await setup();
  await s.profileStore.savePreferences({
    dailyMinutes: 15, weeklyDays: 5, preferredTopicIds: [],
    learningModes: ["read", "challenge"],
  });
  s.context.profilePreferences = await s.profileStore.loadPreferences();
  const first = await s.planManager.generate(s.context, "first proposal", { horizonDays: 14 });
  const second = await s.planManager.generate(s.context, "second proposal", { horizonDays: 1 });
  assert.equal((await s.planManager.get(first.planId)).status, "superseded");
  assert.equal((await s.planManager.get(second.planId)).status, "proposed");
  const accepted = await s.planManager.accept(second.planId);
  assert.equal(accepted.status, "accepted");
  assert.ok(accepted.tasks.length > 0);
  const current = await s.planManager.current();
  assert.equal(current.active.planId, second.planId);
  assert.equal(current.proposal, null);
  assert.equal((await s.planManager.accept(second.planId)).idempotent, true);
  await assert.rejects(() => s.planManager.accept(first.planId), /只有待接受/);
  assert.ok((await s.planManager.history()).length >= 2);
});

test("task state machine rejects illegal transitions and read completion never becomes mastery evidence", async () => {
  const s = await setup();
  const action = {
    actionId: "read-foundation", type: "learn",
    title: "建立 Promise 基础", topicId: "promise", topicTitle: "Promise",
    competencyId: "thenable-adoption", competencyTitle: "Thenable adoption",
    estimatedMinutes: 12, planDate: dateKey(NOW),
    href: "./knowledge/", resourceType: "lesson", variantId: "lesson:thenable-adoption",
  };
  const task = mapPlanActionToTask(action, "manual-plan");
  await s.repository.commit({
    documents: [{ type: "learning_task", key: task.taskId, payload: task, expectedLocalRevision: 0 }],
  });
  await assert.rejects(() => s.taskOrchestrator.complete(task.taskId), /非法任务状态转换/);
  const started = await s.taskOrchestrator.start(task.taskId, { at: nowIso() });
  assert.equal(started.status, "in_progress");
  const paused = await s.taskOrchestrator.pause(task.taskId, { at: new Date(NOW.getTime() + 60_000).toISOString() });
  assert.equal(paused.status, "paused");
  const resumed = await s.taskOrchestrator.transition(task.taskId, "in_progress", {
    at: new Date(NOW.getTime() + 120_000).toISOString(),
  });
  assert.equal(resumed.status, "in_progress");
  const completed = await s.taskOrchestrator.complete(task.taskId, {
    at: new Date(NOW.getTime() + 180_000).toISOString(),
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.evidenceEventIds.length, 0);
  assert.equal(completed.timeSpentSeconds, 120);
  const insights = deriveLearningInsights(s.learningMap, s.challengeRegistry,
    { events: await s.repository.events.list() }, NOW);
  assert.equal(insights.competencyInsights.find(item => item.id === "thenable-adoption").evidenceCount, 0);
  await assert.rejects(() => s.taskOrchestrator.start(task.taskId), /非法任务状态转换/);
  assert.deepEqual([...LEARNING_TASK_TRANSITIONS.completed], []);
});

test("future-dated tasks stay locked until their scheduled date and then unlock", async () => {
  const s = await setup();
  const tomorrow = dateKey(addDays(NOW, 1));
  const task = mapPlanActionToTask({
    actionId: "tomorrow-read", type: "learn", title: "明天学习",
    topicId: "promise", competencyId: "thenable-adoption",
    estimatedMinutes: 12, planDate: tomorrow,
    href: "./knowledge/", resourceType: "lesson",
  }, "future-plan");
  assert.equal(task.status, "locked");
  await s.repository.commit({
    documents: [{ type: "learning_task", key: task.taskId, payload: task, expectedLocalRevision: 0 }],
  });
  await assert.rejects(() => s.taskOrchestrator.start(task.taskId), /非法任务状态转换/);
  await assert.rejects(() => s.taskOrchestrator.transition(task.taskId, "ready", { at: nowIso() }), /尚未到计划日期/);
  const ready = await s.taskOrchestrator.transition(task.taskId, "ready", {
    at: addDays(NOW, 1).toISOString(),
  });
  assert.equal(ready.status, "ready");
});

test("review task requires an exact no-hint causal chain for every unresolved gap observation", async () => {
  const s = await setup();
  const failure = learningEvent("failure-1", "attempt", new Date(NOW.getTime() - 3600_000).toISOString(), {
    correct: false, gapId: "thenable-get-vs-call", variantId: "old-variant",
    sessionType: "campaign", gapObservationId: "failure-1",
  });
  await s.repository.events.append([failure]);
  const task = mapPlanActionToTask({
    actionId: "review-gap", type: "repair", title: "纠正 Thenable", topicId: "promise",
    competencyId: "thenable-adoption", estimatedMinutes: 10, planDate: dateKey(NOW),
    gapId: "thenable-get-vs-call", href: "./review/", resourceType: "review",
    variantId: "old-variant",
  }, "review-plan");
  await s.repository.commit({
    documents: [{ type: "learning_task", key: task.taskId, payload: task, expectedLocalRevision: 0 }],
  });
  const startAt = new Date(NOW.getTime() + 1000).toISOString();
  await s.taskOrchestrator.start(task.taskId, { at: startAt });
  const validStart = {
    ...learningEvent("review-start", "review_started", new Date(NOW.getTime() + 2000).toISOString(), {
      taskId: task.taskId, sessionId: "review-session", sessionType: "review", gapId: "thenable-get-vs-call",
      variantId: "new-variant", targetGapEventIds: ["failure-1"],
      causationEventIds: ["failure-1"],
    }),
  };
  const validAttempt = {
    ...learningEvent("review-attempt", "attempt", new Date(NOW.getTime() + 3000).toISOString(), {
      taskId: task.taskId, sessionId: "review-session", sessionType: "review", gapId: "thenable-get-vs-call",
      variantId: "new-variant", correct: true, hintsUsed: 0,
      targetGapEventIds: ["failure-1"], causationEventIds: ["review-start"],
    }),
  };
  const validPass = {
    ...learningEvent("review-pass", "assessment_passed", new Date(NOW.getTime() + 4000).toISOString(), {
      taskId: task.taskId, sessionId: "review-session", sessionType: "review", gapId: "thenable-get-vs-call",
      variantId: "new-variant", hintsUsed: 0,
      targetGapEventIds: ["failure-1"], causationEventIds: ["review-start", "review-attempt"],
    }),
  };
  // A plausible-looking answer without the full causal path is not evidence.
  await s.repository.events.append([{
    ...validPass, id: "fake-pass", causationEventIds: ["review-start"],
  }]);
  await assert.rejects(() => s.taskOrchestrator.complete(task.taskId, {
    at: new Date(NOW.getTime() + 5000).toISOString(),
  }), /所有未解决错误观察/);
  await s.repository.events.append([validStart, validAttempt, validPass]);
  const completed = await s.taskOrchestrator.complete(task.taskId, {
    at: new Date(NOW.getTime() + 6000).toISOString(),
  });
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.evidenceEventIds, ["review-pass"]);
});

test("Agent tool schemas reject unknown data and models cannot mutate learner state", async () => {
  const s = await setup();
  assert.equal(Object.keys(AGENT_TOOL_SCHEMAS).length >= 16, true);
  assert.throws(() => validateAgentToolInput("create_learning_goal", {
    title: "Promise", topicIds: ["promise"], admin: true,
  }), /不是允许的字段/);
  assert.doesNotThrow(() => validateAgentToolInput("create_learning_goal", {
    title: "Promise", topicIds: ["promise"],
  }));
  await assert.rejects(() => executeAgentTool("create_learning_goal", {
    title: "Model tries write", topicIds: ["promise"],
  }, s.context, { origin: "model", confirmed: true }), /只能提出建议/);
  const goal = await executeAgentTool("create_learning_goal", {
    title: "Learner confirms", topicIds: ["promise"],
  }, s.context, { origin: "learner", confirmed: true });
  assert.equal(goal.status, "active");
  const profile = await executeAgentTool("get_learner_profile", {}, s.context, {
    origin: "model", confirmed: false,
  });
  assert.ok(profile.mastery);
});

test("Agent session messages are individually versioned documents and append-only", async () => {
  const s = await setup();
  const store = createAgentSessionStore({
    repository: s.repository,
    clock: () => new Date("2026-11-03T00:00:00.000Z"),
  });
  const session = await store.latestSession();
  await store.appendMessage(session.sessionId, "user", "请帮我规划 Promise");
  await store.appendMessage(session.sessionId, "assistant", "我会先检查你的掌握证据。", { mode: "rules" });
  const messages = await store.listMessages(session.sessionId);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map(item => item.role), ["user", "assistant"]);
  assert.deepEqual(messages.map(item => item.sequence), [1, 2]);
  assert.equal(messages[0].createdAt, messages[1].createdAt,
    "the ordering test intentionally exercises an identical timestamp");
  const documents = await s.repository.documents.list(100);
  assert.equal(documents.filter(item => item.type === "learning_agent_message").length, 2);
  assert.ok(documents.some(item => item.type === "learning_agent_session"));
});

test("AI response is validated as a JSON tool proposal and never executes automatically", async () => {
  const valid = validateAgentProviderResponse({
    reply: "应优先处理现有薄弱点。",
    suggestions: [{
      toolName: "generate_learning_plan",
      input: { reason: "根据用户目标重新规划", horizonDays: 14 },
      label: "生成 14 天计划",
    }],
    dataRequests: [{
      toolName: "get_learning_history",
      input: { limit: 20 },
    }],
  });
  assert.equal(valid.suggestions[0].input.horizonDays, 14);
  assert.equal(valid.dataRequests[0].toolName, "get_learning_history");
  assert.throws(() => validateAgentProviderResponse({
    reply: "ready", suggestions: [{ toolName: "drop_database", input: {} }],
  }), /不是允许的工具提案/);
  assert.throws(() => validateAgentProviderResponse({
    reply: "ready", dataRequests: [{ toolName: "create_learning_goal", input: { title: "x" } }],
  }), /不是允许的只读工具/);
  assert.throws(() => validateAgentProviderResponse({
    reply: "ready", suggestions: [{
      toolName: "create_learning_goal",
      input: { title: "x", topicIds: ["promise"], root: true },
    }],
  }), /不是允许的字段/);
});

test("Phase E navigation and database migration remain additive and use existing CAS archive", async () => {
  const [routes, navigation, migration, localStore] = await Promise.all([
    readFile(new URL("../content/routes.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../content/navigation.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../supabase/migrations/20261102165337_phase_e_learning_documents.sql", import.meta.url), "utf8"),
    readFile(new URL("../assets/js/backend/local-event-store.mjs", import.meta.url), "utf8"),
  ]);
  assert.ok(routes.routes.some(route => route.id === "learning.agent" && route.path === "./agent/"));
  const start = navigation.groups.find(group => group.id === "start");
  assert.ok(start.activeRouteIds.includes("learning.agent"));
  assert.equal(navigation.groups.length, 4);
  assert.deepEqual(navigation.groups.map(group => group.id), ["start","knowledge","experience","progress"]);
  for (const type of ["learner_profile", "learning_goal", "learning_plan", "learning_plan_head",
    "learning_task", "learning_agent_session", "learning_agent_message"]) {
    assert.ok(migration.includes(type));
    assert.ok(localStore.includes('"' + type + '"'));
  }
  assert.match(migration, /security invoker/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /private\.is_authorized_user/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /payload_hash = v_payload_hash/i);
  assert.doesNotMatch(migration, /drop table|truncate|delete from public\./i);
});


test("explicit task dependencies lock downstream work until the prerequisite task finishes", async () => {
  const s = await setup();
  const first = mapPlanActionToTask({
    actionId: "prerequisite", type: "learn", title: "先修阅读",
    topicId: "promise", competencyId: "thenable-adoption",
    estimatedMinutes: 8, planDate: dateKey(NOW), href: "./knowledge/",
    resourceType: "lesson",
  }, "dependency-plan");
  const second = mapPlanActionToTask({
    actionId: "dependent", type: "learn", title: "后续练习",
    topicId: "promise", competencyId: "promise-chaining",
    estimatedMinutes: 8, planDate: dateKey(NOW), href: "./knowledge/",
    resourceType: "lesson",
  }, "dependency-plan", { dependsOnTaskIds: [first.taskId] });
  await s.repository.commit({
    documents: [
      { type: "learning_task", key: first.taskId, payload: first, expectedLocalRevision: 0 },
      { type: "learning_task", key: second.taskId, payload: second, expectedLocalRevision: 0 },
    ],
  });
  assert.equal(second.status, "locked");
  await assert.rejects(() => s.taskOrchestrator.start(second.taskId), /非法任务状态转换/);
  await s.taskOrchestrator.start(first.taskId);
  await s.taskOrchestrator.complete(first.taskId);
  const unlocked = await s.taskOrchestrator.refreshUnlocks("dependency-plan");
  assert.equal(unlocked.length, 1);
  assert.equal(unlocked[0].taskId, second.taskId);
  assert.equal((await s.taskOrchestrator.get(second.taskId)).status, "ready");
});


test("Agent provider uses only the authenticated Edge Function and preserves typed failures", async () => {
  let requestedPath = null;
  let requestOptions = null;
  const provider = createLearningAgentProvider({
    config: { enabled: true },
    auth: {
      async getSession() { return { access_token: "test-user-token" }; },
      async request(path, options) {
        requestedPath = path;
        requestOptions = options;
        return { version: 1, reply: "基于真实学习状态的回复。", suggestions: [] };
      },
    },
  });
  const response = await provider.ask({
    message: "解释当前计划",
    context: { goals: [], mastery: { stableCount: 1 } },
  });
  assert.equal(response.reply, "基于真实学习状态的回复。");
  assert.equal(requestedPath, "/functions/v1/learning-agent");
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.body.version, 1);
  assert.equal(requestOptions.body.message, "解释当前计划");
  assert.equal(provider.configured, true);

  const signedOut = createLearningAgentProvider({
    config: { enabled: true },
    auth: { async getSession() { return null; }, async request() { throw new Error("must not be called"); } },
  });
  await assert.rejects(() => signedOut.ask({
    message: "读取画像", context: {},
  }), error => error.code === "AI_AUTH_REQUIRED");

  const quotaProvider = createLearningAgentProvider({
    config: { enabled: true },
    auth: {
      async getSession() { return { access_token: "test-user-token" }; },
      async request() {
        const error = new Error("quota exceeded");
        error.code = "AI_PROVIDER_QUOTA_EXCEEDED";
        throw error;
      },
    },
  });
  await assert.rejects(() => quotaProvider.ask({
    message: "规划下一步", context: {},
  }), error => error.code === "AI_PROVIDER_QUOTA_EXCEEDED");
});


test("plan acceptance preserves explicit action dependency links in persisted task documents", async () => {
  const s = await setup();
  const plan = {
    planId: "dependency-acceptance-plan",
    version: 1,
    date: dateKey(NOW),
    generatedAt: nowIso(),
    status: "proposed",
    reason: "dependency test",
    headline: "先修依赖测试",
    dailyMinutes: 25,
    totalBudgetMinutes: 25,
    plannedMinutes: 16,
    horizonDays: 1,
    activeStudyDays: 1,
    actions: [
      {
        actionId: "foundation",
        type: "learn",
        title: "先修知识阅读",
        topicId: "promise",
        topicTitle: "Promise",
        competencyId: "thenable-adoption",
        competencyTitle: "Thenable adoption",
        estimatedMinutes: 8,
        planDate: dateKey(NOW),
        href: "./knowledge/",
        resourceType: "lesson",
      },
      {
        actionId: "advanced",
        type: "learn",
        title: "后续知识阅读",
        topicId: "promise",
        topicTitle: "Promise",
        competencyId: "promise-chaining",
        competencyTitle: "Promise chaining",
        estimatedMinutes: 8,
        planDate: dateKey(NOW),
        href: "./knowledge/",
        resourceType: "lesson",
        dependsOnActionIds: ["foundation"],
      },
    ],
  };
  await s.repository.commit({
    documents: [
      { type: "learning_plan", key: plan.planId, payload: plan, expectedLocalRevision: 0 },
      {
        type: "learning_plan_head", key: "current",
        payload: { activePlanId: null, proposedPlanId: plan.planId, version: 1 },
        expectedLocalRevision: 0,
      },
    ],
  });
  const accepted = await s.planManager.accept(plan.planId);
  assert.equal(accepted.tasks.length, 2);
  assert.equal(accepted.tasks[0].status, "ready");
  assert.equal(accepted.tasks[1].status, "locked");
  assert.deepEqual(accepted.tasks[1].dependsOnTaskIds, [accepted.tasks[0].taskId]);
});

test("local Agent and read-only tools use the same proactive projection for next action and review queue", async () => {
  const s = await setup();
  const projection = {
    summary: { dueCount: 1, highRiskCount: 1, activeGapCount: 1 },
    nextBestActions: [{
      type: "targeted-review", title: "纠正 Thenable 薄弱点", estimatedMinutes: 12,
      reasons: ["存在未解决的 gap", "关联当前目标"], expectedOutcome: "独立验证",
      deferImpact: "继续阻塞下游", confidence: "medium",
      href: "./review/?competencyId=thenable-adoption&gapId=thenable-get-vs-call",
      taskId: "proactive-review:test",
    }],
    schedules: [{
      competencyId: "thenable-adoption", competencyTitle: "Thenable adoption",
      status: "relearning", isDue: true, dueAt: NOW.toISOString(),
      overdueDays: 0, confidence: "medium", evidenceRefs: ["wrong"],
    }],
    risks: [{
      competencyId: "thenable-adoption", level: "high",
      reasons: ["存在未解决的薄弱点"], score: 64,
    }],
    diagnostics: [{
      id: "learning-stagnation", title: "有效学习出现停滞",
      reason: "距今 10 天", impact: "目标缺少新证据", recommendation: "先进行一次复习",
      evidenceRefs: ["wrong"],
    }],
    goalForecasts: [],
  };
  s.context.proactiveProjection = projection;
  const answer = await answerWithLocalRules("下一步应该学习什么？", s.context);
  assert.match(answer.reply, /纠正 Thenable 薄弱点/);
  assert.match(answer.reply, /继续阻塞下游/);
  const next = await executeAgentTool("get_next_learning_action", {}, s.context);
  assert.equal(next.taskId, "proactive-review:test");
  const reviews = await executeAgentTool("get_review_recommendations", { limit: 5 }, s.context);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].risk, "high");
  assert.deepEqual(reviews[0].riskReasons, ["存在未解决的薄弱点"]);
});
