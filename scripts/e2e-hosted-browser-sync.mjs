import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const envText = await readFile(new URL("../.env.n2.local", import.meta.url), "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/).filter(line => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).map(line => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
}));
const expectedSupabaseUrl = "https://ypthoicwrfsblaidllyy.supabase.co";
assert.equal(String(env.N2_SUPABASE_URL || "").replace(/\/+$/, ""), expectedSupabaseUrl,
  "Refusing to run: .env.n2.local must point to the approved N2 staging project.");
assert.ok(env.N2_SYNC_A_EMAIL && env.N2_SYNC_A_PASSWORD,
  "Account A staging credentials are required in the ignored local .env.n2.local file.");

const previewOrigin = "http://127.0.0.1:4188";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const browserErrors = [];
const rpcResponses = [];
page.on("pageerror", error => browserErrors.push("PAGE: " + error.message));
page.on("console", message => {
  if (message.type() === "error") browserErrors.push("CONSOLE: " + message.text());
});
page.on("requestfailed", request => browserErrors.push(
  "REQUEST: " + request.url().split("?")[0] + " :: " + (request.failure()?.errorText || "unknown"),
));
page.on("response", response => {
  if (response.url().startsWith(expectedSupabaseUrl + "/rest/v1/rpc/")) {
    rpcResponses.push({ status: response.status(), rpc: response.url().split("/").pop() });
  }
});

try {
  await page.goto(previewOrigin + "/n2-staging-login/", { waitUntil: "domcontentloaded" });
  const configuredOrigin = await page.evaluate(() => window.KNOWVERSE_BACKEND_CONFIG?.supabaseUrl || "");
  assert.equal(configuredOrigin.replace(/\/+$/, ""), expectedSupabaseUrl,
    "The local preview must use staging public config, never production config.");

  await page.locator("#account").selectOption(env.N2_SYNC_A_EMAIL);
  await page.locator("#password").fill(env.N2_SYNC_A_PASSWORD);
  await page.locator("#submit").click();
  await page.waitForURL("**/progress/#cloud-account", { timeout: 20000 });
  await page.waitForFunction(() => {
    const host = document.querySelector("#backend-account-panel");
    return host?.innerText.includes("当前账户：n2-sync-a@knowverse-test.invalid") &&
      host?.innerText.includes("冲突待处理\n0") &&
      host?.querySelector(".kv-backend-status")?.innerText === "已同步";
  }, null, { timeout: 30000 });

  const initial = await page.evaluate(() => {
    const host = document.querySelector("#backend-account-panel");
    return {
      status: host.querySelector(".kv-backend-status")?.innerText || null,
      conflicts: host.innerText.match(/冲突待处理\n(\d+)/)?.[1] || null,
      pendingEvents: host.innerText.match(/待上传事件\n(\d+)/)?.[1] || null,
      pendingDocuments: host.innerText.match(/待同步档案\n(\d+)/)?.[1] || null,
      actions: [...host.querySelectorAll(".kv-backend-actions button")].map(button => ({
        text: button.innerText,
        visible: button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0,
        disabled: button.disabled,
      })),
    };
  });
  assert.equal(initial.conflicts, "0", "Rebuildable derived projections must not create cross-device conflicts.");
  assert.deepEqual(initial.actions.map(action => action.text), ["立即同步", "从云端恢复"]);
  assert.ok(initial.actions.every(action => action.visible && !action.disabled));

  await page.getByRole("button", { name: "立即同步" }).click();
  await page.waitForFunction(() =>
    document.querySelector("#backend-account-panel .kv-backend-status")?.innerText === "已同步",
  null, { timeout: 20000 });

  const commitsBeforeRestore = rpcResponses.filter(item => item.rpc === "sync_commit_learning_batch").length;
  await page.getByRole("button", { name: "从云端恢复" }).click();
  await page.waitForFunction(() =>
    document.querySelector("#backend-account-panel .kv-backend-status")?.innerText === "云端恢复完成",
  null, { timeout: 20000 });
  const commitsAfterRestore = rpcResponses.filter(item => item.rpc === "sync_commit_learning_batch").length;
  assert.equal(commitsAfterRestore, commitsBeforeRestore,
    "Pull-only cloud restore must not invoke the batch commit RPC.");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const host = document.querySelector("#backend-account-panel");
    return host?.innerText.includes("当前账户：n2-sync-a@knowverse-test.invalid") &&
      host?.innerText.includes("冲突待处理\n0") &&
      host?.querySelector(".kv-backend-status")?.innerText === "已同步";
  }, null, { timeout: 30000 });

  const finalState = await page.evaluate(() => ({
    conflicts: document.querySelectorAll("#backend-account-panel .kv-backend-conflict").length,
    actions: [...document.querySelectorAll("#backend-account-panel .kv-backend-actions button")].map(button => button.innerText),
    indexedDb: document.querySelector("#backend-account-panel")?.innerText.includes("IndexedDB 可用") || false,
  }));
  assert.equal(finalState.conflicts, 0);
  assert.deepEqual(finalState.actions, ["立即同步", "从云端恢复"]);
  assert.equal(finalState.indexedDb, true);
  assert.deepEqual(browserErrors, [], "Browser console or request errors were observed.");
  assert.ok(rpcResponses.length > 0 && rpcResponses.every(item => item.status === 200),
    "At least one hosted staging RPC must run, and every observed RPC must return HTTP 200.");

  console.log(JSON.stringify({
    RESULT: "PASS",
    staging: expectedSupabaseUrl,
    initial,
    finalState,
    tested: ["authenticated browser bootstrap", "automatic sync", "manual sync", "pull-only restore", "page reload"],
    rpcResponseCount: rpcResponses.length,
    rpcNames: [...new Set(rpcResponses.map(item => item.rpc))],
    restoreCommitRpcCount: commitsAfterRestore - commitsBeforeRestore,
    browserErrors: browserErrors.length,
  }, null, 2));
} finally {
  await browser.close();
}
