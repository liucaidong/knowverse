import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { waitForAsyncPageCondition } from "./helpers/wait-for-async-page-condition.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml"};
async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const relative = pathname.startsWith("/") ? pathname.slice(1) : pathname;
      let file = resolve(root, relative || "index.html");
      if (file !== root && !file.startsWith(root + sep)) return response.writeHead(403).end("Forbidden");
      try { if ((await stat(file)).isDirectory()) file = resolve(file, "index.html"); }
      catch { return response.writeHead(404).end("Not found"); }
      response.writeHead(200, {"content-type":mime[extname(file)] || "application/octet-stream","cache-control":"no-store"});
      response.end(await readFile(file));
    } catch { response.writeHead(500).end("Internal error"); }
  });
  await new Promise((resolveServer,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolveServer);});
  return {server,baseURL:"http://127.0.0.1:"+server.address().port};
}
const {server,baseURL}=await startServer();
test.after(()=>new Promise(resolveServer=>server.close(resolveServer)));

test("Chromium desktop: work activity and a successful checkpoint are recorded", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:960}});
    const page=await context.newPage();
    const errors=[]; page.on("pageerror",e=>errors.push(e.message));
    await page.goto(baseURL+"/lab/experiments/promise-identity/",{waitUntil:"domcontentloaded"});
    await page.locator("#kv-learning-launcher").waitFor({state:"visible"});
    await page.locator("#kv-learning-launcher").click();
    await page.locator("#kv-learning-checkpoint").waitFor({state:"visible"});
    await page.locator('[data-option-id="b"]').click();
    await page.getByText("验证通过 · 已记录独立证据").waitFor();
    const events=await page.evaluate(async()=>{const {getLearningRepository}=await import("/assets/js/backend/learning-repository.mjs");return (await getLearningRepository()).events.list();});
    assert.ok(events.some(e=>e.type==="activity"&&e.stepId==="page_view"&&e.workId==="promise-identity"));
    assert.ok(events.some(e=>e.type==="assessment_passed"&&e.sessionType==="checkpoint"&&e.workId==="promise-identity"));
    assert.deepEqual(errors,[]);
    await context.close();
  } finally { await browser.close(); }
});

test("Chromium desktop: an accepted strategy task links to its checkpoint and records the outcome under the decision ID", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:960}});
    const page=await context.newPage();
    const errors=[]; page.on("pageerror",e=>errors.push(e.message));
    await page.goto(baseURL+"/",{waitUntil:"domcontentloaded"});
    const task=await page.evaluate(async()=>{
      const [{getLearningRepository},{mapPlanActionToTask},manifest]=await Promise.all([
        import("/assets/js/backend/learning-repository.mjs"),
        import("/assets/js/learning-agent/task-orchestrator.mjs"),
        fetch("/content/learning-checkpoints.json").then(response=>response.json()),
      ]);
      const checkpoint=manifest.checkpoints.find(item=>item.id==="cp-promise-identity");
      const task=mapPlanActionToTask({
        type:"validate", actionId:"strategy-checkpoint",
        href:"./lab/experiments/promise-identity/", planDate:new Date().toISOString().slice(0,10),
        competencyId:checkpoint.competencyId, competencyTitle:"Promise 身份保持",
        topicId:checkpoint.topicId, topicTitle:"Promise",
        resourceType:"checkpoint", resourceTitle:checkpoint.title,
        resourceLabel:"独立检查点", variantId:checkpoint.id, workId:checkpoint.workId,
        estimatedMinutes:5,
        strategyDecisionId:"e2e-strategy-decision", strategyProfileRevision:2,
        learningIntervention:"transfer-challenge",
        strategyInstruction:"使用未见变体验证迁移。",
        difficultyLevel:"stretch", strategyEvidenceRefs:["evidence-a","evidence-b"],
      },"e2e-strategy-plan");
      const repository=await getLearningRepository();
      await repository.commit({documents:[{
        type:"learning_task",key:task.taskId,payload:task,expectedLocalRevision:0,
      }]});
      return {taskId:task.taskId,taskSchemaVersion:task.taskSchemaVersion,url:new URL(task.href,location.origin+"/").href};
    });
    await page.goto(task.url,{waitUntil:"domcontentloaded"});
    await page.locator("#kv-learning-launcher").waitFor({state:"visible"});
    await page.locator("#kv-learning-launcher").click();
    await page.locator("#kv-learning-checkpoint").waitFor({state:"visible"});
    await page.locator('[data-option-id="b"]').click();
    await page.getByText("验证通过 · 已记录独立证据").waitFor();
    await waitForAsyncPageCondition(page, async taskId=>{
      const {getLearningRepository}=await import("/assets/js/backend/learning-repository.mjs");
      const task=await (await getLearningRepository()).documents.get("learning_task",taskId);
      return task?.payload?.status==="completed";
    }, { arg: task.taskId, label: "the completed learning task document" });
    const result=await page.evaluate(async taskId=>{
      const {getLearningRepository}=await import("/assets/js/backend/learning-repository.mjs");
      const repository=await getLearningRepository();
      const [events,row]=await Promise.all([
        repository.events.list(),repository.documents.get("learning_task",taskId),
      ]);
      return {events:events.filter(item=>item.strategyDecisionId==="e2e-strategy-decision"),
        status:row?.payload?.status};
    },task.taskId);
    const pass=result.events.find(item=>item.type==="assessment_passed");
    const completed=result.events.find(item=>item.type==="learning_task_completed");
    assert.equal(result.status,"completed");
    assert.equal(task.taskSchemaVersion,2);
    assert.equal(pass.taskId,task.taskId);
    assert.equal(pass.learningIntervention,"transfer-challenge");
    assert.equal(pass.difficultyLevel,"stretch");
    assert.equal(completed.strategyDecisionId,"e2e-strategy-decision");
    assert.deepEqual(errors,[]);
    await context.close();
  } finally { await browser.close(); }
});

test("Chromium desktop: a targeted campaign step completes only its own task and carries strategy evidence", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:960}});
    const page=await context.newPage();
    const errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    await page.goto(baseURL+"/",{waitUntil:"domcontentloaded"});
    const task=await page.evaluate(async()=>{
      const [{getLearningRepository},{mapPlanActionToTask},registry]=await Promise.all([
        import("/assets/js/backend/learning-repository.mjs"),
        import("/assets/js/learning-agent/task-orchestrator.mjs"),
        fetch("/content/challenges.json").then(response=>response.json()),
      ]);
      const challenge=registry.challenges.find(item=>item.id==="promise-mechanism-quest");
      const step=challenge.steps[0];
      const uniquePlanId="campaign-e2e-plan-"+crypto.randomUUID();
      const action=mapPlanActionToTask({
        actionId:"campaign-step",type:"practice",title:step.title,
        href:"./puzzles/worlds/promise-mechanism-quest/",
        planDate:new Date().toISOString().slice(0,10),
        competencyId:step.competencyIds[0],competencyTitle:step.title,
        topicId:"promise",topicTitle:"Promise",
        resourceType:"challenge",resourceTitle:challenge.title,
        resourceLabel:"Promise 机制挑战",variantId:challenge.id+":"+step.id,
        workId:challenge.workId,estimatedMinutes:10,
        strategyDecisionId:"campaign-strategy-decision",strategyProfileRevision:5,
        learningIntervention:"transfer-challenge",
        strategyInstruction:"用未见过的变体验证 thenable 机制迁移。",
        difficultyLevel:"stretch",strategyEvidenceRefs:["campaign-evidence-1"],
      },uniquePlanId);
      const repository=await getLearningRepository();
      await repository.commit({documents:[{
        type:"learning_task",key:action.taskId,payload:action,expectedLocalRevision:0,
      }]});
      return {
        taskId:action.taskId,taskSchemaVersion:action.taskSchemaVersion,
        correctOptionId:step.answer,
        successFeedback:step.successFeedback,
        url:new URL(action.href,location.origin+"/").href,
      };
    });
    assert.equal(task.taskSchemaVersion,2);
    await page.goto(task.url,{waitUntil:"domcontentloaded"});
    await page.evaluate(feedback => { window.__phaseGExpectedFeedback = feedback; }, task.successFeedback);
    await page.locator("#step-options [data-option-id]").first().waitFor({state:"visible"});
    await page.locator("#step-options [data-option-id=\""+task.correctOptionId+"\"]").click();
    // The challenge click handler awaits both event persistence and task completion
    // before updating the success feedback and removing taskId from the URL.
    await page.waitForFunction(() =>
      !new URL(location.href).searchParams.has("taskId") &&
      document.querySelector("#step-feedback")?.textContent === window.__phaseGExpectedFeedback);
    const result=await page.evaluate(async taskId=>{
      const {getLearningRepository}=await import("/assets/js/backend/learning-repository.mjs");
      const repository=await getLearningRepository();
      const [events,row]=await Promise.all([
        repository.events.list(),repository.documents.get("learning_task",taskId),
      ]);
      return {events:events.filter(item=>item.taskId===taskId),status:row?.payload?.status};
    },task.taskId);
    const pass=result.events.find(item=>item.type==="completed");
    const completion=result.events.find(item=>item.type==="learning_task_completed");
    assert.equal(result.status,"completed");
    assert.equal(pass.strategyDecisionId,"campaign-strategy-decision");
    assert.equal(pass.independent,true);
    assert.equal(pass.difficultyLevel,"stretch");
    assert.equal(completion.strategyDecisionId,"campaign-strategy-decision");
    assert.deepEqual(errors,[]);
    await context.close();
  } finally { await browser.close(); }
});

test("WebKit mobile: a wrong answer records a gap and links to targeted review", {timeout:60000}, async()=>{
  const browser=await webkit.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage();
    const errors=[]; page.on("pageerror",e=>errors.push(e.message));
    await page.goto(baseURL+"/knowledge/monorepo/labs/cache/",{waitUntil:"domcontentloaded"});
    await page.locator("#kv-learning-launcher").waitFor({state:"visible"});
    await page.locator("#kv-learning-launcher").click();
    await page.locator("#kv-learning-checkpoint").waitFor({state:"visible"});
    await page.locator('[data-option-id="a"]').click();
    await page.getByText("还需要补强这个概念").waitFor();
    await page.getByRole("link",{name:"前往针对性复习"}).waitFor();
    const events=await page.evaluate(async()=>{const {getLearningRepository}=await import("/assets/js/backend/learning-repository.mjs");return (await getLearningRepository()).events.list();});
    assert.ok(events.some(e=>e.type==="attempt"&&e.correct===false&&e.gapId==="build-cache-input-coverage"));
    assert.deepEqual(errors,[]);
    await context.close();
  } finally { await browser.close(); }
});
