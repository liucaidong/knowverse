import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function createCloudMock() {
  const events = [];
  const eventsById = new Map();
  const deviceSequences = new Map();
  const devices = new Set();
  const documents = new Map();
  let eventSequence = 0;
  let documentSequence = 0;

  return {
    events,
    documents,
    async rpc(name, body) {
      if (name === "get_learning_sync_profile") {
        return { authorized: true, user_id: "archive-test-user" };
      }
      if (name === "register_device") {
        devices.add(body.p_device_id);
        return { registered: true, device_id: body.p_device_id };
      }
      if (name === "sync_push_learning_events") {
        assert.ok(devices.has(body.p_device_id), "device must be registered before push");
        const confirmed = [];
        let inserted = 0;
        for (const row of body.p_events || []) {
          const payload = row.event_payload;
          assert.equal(row.event_id, payload.id);
          assert.ok(Number(row.device_seq) > 0);
          const existing = eventsById.get(row.event_id);
          if (existing) {
            assert.deepEqual(existing.event_payload, payload, "same event id must have identical payload");
            confirmed.push({ event_id: row.event_id, user_seq: existing.user_seq, duplicate: true });
            continue;
          }
          const deviceSequenceKey = body.p_device_id + ":" + row.device_seq;
          assert.equal(deviceSequences.has(deviceSequenceKey), false, "device sequence must be unique");
          deviceSequences.set(deviceSequenceKey, row.event_id);
          const record = {
            event_id: row.event_id,
            user_seq: ++eventSequence,
            device_id: body.p_device_id,
            device_seq: Number(row.device_seq),
            occurred_at: payload.at,
            event_payload: payload,
          };
          events.push(record);
          eventsById.set(row.event_id, record);
          confirmed.push({ event_id: row.event_id, user_seq: record.user_seq, duplicate: false });
          inserted += 1;
        }
        return { confirmed, inserted };
      }
      if (name === "sync_pull_learning_events") {
        const after = Number(body.p_after_user_seq || 0);
        const limit = Math.max(1, Math.min(100, Number(body.p_page_size || 100)));
        const page = events.filter(row => row.user_seq > after).slice(0, limit);
        const next = page.length ? page.at(-1).user_seq : after;
        return {
          events: page.map(row => ({
            event_id: row.event_id,
            user_seq: row.user_seq,
            device_id: row.device_id,
            device_seq: row.device_seq,
            occurred_at: row.occurred_at,
            event_payload: row.event_payload,
          })),
          next_cursor: next,
          has_more: events.some(row => row.user_seq > next),
        };
      }
      if (name === "sync_push_learning_documents") {
        assert.ok(devices.has(body.p_device_id), "device must be registered before document push");
        const confirmed = [];
        const conflicts = [];
        for (const row of body.p_documents || []) {
          const current = documents.get(row.document_id);
          const payloadString = JSON.stringify(row.document_payload);
          if (current && JSON.stringify(current.document_payload) === payloadString) {
            confirmed.push({
              document_id: row.document_id,
              local_revision: row.local_revision,
              revision: current.revision,
              document_seq: current.document_seq,
            });
            continue;
          }
          if ((!current && Number(row.base_revision) !== 0) ||
              (current && Number(row.base_revision) !== current.revision)) {
            if (current) conflicts.push({ ...current });
            continue;
          }
          const record = {
            document_id: row.document_id,
            document_type: row.document_type,
            document_key: row.document_key,
            revision: current ? current.revision + 1 : 1,
            document_seq: ++documentSequence,
            device_id: body.p_device_id,
            updated_at: new Date().toISOString(),
            document_payload: row.document_payload,
          };
          documents.set(row.document_id, record);
          confirmed.push({
            document_id: row.document_id,
            local_revision: row.local_revision,
            revision: record.revision,
            document_seq: record.document_seq,
          });
        }
        return { confirmed, conflicts, written: confirmed.length };
      }
      if (name === "sync_pull_learning_documents") {
        const after = Number(body.p_after_document_seq || 0);
        const limit = Math.max(1, Math.min(100, Number(body.p_page_size || 100)));
        const page = [...documents.values()]
          .filter(row => row.document_seq > after)
          .sort((a, b) => a.document_seq - b.document_seq)
          .slice(0, limit);
        const next = page.length ? page.at(-1).document_seq : after;
        return {
          documents: page,
          next_cursor: next,
          has_more: [...documents.values()].some(row => row.document_seq > next),
        };
      }
      throw new Error("Unexpected RPC: " + name);
    },
  };
}

async function startServer() {
  const cloud = createCloudMock();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname.startsWith("/mock/rest/v1/rpc/")) {
        let body = "";
        for await (const chunk of request) body += chunk;
        const name = url.pathname.split("/").at(-1);
        try {
          const result = await cloud.rpc(name, body ? JSON.parse(body) : {});
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(result));
        } catch (error) {
          response.writeHead(409, { "content-type": "application/json" });
          response.end(JSON.stringify({ message: error.message, code: "mock_conflict" }));
        }
        return;
      }
      const pathname = decodeURIComponent(url.pathname);
      const relative = pathname.replace(/^\/+/, "");
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
  return { server, cloud, baseURL: "http://127.0.0.1:" + server.address().port };
}

const { server, cloud, baseURL } = await startServer();
test.after(() => new Promise(resolveServer => server.close(resolveServer)));

async function newDevice(browser, label) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(baseURL + "/scripts/fixtures/archive-harness.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.archiveReady === true);
  return { context, page, errors, label };
}

function event(id, type, at, patch = {}) {
  return {
    id,
    eventSchemaVersion: 3,
    type,
    at,
    topicId: "promise",
    challengeId: "promise-mechanism-quest",
    challengeTitle: "Promise 机制挑战",
    stepId: "thenable-adoption",
    stepTitle: "thenable 解析",
    competencyIds: ["thenable-adoption"],
    sessionId: id.split(":")[0],
    sessionType: "campaign",
    variantId: "promise-mechanism-quest:thenable-adoption",
    causationEventIds: [],
    ...patch,
  };
}

test("Mac + iPhone: offline-first archive, event merge, idempotency, document CAS conflict and recovery", {
  timeout: 90000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  let mac;
  let phone;
  try {
    mac = await newDevice(browser, "Mac");
    phone = await newDevice(browser, "iPhone");

    const failedAttempt = event(
      "mac-run:attempt:thenable-adoption:1",
      "attempt",
      "2032-04-01T10:00:00.000Z",
      { correct: false, gapId: "thenable-get-vs-call", attemptNumber: 1 },
    );
    await mac.page.evaluate(value => {
      window.archiveHarness.addEvent(value);
      localStorage.setItem("knowverse:challenge:v1:promise-mechanism-quest", JSON.stringify({
        engineVersion: 1,
        challengeId: "promise-mechanism-quest",
        runId: "mac-run",
        status: "in-progress",
        currentStep: "thenable-adoption",
        steps: [{ id: "thenable-adoption", status: "active", attempts: 1, hintsUsed: 0, data: {} }],
      }));
    }, failedAttempt);

    const macFirstSync = await mac.page.evaluate(() => window.archiveHarness.sync());
    assert.equal(macFirstSync.status, "synced");
    assert.equal(macFirstSync.pushed, 1);
    assert.equal(macFirstSync.pushedDocuments, 1);
    assert.equal(cloud.events.length, 1);
    assert.equal(cloud.documents.size, 1);

    const phoneFirstSync = await phone.page.evaluate(() => window.archiveHarness.sync());
    assert.equal(phoneFirstSync.status, "synced");
    assert.equal(phoneFirstSync.pulled, 1);
    assert.equal(phoneFirstSync.pulledDocuments, 1);
    const phoneState = await phone.page.evaluate(() => ({
      events: window.archiveHarness.store.load().events,
      challenge: JSON.parse(localStorage.getItem("knowverse:challenge:v1:promise-mechanism-quest") || "null"),
    }));
    assert.equal(phoneState.events.length, 1);
    assert.equal(phoneState.events[0].gapId, "thenable-get-vs-call");
    assert.equal(phoneState.challenge.currentStep, "thenable-adoption");

    const reviewPass = event(
      "phone-review:assessment:passed",
      "assessment_passed",
      "2021-01-01T00:00:00.000Z",
      {
        correct: true,
        gapId: "thenable-get-vs-call",
        scorePct: 100,
        independent: true,
        sessionType: "review",
        sessionId: "phone-review",
        variantId: "thenable-get-vs-call:independent",
      },
    );
    await phone.page.evaluate(value => {
      window.archiveHarness.addEvent(value);
      localStorage.setItem("knowverse:review-session:v1:phone-review", JSON.stringify({
        schemaVersion: 1,
        sessionId: "phone-review",
        sessionType: "review",
        competencyId: "thenable-adoption",
        targetGapId: "thenable-get-vs-call",
        variantId: "thenable-get-vs-call:independent",
        status: "passed",
        attempts: 1,
        hintsUsed: 0,
      }));
      localStorage.setItem("knowverse:learning-plan:preferences:v1", JSON.stringify({
        dailyMinutes: 40,
        focusTopicId: "promise",
      }));
    }, reviewPass);
    const phoneSync = await phone.page.evaluate(() => window.archiveHarness.sync());
    assert.equal(phoneSync.status, "synced");
    assert.equal(phoneSync.pushed, 1);
    assert.equal(phoneSync.pushedDocuments, 2);

    const macPull = await mac.page.evaluate(() => window.archiveHarness.sync());
    assert.equal(macPull.status, "synced");
    assert.equal(macPull.pulled, 1);
    assert.equal(macPull.pulledDocuments, 2);
    const macMerged = await mac.page.evaluate(() => ({
      events: window.archiveHarness.store.load().events,
      review: JSON.parse(localStorage.getItem("knowverse:review-session:v1:phone-review") || "null"),
      preferences: JSON.parse(localStorage.getItem("knowverse:learning-plan:preferences:v1") || "null"),
    }));
    assert.equal(macMerged.events.length, 2);
    assert.ok(macMerged.events.some(row => row.type === "attempt" && row.correct === false));
    assert.ok(macMerged.events.some(row => row.type === "assessment_passed" && row.independent));
    assert.equal(macMerged.review.status, "passed");
    assert.equal(macMerged.preferences.dailyMinutes, 40);
    assert.equal(cloud.events[0].user_seq < cloud.events[1].user_seq, true,
      "server sequence, not device wall-clock, defines incremental event order");
    assert.equal(Date.parse(cloud.events[1].occurred_at) < Date.parse(cloud.events[0].occurred_at), true,
      "test data intentionally contains a backwards device clock");

    await mac.page.evaluate(() => window.archiveHarness.sync());
    assert.equal(cloud.events.length, 2);

    await phone.context.setOffline(true);
    const offlineEvent = event(
      "phone-offline:attempt:2",
      "attempt",
      "2020-12-31T23:59:00.000Z",
      { correct: false, gapId: "thenable-get-vs-call", attemptNumber: 2 },
    );
    await phone.page.evaluate(value => window.archiveHarness.addEvent(value), offlineEvent);
    await phone.page.waitForFunction(async () => {
      const status = await window.archiveHarness.status();
      return status.pendingEvents >= 1;
    });
    const offlineResult = await phone.page.evaluate(() => window.archiveHarness.sync());
    assert.equal(offlineResult.status, "offline");
    await phone.context.setOffline(false);
    const recovered = await phone.page.evaluate(() => window.archiveHarness.sync());
    assert.equal(recovered.status, "synced");
    assert.equal(recovered.pushed, 1);
    assert.equal(cloud.events.length, 3);

    await mac.page.evaluate(() => {
      const key = "knowverse:challenge:v1:promise-mechanism-quest";
      const value = JSON.parse(localStorage.getItem(key));
      value.currentStep = "mac-second-step";
      localStorage.setItem(key, JSON.stringify(value));
    });
    const macEdit = await mac.page.evaluate(() => window.archiveHarness.sync());
    assert.equal(macEdit.status, "synced");

    const phoneBase = await phone.page.evaluate(() => JSON.parse(localStorage.getItem(
      "knowverse:challenge:v1:promise-mechanism-quest"
    )));
    phoneBase.currentStep = "iphone-second-step";
    await phone.page.evaluate(value => localStorage.setItem(
      "knowverse:challenge:v1:promise-mechanism-quest", JSON.stringify(value)
    ), phoneBase);

    const conflictSync = await phone.page.evaluate(() => window.archiveHarness.sync());
    assert.equal(conflictSync.status, "synced");
    assert.equal(conflictSync.conflicts, 1);
    const conflicts = await phone.page.evaluate(() => window.archiveHarness.conflicts());
    assert.equal(conflicts.length, 1);

    await phone.page.evaluate(id => window.archiveHarness.resolve(id, "local"), conflicts[0].id);
    const resolved = await phone.page.evaluate(() => window.archiveHarness.sync());
    assert.equal(resolved.status, "synced");
    assert.equal(resolved.conflicts, 0);
    const cloudChallenge = cloud.documents.get("challenge_progress:promise-mechanism-quest");
    assert.equal(cloudChallenge.document_payload.currentStep, "iphone-second-step");
    assert.equal(cloudChallenge.revision, 3);

    assert.deepEqual(mac.errors, [], "Mac browser should not throw uncaught exceptions");
    assert.deepEqual(phone.errors, [], "iPhone browser should not throw uncaught exceptions");
  } finally {
    await mac?.context.close();
    await phone?.context.close();
    await browser.close();
  }
});
