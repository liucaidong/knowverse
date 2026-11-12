import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildLearningTutorScene } from "../assets/js/learning-tutor.mjs";
import { createLearningAgentProvider } from "../assets/js/learning-agent/agent-provider.mjs";

const readJSON = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

test("learning tutor builds a bounded current-scene context from canonical registries and evidence", async () => {
  const [learningMap, worksManifest, challengeRegistry] = await Promise.all([
    readJSON("../content/learning-map.json"),
    readJSON("../content/works.json"),
    readJSON("../content/challenges.json"),
  ]);
  const topic = learningMap.topics.find(item => item.id === "promise");
  const work = worksManifest.works.find(item => item.id === "promise-mechanism-quest");
  const at = "2026-11-03T10:00:00.000Z";
  const snapshot = {
    events: [
      {
        id: "attempt-promise-thenable",
        eventSchemaVersion: 3,
        type: "attempt",
        at,
        topicId: "promise",
        challengeId: "promise-mechanism-quest",
        challengeTitle: "Promise 机制挑战",
        stepId: "thenable-adoption",
        stepTitle: "thenable 解析与 Promise 采用",
        competencyIds: ["thenable-adoption"],
        sessionId: "session-promise",
        sessionType: "campaign",
        correct: false,
        hintsUsed: 1,
        gapId: "thenable-get-vs-call",
        answer: "PRIVATE ANSWER MUST NOT LEAVE THE DEVICE",
      },
      {
        id: "attempt-unrelated",
        eventSchemaVersion: 3,
        type: "attempt",
        at,
        topicId: "promise",
        challengeId: "promise-mechanism-quest",
        challengeTitle: "Promise 机制挑战",
        stepId: "chain-error-propagation",
        stepTitle: "链式错误传播",
        competencyIds: ["chain-error-propagation"],
        sessionId: "session-unrelated",
        sessionType: "campaign",
        correct: true,
        hintsUsed: 0,
      },
    ],
  };
  const task = {
    taskId: "private-task-id",
    planId: "private-plan-id",
    taskType: "challenge",
    title: "继续推演 thenable",
    status: "in_progress",
    topicId: "promise",
    competencyId: "thenable-adoption",
    estimatedMinutes: 12,
    evidencePolicy: "required_assessment",
    privateInternalField: "must not be copied",
  };
  const scene = buildLearningTutorScene({
    page: { title: "Promise 机制挑战", path: "/puzzles/worlds/promise-mechanism-quest/" },
    topics: [topic],
    work,
    competencyIds: ["thenable-adoption"],
    task,
    learningMap,
    challengeRegistry,
    snapshot,
    selectedExcerpt: "",
  });

  assert.equal(scene.schemaVersion, 1);
  assert.equal(scene.page.path, "/puzzles/worlds/promise-mechanism-quest");
  assert.equal(scene.work.id, work.id);
  assert.equal(scene.currentTask.title, task.title);
  assert.equal(scene.currentTask.status, "in_progress");
  assert.equal("taskId" in scene.currentTask, false);
  assert.equal("planId" in scene.currentTask, false);
  assert.equal("privateInternalField" in scene.currentTask, false);
  assert.equal(scene.currentChallenge.id, "promise-mechanism-quest");
  assert.ok(scene.currentChallenge.relevantSteps.some(item => item.id === "thenable-adoption"));
  assert.deepEqual(scene.competencies.map(item => item.id), ["thenable-adoption"]);
  assert.equal(scene.competencies[0].status, "weak");
  assert.equal(scene.competencies[0].activeGaps[0].id, "thenable-get-vs-call");
  assert.equal(scene.recentEvidence.length, 1);
  assert.equal(scene.recentEvidence[0].type, "attempt");
  assert.equal("answer" in scene.recentEvidence[0], false);
  assert.equal(JSON.stringify(scene).includes("PRIVATE ANSWER"), false);
  assert.equal(scene.selectedExcerpt, null);
  assert.match(scene.evidenceBoundary, /不能单独证明掌握/);
});

test("learning tutor never invents mastery for an unmapped topic and only includes explicitly selected text", async () => {
  const [learningMap, challengeRegistry] = await Promise.all([
    readJSON("../content/learning-map.json"),
    readJSON("../content/challenges.json"),
  ]);
  const scene = buildLearningTutorScene({
    page: { title: "未映射专题", path: "/knowledge/unmapped/" },
    topics: [{ id: "unmapped", title: "未映射专题", competencies: [] }],
    competencyIds: [],
    learningMap,
    challengeRegistry,
    snapshot: { events: [] },
  });
  assert.deepEqual(scene.competencies, []);
  assert.equal(scene.currentTask, null);
  assert.equal(scene.selectedExcerpt, null);

  const selected = buildLearningTutorScene({
    page: { title: "资料阅读", path: "/knowledge/promise/" },
    topics: [learningMap.topics.find(item => item.id === "promise")],
    competencyIds: ["thenable-adoption"],
    learningMap,
    challengeRegistry,
    snapshot: { events: [] },
    selectedExcerpt: "只由学习者明确选中的摘录",
  });
  assert.equal(selected.selectedExcerpt, "只由学习者明确选中的摘录");
});

test("shared learning integration mounts the tutor from live work and knowledge registries", async () => {
  const integration = await readFile(new URL("../assets/js/learning-integration.mjs", import.meta.url), "utf8");
  const provider = await readFile(new URL("../assets/js/learning-agent/agent-provider.mjs", import.meta.url), "utf8");
  const edge = await readFile(new URL("../supabase/functions/learning-agent/index.ts", import.meta.url), "utf8");
  assert.match(integration, /import \{ mountLearningTutor \} from "\.\/learning-tutor\.mjs"/);
  assert.match(integration, /await mountLearningTutor\(\{/);
  assert.match(integration, /readJSON\("\.\.\/\.\.\/content\/challenges\.json"\)/);
  assert.match(provider, /mode = "agent", tutorMode = "explain"/);
  assert.match(provider, /body: \{ version: 1, message: message\.trim\(\), context, mode, tutorMode \}/);
  assert.match(provider, /const timeoutMs = mode === "tutor" && tutorMode === "practice" \? 135_000 : 70_000/);
  assert.match(edge, /const providerTimeoutMs = isPracticeGeneration \? 120_000 : 60_000/);
  assert.match(edge, /const maxTokens = isPracticeGeneration \? 8192 : 1600/);
  assert.match(edge, /max_tokens: maxTokens/);
  assert.match(edge, /"requestedToolResults", "learningScene"/);
  assert.match(edge, /Never call tools, request more data, propose mutations/);
  assert.match(edge, /For Socratic tutoring, ask exactly one concise question per turn/);
  assert.match(edge, /"socratic"/);
  assert.match(edge, /"practice"/);
  assert.match(edge, /Generate one open-ended, ungraded supplementary exercise/);
  assert.match(edge, /Return reply as a JSON object \(not a JSON-encoded string\)/);
  assert.match(edge, /function validateTutorPracticeExercise/);
  assert.match(edge, /validateTutorPracticeExercise\(tutorOutput\.reply\)/);
  assert.match(edge, /reply: JSON\.stringify\(exercise\)/);
  assert.match(edge, /if \(mode === "tutor"\) \{[\s\S]{0,1200}output = \{ reply: tutorOutput\.reply\.trim\(\), suggestions: \[\], dataRequests: \[\] \}/);
  assert.match(edge, /output = validateModelOutput\(decoded\)/);
  assert.match(edge, /mode === "tutor" && body\.tutorMode !== undefined/);
});

test("provider sends explicit tutor mode through the authenticated Agent endpoint", async () => {
  let request = null;
  const provider = createLearningAgentProvider({
    config: { enabled: true },
    auth: {
      async getSession() { return { access_token: "test-token" }; },
      async request(path, options) {
        request = { path, options };
        return {
          version: 1,
          reply: "先观察 then 属性读取与 ThenableJob 调用之间的边界。",
          suggestions: [],
          dataRequests: [],
        };
      },
    },
  });
  const response = await provider.ask({
    message: "给我一个分级提示",
    mode: "tutor",
    tutorMode: "hint",
    context: { learningScene: { schemaVersion: 1 }, recentConversation: [] },
  });
  assert.equal(response.reply, "先观察 then 属性读取与 ThenableJob 调用之间的边界。");
  assert.equal(request.path, "/functions/v1/learning-agent");
  assert.equal(request.options.body.mode, "tutor");
  assert.equal(request.options.body.tutorMode, "hint");
  const guided = await provider.ask({
    message: "继续引导我推理", mode: "tutor", tutorMode: "socratic",
    context: { learningScene: { schemaVersion: 1 }, recentConversation: [] },
  });
  assert.equal(guided.reply, "先观察 then 属性读取与 ThenableJob 调用之间的边界。");
  assert.equal(request.options.body.tutorMode, "socratic");
  const practice = await provider.ask({
    message: "为当前 Gap 生成一份补充练习草案",
    mode: "tutor",
    tutorMode: "practice",
    context: { learningScene: { schemaVersion: 1, practiceGeneration: {} }, recentConversation: [] },
  });
  assert.equal(practice.reply, "先观察 then 属性读取与 ThenableJob 调用之间的边界。");
  assert.equal(request.options.body.tutorMode, "practice");
  await assert.rejects(() => provider.ask({
    message: "invalid mode",
    mode: "tutor",
    tutorMode: "mutate",
    context: {},
  }), /不支持的学习导师交互模式/);
});
