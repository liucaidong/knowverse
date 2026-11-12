import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseLearningPracticeCandidateReply } from "../assets/js/learning-practice-candidates.mjs";
import { validateLearningPracticeQualityCandidate } from "../assets/js/learning-practice-quality-validator.mjs";
import { validateAgentProviderResponse } from "../assets/js/learning-agent/agent-provider.mjs";

const envText = await readFile(new URL("../.env.n2.local", import.meta.url), "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/).filter(line => line && !line.trimStart().startsWith("#") && line.includes("="))
  .map(line => { const index = line.indexOf("="); return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")]; }));
const projectUrl = env.N2_SUPABASE_URL?.replace(/\/$/, "");
assert.equal(projectUrl, "https://ypthoicwrfsblaidllyy.supabase.co", "Refusing to call any non-staging Supabase project");
for (const key of ["N2_SUPABASE_PUBLISHABLE_KEY", "N2_SYNC_A_EMAIL", "N2_SYNC_A_PASSWORD"]) {
  assert.ok(env[key], `Missing local setting ${key}`);
}

for (const functionName of ["learning-agent", "practice-quality-review"]) {
  const unauthenticated = await fetch(projectUrl + "/functions/v1/" + functionName, {
    method: "POST",
    headers: { apikey: env.N2_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(unauthenticated.status, 401,
    `${functionName} must reject requests without a user JWT (received HTTP ${unauthenticated.status})`);
}
console.log("PASS: both deployed Edge Functions reject unauthenticated requests (HTTP 401).");

const authResponse = await fetch(projectUrl + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { apikey: env.N2_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: env.N2_SYNC_A_EMAIL, password: env.N2_SYNC_A_PASSWORD }),
});
const session = await authResponse.json();
assert.ok(authResponse.ok && session.access_token, "Staging Account A Auth login failed");

const reviewerHistoryResponse = await fetch(projectUrl + "/functions/v1/practice-quality-review", {
  method: "POST",
  headers: {
    apikey: env.N2_SUPABASE_PUBLISHABLE_KEY,
    Authorization: "Bearer " + session.access_token,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ version: 1, action: "history", candidateId: "n2-probe-candidate" }),
});
const reviewerHistory = await reviewerHistoryResponse.json().catch(() => ({}));
assert.equal(reviewerHistoryResponse.status, 200,
  `Authenticated Reviewer history read failed: HTTP ${reviewerHistoryResponse.status} (${reviewerHistory?.error?.code || "unknown"})`);
assert.deepEqual(reviewerHistory.records, [], "Synthetic probe must not create or mutate candidate records");
console.log("PASS: authenticated Reviewer history read succeeds without creating candidate records.");

const response = await fetch(projectUrl + "/functions/v1/learning-agent", {
  method: "POST",
  headers: {
    apikey: env.N2_SUPABASE_PUBLISHABLE_KEY,
    Authorization: "Bearer " + session.access_token,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    version: 1,
    mode: "tutor",
    tutorMode: "explain",
    message: "请用简洁中文解释：为什么模型返回 function_call 不代表工具已经执行？",
    context: {
      goals: [], mastery: [], weakPoints: [], competencyStates: [], activePlan: null,
      recentConversation: [], requestedToolResults: [],
      learningScene: {
        topicId: "ai-agents",
        topicTitle: "AI Agent · 系统工程",
        lessonTitle: "工具调用闭环与 MCP 协议边界",
        competencyId: "agent-tool-execution-contract",
        competencyTitle: "工具调用与 MCP 执行契约",
        unresolvedGaps: [],
        selectedExcerpt: "模型返回 function_call 只是调用请求，应用必须校验、授权并执行工具，再回传结果。",
      },
    },
  }),
});
const result = await response.json().catch(() => ({}));
if (response.status === 503 && result?.error?.code === "AI_PROVIDER_NOT_CONFIGURED") {
  console.error("BLOCKED: learning-agent is deployed and authenticated, but AI_PROVIDER_API_KEY / AI_PROVIDER_MODEL are not configured in staging.");
  process.exitCode = 2;
} else {
  assert.equal(response.status, 200, `Learning Agent returned HTTP ${response.status}: ${result?.error?.code || "unknown_error"}`);
  assert.equal(result.version, 1);
  assert.ok(typeof result.reply === "string" && result.reply.trim());
  assert.deepEqual(result.suggestions, [], "Tutor mode must never return mutation suggestions");
  assert.deepEqual(result.dataRequests, [], "Tutor mode must never request data tools");
  console.log("PASS: real staging Auth + Learning Agent provider call; Tutor output is text-only and contains no tool mutations.");
  console.log("Reply excerpt:", result.reply.slice(0, 320).replace(/\s+/g, " "));
}

async function callAgent(body, label) {
  const response = await fetch(projectUrl + "/functions/v1/learning-agent", {
    method: "POST",
    headers: {
      apikey: env.N2_SUPABASE_PUBLISHABLE_KEY,
      Authorization: "Bearer " + session.access_token,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(
      body.mode === "tutor" && body.tutorMode === "practice" ? 135_000 : 70_000,
    ),
    body: JSON.stringify({ version: 1, ...body }),
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, 200,
    label + " returned HTTP " + response.status + ": " + JSON.stringify(data?.error || { code: "unknown_error" }));
  assert.equal(data.version, 1);
  assert.ok(typeof data.reply === "string" && data.reply.trim());
  return data;
}

const [learningMap, assessmentRegistry] = await Promise.all([
  readFile(new URL("../content/learning-map.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../content/review-assessments.json", import.meta.url), "utf8").then(JSON.parse),
]);
const sourceIds = ["review-thenable-job-timing-a", "review-thenable-job-timing-b"];
const sourceVariants = assessmentRegistry.assessments.filter(item => sourceIds.includes(item.id));
assert.equal(sourceVariants.length, 2, "The practice scene must resolve two canonical source variants.");
const officialSources = sourceVariants.map(item => ({
  id: item.id,
  title: item.title,
  prompt: item.prompt,
  code: item.code || "",
  options: (item.options || []).map(option => ({ id: option.id, label: option.label })),
  answer: item.answer,
  explanation: item.explanation || "",
}));
const practiceContext = {
  competencyId: "thenable-adoption",
  competencyTitle: "thenable 解析与 Promise 采用",
  topicId: "promise",
  topicTitle: "JavaScript Promise",
  gapId: "thenable-job-timing",
  gapLabel: "ThenableJob 的执行边界混淆",
  registry: assessmentRegistry,
  allowedSourceVariantIds: sourceIds,
  recentlyUsedVariantIds: [],
  existingCandidates: [],
};
const learningScene = {
  page: { title: "针对性复习工作台", path: "/review/" },
  topics: [{ id: "promise", title: "JavaScript Promise" }],
  competencies: [{ id: "thenable-adoption", title: "thenable 解析与 Promise 采用", topicId: "promise" }],
  gaps: [{ id: "thenable-job-timing", label: "ThenableJob 的执行边界混淆", competencyId: "thenable-adoption" }],
  practiceGeneration: {
    instruction: "仅生成一个开放式、无评分的补充练习。必须准确引用下面两个正式题目 ID。",
    officialSources,
    recentlyUsedVariantIds: [],
    schemaVersion: 1,
  },
};
const tutorContext = { learningScene, recentConversation: [] };

const practice = await callAgent({
  mode: "tutor",
  tutorMode: "practice",
  message: [
    "请为当前仍未解决的 Gap 生成一份额外的开放式练习草案。",
    "新场景请围绕两个 ThenableJob 与一个插入其间的 queueMicrotask，要求推导完整输出顺序。",
    "所有代码标识符必须在题目代码中定义；提示必须引用真实存在的变量或任务标签。",
    "题目必须改变场景和推理需求，不得照抄来源；只返回系统要求的纯 JSON 字符串。",
  ].join("\n"),
  context: tutorContext,
}, "Staging AI practice generation");
assert.deepEqual(practice.suggestions, [], "Tutor practice mode must not suggest mutations.");
assert.deepEqual(practice.dataRequests, [], "Tutor practice mode must not request tools.");
const generatedExercise = parseLearningPracticeCandidateReply(practice.reply, practiceContext);
const generatedValidation = validateLearningPracticeQualityCandidate({
  candidateId: "staging-learning-agent-generated-candidate",
  purpose: "learning_practice_candidate",
  schemaVersion: 1,
  context: {
    competencyId: practiceContext.competencyId,
    topicId: practiceContext.topicId,
    gapId: practiceContext.gapId,
    competencyTitle: practiceContext.competencyTitle,
    topicTitle: practiceContext.topicTitle,
    gapLabel: practiceContext.gapLabel,
    allowedSourceVariantIds: sourceIds,
  },
  exercise: generatedExercise,
}, { learningMap, registry: assessmentRegistry, existingCandidates: [] });
assert.equal(generatedValidation.validationStatus, "passed",
  "The real AI exercise must pass deterministic schema, mapping and safety validation: " +
  JSON.stringify(generatedValidation.errors));
console.log("PASS: real Staging Learning Agent generated a gap-bound practice draft.", JSON.stringify({
  title: generatedExercise.title,
  taskType: generatedExercise.taskType,
  difficulty: generatedExercise.difficulty,
  sourceVariantIds: generatedExercise.sourceVariantIds,
  deterministicValidation: generatedValidation.validationStatus,
  warnings: generatedValidation.warnings.map(item => item.code),
}));

const socratic = await callAgent({
  mode: "tutor",
  tutorMode: "socratic",
  message: "我认为第一个 ThenableJob 会先于 marker 执行，因为它先入队。请继续用苏格拉底式方式引导我，只问一个简短问题，不要直接给出完整答案。",
  context: tutorContext,
}, "Staging Socratic tutor");
assert.deepEqual(socratic.suggestions, []);
assert.deepEqual(socratic.dataRequests, []);
const questionCount = (socratic.reply.match(/[？?]/g) || []).length;
assert.equal(questionCount, 1, "Socratic tutor must ask exactly one question per turn.");
assert.ok(socratic.reply.length <= 600, "Socratic question should remain concise.");
console.log("PASS: real Staging Socratic tutor asked exactly one question.", socratic.reply);

const agent = await callAgent({
  mode: "agent",
  message: "请基于我当前的学习目标、掌握情况和薄弱点，提出下一步学习建议。如果上下文不足，可以申请必要的只读学习数据；不要直接修改目标、计划或任务。",
  context: {
    goals: [],
    mastery: [],
    weakPoints: [],
    competencyStates: [],
    activePlan: null,
    recentConversation: [],
    requestedToolResults: [],
    learningScene,
  },
}, "Staging Agent mode");
const validatedAgent = validateAgentProviderResponse(agent);
assert.ok(validatedAgent.suggestions.length <= 4);
assert.ok(validatedAgent.dataRequests.length <= 3);
console.log("PASS: real Staging Agent mode returned schema-valid read requests and mutation proposals without executing them.", JSON.stringify({
  readRequests: validatedAgent.dataRequests.map(item => item.toolName),
  mutationSuggestions: validatedAgent.suggestions.map(item => item.toolName),
}));
