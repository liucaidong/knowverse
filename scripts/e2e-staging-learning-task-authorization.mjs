#!/usr/bin/env node
/**
 * Verify model-proposed task mutations are blocked until the learner confirms,
 * then verify a confirmed start is atomically persisted to Staging cloud.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const STAGING_ORIGIN = "https://ypthoicwrfsblaidllyy.supabase.co";
const envText = await readFile(new URL("../.env.n2.local", import.meta.url), "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/)
  .filter(line => line && !line.trimStart().startsWith("#") && line.includes("="))
  .map(line => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
  }));
assert.equal(env.N2_SUPABASE_URL, STAGING_ORIGIN, "Safety stop: only the pinned Staging project is permitted.");
const apiKey = env.N2_SUPABASE_PUBLISHABLE_KEY;
assert.ok(apiKey && env.N2_SYNC_B_EMAIL && env.N2_SYNC_B_PASSWORD);
const authResponse = await fetch(STAGING_ORIGIN + "/auth/v1/token?grant_type=password", {
  method: "POST", headers: { apikey: apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({ email: env.N2_SYNC_B_EMAIL, password: env.N2_SYNC_B_PASSWORD }),
});
assert.ok(authResponse.ok, "Synthetic Staging Account B sign-in failed.");
const session = await authResponse.json();
assert.ok(session.access_token && session.refresh_token && session.user?.id);
const browserSession = { ...session, expires_at: Math.floor(Date.now() / 1000) + 365 * 86400 };

const mime = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let file = resolve(root, pathname.replace(/^\//, "") || "index.html");
    if (file !== root && !file.startsWith(root + sep)) return response.writeHead(403).end("Forbidden");
    try { if ((await stat(file)).isDirectory()) file = resolve(file, "index.html"); }
    catch { return response.writeHead(404).end("Not found"); }
    response.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(await readFile(file));
  } catch { response.writeHead(500).end("Internal error"); }
});
await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
const baseURL = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Tokyo" });
  await context.addInitScript(({ url, key, auth }) => {
    globalThis.KNOWVERSE_BACKEND_CONFIG = { supabaseUrl: url, publishableKey: key };
    localStorage.setItem("knowverse:supabase-session", JSON.stringify(auth));
  }, { url: STAGING_ORIGIN, key: apiKey, auth: browserSession });
  const page = await context.newPage();
  await page.goto(baseURL + "/agent/", { waitUntil: "domcontentloaded" });
  await page.locator("#la-workspace").waitFor({ state: "visible" });

  const result = await page.evaluate(async () => {
    const [
      { getArchiveRuntime }, { getLearningRepository },
      { createLearnerProfileStore }, { createLearningGoalManager },
      { createLearningTaskOrchestrator }, { createLearningPlanManager },
      { executeAgentTool },
    ] = await Promise.all([
      import("/assets/js/backend/archive-bootstrap.mjs"),
      import("/assets/js/backend/learning-repository.mjs"),
      import("/assets/js/learning-agent/learner-profile.mjs"),
      import("/assets/js/learning-agent/goal-manager.mjs"),
      import("/assets/js/learning-agent/task-orchestrator.mjs"),
      import("/assets/js/learning-agent/plan-manager.mjs"),
      import("/assets/js/learning-agent/agent-tools.mjs"),
    ]);
    const runtime = await getArchiveRuntime();
    const initialSync = await runtime.initialSyncPromise;
    if (initialSync.status !== "synced") throw new Error("Staging archive did not finish initial sync.");
    const repository = await getLearningRepository();
    const [learningMap, challengeRegistry] = await Promise.all([
      fetch("/content/learning-map.json").then(response => response.json()),
      fetch("/content/challenges.json").then(response => response.json()),
    ]);
    const profileStore = createLearnerProfileStore({ repository });
    const goalManager = createLearningGoalManager({ repository, learningMap });
    const taskOrchestrator = createLearningTaskOrchestrator({ repository });
    const planManager = createLearningPlanManager({ repository, taskOrchestrator });
    const toolContext = { repository, profileStore, goalManager, taskOrchestrator, planManager,
      learningMap, challengeRegistry, now: new Date() };
    const tasks = await taskOrchestrator.list();
    const task = tasks.find(item => item.taskType === "read" && item.competencyId === "thenable-adoption" && item.status === "ready");
    if (!task) throw new Error("No ready Promise lesson task is available for the synthetic learner.");
    const before = await Promise.all([repository.events.list(), repository.documents.get("learning_task", task.taskId)]);
    let modelDenied = false;
    try {
      await executeAgentTool("start_learning_task", { taskId: task.taskId }, toolContext,
        { origin: "model", confirmed: false });
    } catch (error) {
      modelDenied = /只能提出建议/.test(error.message);
    }
    if (!modelDenied) throw new Error("model-origin task start was not denied");
    const afterDenied = await Promise.all([repository.events.list(), repository.documents.get("learning_task", task.taskId)]);
    if (afterDenied[0].length !== before[0].length || afterDenied[1]?.payload?.status !== "ready") {
      throw new Error("a denied model mutation changed the learning archive");
    }
    const started = await executeAgentTool("start_learning_task", { taskId: task.taskId }, toolContext,
      { origin: "learner", confirmed: true });
    if (started.status !== "in_progress") throw new Error("learner-confirmed task did not enter in_progress");
    const events = await repository.events.list();
    const event = events.filter(item => item.type === "learning_task_in_progress" && item.taskId === task.taskId)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    if (!event) throw new Error("task start did not append a learning_task_in_progress event");
    const sync = await runtime.syncService.sync();
    if (sync.status !== "synced" || sync.pending !== 0 || sync.conflicts !== 0) {
      throw new Error("learner-confirmed task start did not sync cleanly: " + JSON.stringify(sync));
    }
    return { taskId: task.taskId, taskTitle: task.title, eventId: event.id,
      modelDenied, status: started.status, syncStatus: sync.status,
      pending: sync.pending, conflicts: sync.conflicts };
  });

  async function rest(resource, params, token) {
    const response = await fetch(STAGING_ORIGIN + "/rest/v1/" + resource + "?" + new URLSearchParams(params), {
      headers: { apikey: apiKey, Authorization: "Bearer " + token, Accept: "application/json" },
    });
    assert.equal(response.status, 200, "Staging REST verification failed: " + response.status);
    return response.json();
  }
  const [cloudTask, cloudEvent] = await Promise.all([
    rest("learning_archive_documents", { select: "document_key,document_payload", document_type: "eq.learning_task", document_key: "eq." + result.taskId }, session.access_token),
    rest("learning_events", { select: "event_id,event_type", event_id: "eq." + result.eventId }, session.access_token),
  ]);
  assert.equal(cloudTask.length, 1);
  assert.equal(cloudTask[0].document_payload.status, "in_progress");
  assert.equal(cloudEvent.length, 1);
  assert.equal(cloudEvent[0].event_type, "learning_task_in_progress");
  console.log("PASS: model-origin task start was denied; learner-confirmed start synced to Staging.",
    JSON.stringify({ ...result, cloudTaskStatus: cloudTask[0].document_payload.status, cloudEventType: cloudEvent[0].event_type }));
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
