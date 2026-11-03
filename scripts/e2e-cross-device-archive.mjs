import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit, devices } from "playwright";
import { waitForAsyncPageCondition } from "./helpers/wait-for-async-page-condition.mjs";

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
      if (name === "sync_commit_learning_batch") {
        assert.ok(devices.has(body.p_device_id), "device must be registered before commit");
        assert.equal(body.p_expected_user_id, "archive-test-user", "active account must match the expected account");
        const incomingEvents = body.p_events || [];
        const incomingDocuments = body.p_documents || [];
        assert.ok(incomingEvents.length <= 100);
        assert.ok(incomingDocuments.length <= 50);

        // Preflight document CAS and immutable event IDs before mutating either
        // table. This models the server RPC's all-or-nothing transaction.
        const conflicts = [];
        for (const row of incomingDocuments) {
          const current = documents.get(row.document_id);
          const same = current && JSON.stringify(current.document_payload) === JSON.stringify(row.document_payload);
          if (same) continue;
          if ((!current && Number(row.base_revision) !== 0) ||
              (current && Number(row.base_revision) !== current.revision)) {
            if (current) conflicts.push({ ...current });
            else conflicts.push({
              document_id: row.document_id,
              document_type: row.document_type,
              document_key: row.document_key,
              revision: 0,
              document_seq: 0,
              device_id: body.p_device_id,
              updated_at: new Date().toISOString(),
              document_payload: {},
            });
          }
        }
        if (conflicts.length) {
          return {
            status: "conflict",
            events: { confirmed: [], inserted: 0 },
            documents: { confirmed: [], conflicts },
          };
        }

        const eventPreflight = [];
        const seenIds = new Set();
        const seenSequences = new Set();
        for (const row of incomingEvents) {
          const payload = row.event_payload;
          assert.equal(row.event_id, payload.id);
          assert.ok(Number(row.device_seq) > 0);
          assert.equal(seenIds.has(row.event_id), false, "batch event IDs must be unique");
          seenIds.add(row.event_id);
          const existing = eventsById.get(row.event_id);
          if (existing) {
            assert.deepEqual(existing.event_payload, payload, "same event ID must retain identical payload");
            eventPreflight.push({ row, existing, duplicate: true });
            continue;
          }
          const sequenceKey = body.p_device_id + ":" + row.device_seq;
          assert.equal(seenSequences.has(sequenceKey), false, "device sequence must be unique within the batch");
          seenSequences.add(sequenceKey);
          assert.equal(deviceSequences.has(sequenceKey), false, "device sequence must be unique");
          eventPreflight.push({ row, duplicate: false });
        }

        const confirmedDocuments = [];
        for (const row of incomingDocuments) {
          const current = documents.get(row.document_id);
          if (current && JSON.stringify(current.document_payload) === JSON.stringify(row.document_payload)) {
            confirmedDocuments.push({
              document_id: row.document_id,
              local_revision: row.local_revision,
              revision: current.revision,
              document_seq: current.document_seq,
            });
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
          confirmedDocuments.push({
            document_id: row.document_id,
            local_revision: row.local_revision,
            revision: record.revision,
            document_seq: record.document_seq,
          });
        }

        const confirmedEvents = [];
        let inserted = 0;
        for (const item of eventPreflight) {
          if (item.duplicate) {
            confirmedEvents.push({
              event_id: item.row.event_id,
              user_seq: item.existing.user_seq,
              duplicate: true,
            });
            continue;
          }
          const record = {
            event_id: item.row.event_id,
            user_seq: ++eventSequence,
            device_id: body.p_device_id,
            device_seq: Number(item.row.device_seq),
            occurred_at: item.row.event_payload.at,
            event_payload: item.row.event_payload,
          };
          deviceSequences.set(body.p_device_id + ":" + item.row.device_seq, item.row.event_id);
          events.push(record);
          eventsById.set(item.row.event_id, record);
          confirmedEvents.push({
            event_id: item.row.event_id,
            user_seq: record.user_seq,
            duplicate: false,
          });
          inserted += 1;
        }
        return {
          status: "committed",
          events: { confirmed: confirmedEvents, inserted },
          documents: { confirmed: confirmedDocuments, conflicts: [] },
          committed_at: new Date().toISOString(),
        };
      }
      if (name === "sync_pull_learning_events_for_account") {
        assert.equal(body.p_expected_user_id, "archive-test-user");
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
      if (name === "sync_pull_learning_documents_for_account") {
        assert.equal(body.p_expected_user_id, "archive-test-user");
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

async function newDevice(browser, label, contextOptions = {}, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, ...contextOptions });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.stack || error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push("console: " + message.text());
  });
  const manualRestore = options.manualRestore === true ? "?manualRestore=1" : "";
  const response = await page.goto(baseURL + "/scripts/fixtures/archive-harness.html" + manualRestore, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(() => window.archiveReady === true, null, { timeout: 8000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      href: location.href,
      ready: window.archiveReady,
      body: document.body.innerText,
    }));
    throw new Error("Archive harness failed to initialize (HTTP " + response?.status() + "): " +
      JSON.stringify({ state, errors }) + "\n" + error.message);
  }
  return { context, page, errors, label };
}

async function waitUntil(predicate, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  throw new Error("Timed out waiting for " + label);
}

function event(id, type, at, patch = {}) {
  return {
    id,
    eventSchemaVersion: 2,
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

test("Mac + WebKit iPhone profile: offline-first archive, cold restore, idempotency and CAS conflict", {
  timeout: 90000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  const safariBrowser = await webkit.launch({ headless: true });
  let mac;
  let phone;
  let freshIPhone;
  try {
    mac = await newDevice(browser, "Mac desktop");
    phone = await newDevice(browser, "iPhone-sized Chromium", {
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    });

    const failedAttempt = event(
      "mac-run:attempt:thenable-adoption:1",
      "attempt",
      "2032-04-01T10:00:00.000Z",
      { correct: false, gapId: "thenable-get-vs-call", attemptNumber: 1 },
    );
    await mac.page.evaluate(async value => {
      await window.archiveHarness.putDocument({
        type: "challenge_progress",
        key: "promise-mechanism-quest",
        payload: {
          engineVersion: 1,
          challengeId: "promise-mechanism-quest",
          runId: "mac-run",
          status: "in-progress",
          currentStep: "thenable-adoption",
          steps: [{ id: "thenable-adoption", status: "active", attempts: 1, hintsUsed: 0, data: {} }],
        },
      });
      await window.archiveHarness.addEvent(value);
    }, failedAttempt);
    await waitForAsyncPageCondition(mac.page, async () => {
      const status = await window.archiveHarness.status();
      return status.pendingEvents >= 1 && status.eventRecords === 1;
    }, { label: "Mac archive event to enter the local Outbox" });

    const macFirstSync = await mac.page.evaluate(() => window.archiveHarness.sync());
    assert.equal(macFirstSync.status, "synced");
    assert.equal(macFirstSync.pushed, 1);
    assert.equal(macFirstSync.pushedDocuments, 1);
    assert.equal(cloud.events.length, 1);
    assert.equal(cloud.events[0].event_payload.eventSchemaVersion, 3);
    assert.equal(cloud.events[0].event_payload.gapObservationId, failedAttempt.id);
    assert.deepEqual(cloud.events[0].event_payload.targetGapEventIds, []);
    assert.deepEqual(cloud.events[0].event_payload.causationEventIds, []);
    assert.equal(cloud.documents.size, 1);

    const phoneFirstSync = await phone.page.evaluate(() => window.archiveHarness.sync());
    assert.equal(phoneFirstSync.status, "synced");
    assert.equal(phoneFirstSync.pulled, 1);
    assert.equal(phoneFirstSync.pulledDocuments, 1);
    const phoneState = await phone.page.evaluate(async () => ({
      events: await window.archiveHarness.listEvents(),
      challenge: (await window.archiveHarness.getDocument("challenge_progress", "promise-mechanism-quest"))?.payload || null,
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
    const activeReviewStarted = event(
      "phone-review-active:started",
      "review_started",
      "2026-11-02T07:30:00.000Z",
      {
        sessionType: "review",
        sessionId: "phone-review-active",
        variantId: "thenable-get-vs-call:independent",
        gapId: "thenable-get-vs-call",
      },
    );
    await phone.page.evaluate(async ({ value, activeEvent }) => {
      await window.archiveHarness.addEvent(value);
      await window.archiveHarness.addEvent(activeEvent);
      await window.archiveHarness.putDocument({
        type: "review_session",
        key: "phone-review",
        payload: {
        schemaVersion: 1,
        sessionId: "phone-review",
        sessionType: "review",
        competencyId: "thenable-adoption",
        targetGapId: "thenable-get-vs-call",
        variantId: "thenable-get-vs-call:independent",
        status: "passed",
        attempts: 1,
        hintsUsed: 0,
      },
      });
      await window.archiveHarness.putDocument({
        type: "review_session",
        key: "phone-review-active",
        payload: {
        schemaVersion: 1,
        sessionId: "phone-review-active",
        sessionType: "review",
        competencyId: "thenable-adoption",
        targetGapId: "thenable-get-vs-call",
        targetGapEventIds: ["mac-run:attempt:thenable-adoption:1"],
        variantId: "thenable-get-vs-call:independent",
        status: "active",
        attempts: 0,
        hintsUsed: 0,
        selectedOptionId: null,
        startedAt: "2026-11-02T07:30:00.000Z",
        finishedAt: null,
      },
      });
      await window.archiveHarness.putDocument({
        type: "plan_preferences",
        key: "preferences",
        payload: { dailyMinutes: 40, focusTopicId: "promise" },
      });
    }, { value: reviewPass, activeEvent: activeReviewStarted });
    const phoneSync = await phone.page.evaluate(() => window.archiveHarness.sync());
    assert.ok(["synced", "syncing"].includes(phoneSync.status));
    await waitUntil(() => cloud.events.length === 3 && cloud.documents.size === 4,
      "phone events and all resumable documents to reach the cloud");

    // A genuinely empty WebKit storage context starts with no domain state and
    // performs pull-only restore. This is browser-engine + iPhone viewport
    // coverage, not a claim that a physical iPhone has been exercised.
    const { defaultBrowserType: _ignoredBrowserType, ...iphone13 } = devices["iPhone 13"];
    freshIPhone = await newDevice(safariBrowser, "WebKit iPhone cold start", { ...iphone13, locale: "zh-CN" }, { manualRestore: true });
    await freshIPhone.page.evaluate(() => {
      const { auth, service } = window.archiveHarness;
      const originalRequest = auth.request.bind(auth);
      let releaseProfile;
      let firstProfile = true;
      let profileCalls = 0;
      const profileGate = new Promise(resolveGate => { releaseProfile = resolveGate; });
      auth.request = async (path, options) => {
        if (path.endsWith("/get_learning_sync_profile")) profileCalls += 1;
        if (firstProfile && path.endsWith("/get_learning_sync_profile")) {
          firstProfile = false;
          await profileGate;
          return { authorized: false, user_id: "archive-test-user" };
        }
        return originalRequest(path, options);
      };
      window.archiveHarness.releaseProfile = releaseProfile;
      window.archiveHarness.profileCalls = () => profileCalls;
      // Hold an in-flight background sync before profile authorization. The
      // explicit restore must queue behind it rather than run concurrently.
      window.archiveHarness.initialSync = service.sync();
      window.archiveHarness.queuedRestore = service.restoreFromCloud();
    });
    await freshIPhone.page.waitForFunction(() =>
      window.archiveHarness.syncStatuses.includes("syncing") &&
      window.archiveHarness.profileCalls() === 1, null, { timeout: 5000 });
    assert.equal(await freshIPhone.page.evaluate(() => window.archiveHarness.profileCalls()), 1,
      "Restore must remain queued while the initial Sync is inside the profile request");
    await freshIPhone.page.evaluate(() => window.archiveHarness.releaseProfile());
    const coldFlow = await freshIPhone.page.evaluate(async () => ({
      initialSync: await window.archiveHarness.initialSync,
      restore: await window.archiveHarness.queuedRestore,
    }));
    assert.equal(coldFlow.initialSync.status, "pending-authorization");
    const coldRestore = coldFlow.restore;
    assert.equal(coldRestore.status, "restored");
    assert.equal(coldRestore.restoredEvents, 3);
    assert.equal(coldRestore.restoredDocuments, 4);
    const restoredIPhoneState = await freshIPhone.page.evaluate(async () => ({
      events: await window.archiveHarness.listEvents(),
      challenge: (await window.archiveHarness.getDocument("challenge_progress", "promise-mechanism-quest"))?.payload || null,
      activeReview: (await window.archiveHarness.getDocument("review_session", "phone-review-active"))?.payload || null,
      preferences: (await window.archiveHarness.getDocument("plan_preferences", "preferences"))?.payload || null,
    }));
    assert.equal(restoredIPhoneState.events.length, 3);
    assert.equal(restoredIPhoneState.challenge.currentStep, "thenable-adoption");
    assert.equal(restoredIPhoneState.activeReview.status, "active");
    assert.equal(restoredIPhoneState.activeReview.attempts, 0);
    assert.equal(restoredIPhoneState.preferences.dailyMinutes, 40);

    const macPull = await mac.page.evaluate(() => window.archiveHarness.sync());
    assert.ok(["synced", "syncing"].includes(macPull.status));
    // The shared background sync may have pulled this page before the explicit
    // call above. Assert the durable end state, not a timing-sensitive delta.
    await waitForAsyncPageCondition(mac.page, async () => {
      const events = await window.archiveHarness.listEvents();
      return events.length === 3 &&
        Boolean(await window.archiveHarness.getDocument("review_session", "phone-review-active"));
    }, { timeout: 10000, label: "Mac to merge the phone review archive" });
    const macMerged = await mac.page.evaluate(async () => ({
      events: await window.archiveHarness.listEvents(),
      review: (await window.archiveHarness.getDocument("review_session", "phone-review"))?.payload || null,
      activeReview: (await window.archiveHarness.getDocument("review_session", "phone-review-active"))?.payload || null,
      preferences: (await window.archiveHarness.getDocument("plan_preferences", "preferences"))?.payload || null,
    }));
    assert.equal(macMerged.events.length, 3);
    assert.ok(macMerged.events.some(row => row.type === "attempt" && row.correct === false));
    assert.ok(macMerged.events.some(row => row.type === "assessment_passed" && row.independent));
    assert.equal(macMerged.review.status, "passed");
    assert.equal(macMerged.activeReview.status, "active");
    assert.equal(macMerged.preferences.dailyMinutes, 40);
    assert.equal(cloud.events[0].user_seq < cloud.events[1].user_seq, true,
      "server sequence, not device wall-clock, defines incremental event order");
    assert.equal(Date.parse(cloud.events[1].occurred_at) < Date.parse(cloud.events[0].occurred_at), true,
      "test data intentionally contains a backwards device clock");

    await mac.page.evaluate(() => window.archiveHarness.sync());
    assert.equal(cloud.events.length, 3);

    await phone.context.setOffline(true);
    const offlineEvent = event(
      "phone-offline:attempt:2",
      "attempt",
      "2020-12-31T23:59:00.000Z",
      { correct: false, gapId: "thenable-get-vs-call", attemptNumber: 2 },
    );
    await phone.page.evaluate(value => window.archiveHarness.addEvent(value), offlineEvent);
    await waitForAsyncPageCondition(phone.page, async () => {
      const status = await window.archiveHarness.status();
      return status.pendingEvents >= 1;
    }, { label: "offline phone event to enter the local Outbox" });
    const offlineResult = await phone.page.evaluate(() => window.archiveHarness.sync());
    assert.equal(offlineResult.status, "offline");
    await phone.context.setOffline(false);
    const recovered = await phone.page.evaluate(() => window.archiveHarness.sync());
    assert.ok(["synced", "syncing"].includes(recovered.status));
    await waitForAsyncPageCondition(phone.page, async () => (await window.archiveHarness.status()).pendingEvents === 0,
      { timeout: 12000, label: "phone Outbox to drain after reconnecting" });
    await waitUntil(() => cloud.events.length === 4, "offline event to be acknowledged by cloud sync");

    await mac.page.evaluate(async () => {
      const row = await window.archiveHarness.getDocument("challenge_progress", "promise-mechanism-quest");
      const value = { ...row.payload, currentStep: "mac-second-step" };
      await window.archiveHarness.putDocument({
        type: "challenge_progress",
        key: "promise-mechanism-quest",
        payload: value,
        expectedLocalRevision: row.localRevision,
      });
    });
    await mac.page.evaluate(() => window.archiveHarness.capture());
    const macEdit = await mac.page.evaluate(() => window.archiveHarness.sync());
    assert.ok(["synced", "syncing"].includes(macEdit.status));
    await waitUntil(() => cloud.documents.get("challenge_progress:promise-mechanism-quest")?.revision === 2,
      "Mac challenge revision 2 to reach the cloud");

    const phoneBase = await phone.page.evaluate(async () =>
      window.archiveHarness.getDocument("challenge_progress", "promise-mechanism-quest"));
    const phonePayload = { ...phoneBase.payload, currentStep: "iphone-second-step" };
    await phone.page.evaluate(value => window.archiveHarness.putDocument({
      type: "challenge_progress",
      key: "promise-mechanism-quest",
      payload: value.payload,
      expectedLocalRevision: value.localRevision,
    }), { payload: phonePayload, localRevision: phoneBase.localRevision });

    await phone.page.evaluate(() => window.archiveHarness.capture());
    const conflictSync = await phone.page.evaluate(() => window.archiveHarness.sync());
    assert.ok(["synced", "syncing"].includes(conflictSync.status));
    await waitForAsyncPageCondition(phone.page, async () => (await window.archiveHarness.conflicts()).length === 1,
      { timeout: 12000, label: "the expected archive conflict to be recorded" });
    const conflicts = await phone.page.evaluate(() => window.archiveHarness.conflicts());
    assert.equal(conflicts.length, 1);

    await phone.page.evaluate(id => window.archiveHarness.resolve(id, "local"), conflicts[0].id);
    const resolved = await phone.page.evaluate(() => window.archiveHarness.sync());
    assert.ok(["synced", "syncing"].includes(resolved.status));
    await waitUntil(() => cloud.documents.get("challenge_progress:promise-mechanism-quest")?.revision === 3,
      "resolved iPhone document revision 3 to reach the cloud");
    await waitForAsyncPageCondition(phone.page, async () => (await window.archiveHarness.conflicts()).length === 0,
      { timeout: 12000, label: "the resolved archive conflict to be cleared" });
    const cloudChallenge = cloud.documents.get("challenge_progress:promise-mechanism-quest");
    assert.equal(cloudChallenge.document_payload.currentStep, "iphone-second-step");
    assert.equal(cloudChallenge.revision, 3);

    assert.deepEqual(mac.errors, [], "Mac browser should not throw uncaught exceptions");
    assert.deepEqual(phone.errors, [], "iPhone-sized browser should not throw uncaught exceptions");
    assert.deepEqual(freshIPhone.errors, [], "WebKit iPhone cold restore should not throw uncaught exceptions");
  } finally {
    await mac?.context.close();
    await phone?.context.close();
    await freshIPhone?.context.close();
    await safariBrowser.close();
    await browser.close();
  }
});
