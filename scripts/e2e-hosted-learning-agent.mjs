import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
