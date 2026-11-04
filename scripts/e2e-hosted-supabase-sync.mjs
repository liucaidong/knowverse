#!/usr/bin/env node
/**
 * Hosted KNOWVERSE N2 sync acceptance against the isolated staging project.
 *
 * Safety:
 * - Refuses every Supabase origin except the pinned staging project.
 * - Uses only public publishable key + synthetic Auth credentials from env.
 * - Never prints credentials, JWTs, or request bodies.
 * - Creates only uniquely named synthetic rows. Delete the two test Auth users
 *   in Supabase Dashboard after acceptance; FK cascades remove their test rows.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const STAGING_ORIGIN = "https://ypthoicwrfsblaidllyy.supabase.co";
const REQUEST_TIMEOUT_MS = 15_000;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function validateConfig() {
  const configuredUrl = required("N2_SUPABASE_URL");
  let parsed;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    throw new Error("N2_SUPABASE_URL must be a valid HTTPS URL.");
  }
  if (parsed.origin !== STAGING_ORIGIN || parsed.pathname !== "/" ||
      parsed.search || parsed.hash || parsed.protocol !== "https:") {
    throw new Error("Safety stop: this harness only permits the pinned KNOWVERSE staging Supabase origin.");
  }

  const key = required("N2_SUPABASE_PUBLISHABLE_KEY");
  const accountA = {
    email: required("N2_SYNC_A_EMAIL"),
    password: required("N2_SYNC_A_PASSWORD"),
  };
  const accountB = {
    email: required("N2_SYNC_B_EMAIL"),
    password: required("N2_SYNC_B_PASSWORD"),
  };
  assert.notEqual(accountA.email.toLowerCase(), accountB.email.toLowerCase(),
    "Account A and B must use different synthetic email addresses.");
  assert.match(accountA.email, /^n2-sync-a@knowverse-test\.invalid$/i,
    "Account A must use the designated synthetic staging email.");
  assert.match(accountB.email, /^n2-sync-b@knowverse-test\.invalid$/i,
    "Account B must use the designated synthetic staging email.");
  assert.notEqual(accountA.password, accountB.password,
    "Use separate temporary passwords for the two synthetic accounts.");

  return { key, accountA, accountB };
}

function parseBody(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

function describeApiError(status, data) {
  const code = data && typeof data === "object"
    ? data.code || data.error_code || data.error?.code || null
    : null;
  const message = data && typeof data === "object"
    ? data.message || data.msg || data.error_description || data.error?.message || "Supabase request failed"
    : "Supabase request failed";
  let safe = String(message);
  for (const secret of [
    process.env.N2_SYNC_A_PASSWORD,
    process.env.N2_SYNC_B_PASSWORD,
  ].filter(Boolean)) safe = safe.split(secret).join("[REDACTED]");
  safe = safe.replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[JWT REDACTED]");
  return { status, code, message: safe };
}

async function http(path, { key, accessToken = null, method = "GET", body } = {}) {
  const response = await fetch(STAGING_ORIGIN + path, {
    method,
    headers: {
      apikey: key,
      Accept: "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = parseBody(await response.text());
  return { ok: response.ok, status: response.status, data };
}

function assertHttpOk(result, label) {
  if (!result.ok) {
    const error = describeApiError(result.status, result.data);
    throw new Error(`${label}: HTTP ${error.status}${error.code ? ` [${error.code}]` : ""}: ${error.message}`);
  }
  return result.data;
}

async function signIn(account, key) {
  const result = await http("/auth/v1/token?grant_type=password", {
    key,
    method: "POST",
    body: { email: account.email, password: account.password },
  });
  const session = assertHttpOk(result, `Auth login failed for ${account.email}`);
  assert.ok(session?.access_token, `Auth login did not return an access token for ${account.email}`);
  assert.ok(session?.user?.id, `Auth login did not return a user ID for ${account.email}`);
  assert.equal(String(session.user.email || "").toLowerCase(), account.email.toLowerCase(),
    `Auth returned an unexpected user for ${account.email}`);
  assert.ok(session.user.email_confirmed_at,
    `Synthetic Auth user ${account.email} is not email-confirmed; create it with Auto Confirm User enabled.`);
  return { id: session.user.id, email: account.email, token: session.access_token };
}

async function rpc(actor, name, body) {
  const result = await http(`/rest/v1/rpc/${name}`, {
    key: CONFIG.key,
    accessToken: actor.token,
    method: "POST",
    body,
  });
  return assertHttpOk(result, `${actor.email} RPC ${name}`);
}

async function expectDenied(actor, name, body, expectedMessage) {
  const result = await http(`/rest/v1/rpc/${name}`, {
    key: CONFIG.key,
    accessToken: actor.token,
    method: "POST",
    body,
  });
  assert.equal(result.ok, false, `${actor.email} must be denied by ${name}`);
  const error = describeApiError(result.status, result.data);
  assert.equal(error.code, "42501",
    `${name} should fail with PostgreSQL 42501; got HTTP ${error.status} ${error.code || ""}: ${error.message}`);
  assert.match(error.message, new RegExp(expectedMessage, "i"),
    `${name} returned an unexpected authorization failure: ${error.message}`);
}

async function restGet(actor, resource, params) {
  const query = new URLSearchParams(params);
  const result = await http(`/rest/v1/${resource}?${query.toString()}`, {
    key: CONFIG.key,
    accessToken: actor.token,
  });
  return assertHttpOk(result, `${actor.email} GET ${resource}`);
}

function newEvent() {
  const id = `n2-${randomUUID()}`;
  return {
    id,
    type: "activity",
    topicId: "n2-hosted-supabase-acceptance",
    competencyIds: [],
    at: new Date().toISOString(),
    eventSchemaVersion: 3,
    causationEventIds: [],
    targetGapEventIds: [],
    gapObservationId: null,
  };
}

function step(name) {
  console.log(`PASS  ${name}`);
}

let CONFIG;

async function main() {
  CONFIG = validateConfig();
  console.log("KNOWVERSE N2 hosted Supabase acceptance");
  console.log(`Target: ${STAGING_ORIGIN}`);
  console.log("Credentials and JWTs are not logged.");

  const accountA = await signIn(CONFIG.accountA, CONFIG.key);
  const accountB = await signIn(CONFIG.accountB, CONFIG.key);
  assert.notEqual(accountA.id, accountB.id, "Synthetic accounts must resolve to different Auth user IDs.");
  const profileA = await rpc(accountA, "get_learning_sync_profile", {});
  const profileB = await rpc(accountB, "get_learning_sync_profile", {});
  assert.equal(profileA?.authorized, true, "Account A is not present in private.authorized_users.");
  assert.equal(profileB?.authorized, true, "Account B is not present in private.authorized_users.");
  assert.equal(profileA.user_id, accountA.id);
  assert.equal(profileB.user_id, accountB.id);
  step("A/B Auth login, confirmed email, distinct identities, and staging allowlist");

  const deviceA1 = randomUUID();
  const deviceA2 = randomUUID();
  const deviceB1 = randomUUID();
  for (const [actor, device, label, platform] of [
    [accountA, deviceA1, "N2 staging desktop A", "desktop-web"],
    [accountA, deviceA2, "N2 staging second device A", "mobile-web"],
    [accountB, deviceB1, "N2 staging account B", "desktop-web"],
  ]) {
    const registered = await rpc(actor, "register_device", {
      p_device_id: device,
      p_label: label,
      p_platform: platform,
    });
    assert.equal(registered?.registered, true, `Device registration failed for ${actor.email}`);
  }
  step("Two devices registered for A and one device registered for B");

  const event1 = newEvent();
  const event2 = newEvent();
  const documentId = `n2-plan-preferences-${randomUUID()}`;
  const documentKey = `n2-hosted-${randomUUID()}`;
  const payloadV1 = {
    source: "hosted-supabase-n2-e2e",
    runId: randomUUID(),
    preference: "initial",
  };
  const payloadV2 = {
    source: "hosted-supabase-n2-e2e",
    runId: payloadV1.runId,
    preference: "resolved-after-cas",
  };
  const firstCommit = await rpc(accountA, "sync_commit_learning_batch", {
    p_device_id: deviceA1,
    p_expected_user_id: accountA.id,
    p_events: [{ event_id: event1.id, device_seq: 1, event_payload: event1 }],
    p_documents: [{
      document_id: documentId,
      document_type: "plan_preferences",
      document_key: documentKey,
      base_revision: 0,
      local_revision: 1,
      document_payload: payloadV1,
    }],
  });
  assert.equal(firstCommit?.status, "committed", "Initial event/document batch did not commit.");
  assert.equal(firstCommit.events?.confirmed?.[0]?.event_id, event1.id);
  assert.equal(firstCommit.documents?.confirmed?.[0]?.document_id, documentId);
  step("Atomic event + document batch committed to hosted PostgreSQL");

  const [pulledEvents, pulledDocuments] = await Promise.all([
    rpc(accountA, "sync_pull_learning_events_for_account", {
      p_expected_user_id: accountA.id, p_after_user_seq: 0, p_page_size: 100,
    }),
    rpc(accountA, "sync_pull_learning_documents_for_account", {
      p_expected_user_id: accountA.id, p_after_document_seq: 0, p_page_size: 100,
    }),
  ]);
  assert.ok(pulledEvents.events?.some(row => row.event_id === event1.id),
    "Second device did not pull Account A's committed event.");
  const pulledDocument = pulledDocuments.documents?.find(row => row.document_id === documentId);
  assert.ok(pulledDocument, "Second device did not pull Account A's committed document.");
  assert.deepEqual(pulledDocument.document_payload, payloadV1);
  await rpc(accountA, "register_device", {
    p_device_id: deviceA2, p_label: "KNOWVERSE A second device", p_platform: "mobile-web",
  });
  step("A's second device pulled the same account's event and document");

  const duplicateCommit = await rpc(accountA, "sync_commit_learning_batch", {
    p_device_id: deviceA2,
    p_expected_user_id: accountA.id,
    p_events: [{ event_id: event1.id, device_seq: 1, event_payload: event1 }],
    p_documents: [{
      document_id: documentId,
      document_type: "plan_preferences",
      document_key: documentKey,
      base_revision: 0,
      local_revision: 1,
      document_payload: payloadV1,
    }],
  });
  assert.equal(duplicateCommit?.status, "committed");
  assert.equal(duplicateCommit.events?.confirmed?.[0]?.duplicate, true,
    "Identical event retry was not acknowledged as a duplicate.");
  assert.equal(duplicateCommit.documents?.confirmed?.[0]?.document_id, documentId,
    "Identical document retry was not acknowledged.");
  step("Cross-device identical event/document retry is idempotent");

  const staleConflict = await rpc(accountA, "sync_commit_learning_batch", {
    p_device_id: deviceA1,
    p_expected_user_id: accountA.id,
    p_events: [{ event_id: event2.id, device_seq: 2, event_payload: event2 }],
    p_documents: [{
      document_id: documentId,
      document_type: "plan_preferences",
      document_key: documentKey,
      base_revision: 0,
      local_revision: 2,
      document_payload: payloadV2,
    }],
  });
  assert.equal(staleConflict?.status, "conflict", "Stale document revision did not produce a CAS conflict.");
  assert.equal(staleConflict.events?.confirmed?.length, 0,
    "Event in a CAS-conflicted atomic batch must not be confirmed.");
  assert.equal(staleConflict.documents?.conflicts?.[0]?.document_id, documentId);
  const eventAfterConflict = await restGet(accountA, "learning_events", {
    select: "event_id",
    event_id: `eq.${event2.id}`,
  });
  assert.equal(eventAfterConflict.length, 0,
    "Event from a CAS-conflicted batch was persisted; atomic rollback failed.");
  const documentAfterConflict = await restGet(accountA, "learning_archive_documents", {
    select: "document_id,revision,document_payload",
    document_id: `eq.${documentId}`,
  });
  assert.equal(documentAfterConflict?.[0]?.revision, 1,
    "Document revision changed despite a CAS-conflicted atomic batch.");
  assert.deepEqual(documentAfterConflict?.[0]?.document_payload, payloadV1);
  step("Stale CAS conflict rolls back the entire event + document batch");

  const resolvedCommit = await rpc(accountA, "sync_commit_learning_batch", {
    p_device_id: deviceA1,
    p_expected_user_id: accountA.id,
    p_events: [{ event_id: event2.id, device_seq: 2, event_payload: event2 }],
    p_documents: [{
      document_id: documentId,
      document_type: "plan_preferences",
      document_key: documentKey,
      base_revision: 1,
      local_revision: 2,
      document_payload: payloadV2,
    }],
  });
  assert.equal(resolvedCommit?.status, "committed", "Corrected CAS retry did not commit.");
  const finalEvent = await restGet(accountA, "learning_events", {
    select: "event_id",
    event_id: `eq.${event2.id}`,
  });
  const finalDocument = await restGet(accountA, "learning_archive_documents", {
    select: "document_id,revision,document_payload",
    document_id: `eq.${documentId}`,
  });
  assert.equal(finalEvent.length, 1);
  assert.equal(finalDocument?.[0]?.revision, 2);
  assert.deepEqual(finalDocument?.[0]?.document_payload, payloadV2);
  step("Corrected CAS retry commits revision 2 and the previously blocked event");

  const [accountBEvents, accountBDocuments] = await Promise.all([
    restGet(accountB, "learning_events", {
      select: "event_id", event_id: `in.(${event1.id},${event2.id})`,
    }),
    restGet(accountB, "learning_archive_documents", {
      select: "document_id", document_id: `eq.${documentId}`,
    }),
  ]);
  assert.equal(accountBEvents.length, 0, "Account B can read Account A's events.");
  assert.equal(accountBDocuments.length, 0, "Account B can read Account A's archive document.");
  await expectDenied(accountB, "sync_pull_learning_events_for_account", {
    p_expected_user_id: accountA.id, p_after_user_seq: 0, p_page_size: 100,
  }, "account_changed_during_sync");
  await expectDenied(accountB, "sync_pull_learning_documents_for_account", {
    p_expected_user_id: accountA.id, p_after_document_seq: 0, p_page_size: 100,
  }, "account_changed_during_sync");
  await expectDenied(accountB, "sync_commit_learning_batch", {
    p_device_id: deviceA1,
    p_expected_user_id: accountB.id,
    p_events: [],
    p_documents: [],
  }, "device_not_registered_or_revoked");
  step("Account B cannot read A's rows, spoof A's identity, or use A's device");

  console.log("");
  console.log("RESULT: PASS");
  console.log("Verified: Auth/JWT, allowlist, device registration, atomic commit, cross-device pull,");
  console.log("idempotent retry, CAS batch rollback + recovery, RLS isolation, identity and device spoof rejection.");
  console.log("Cleanup: delete the two synthetic Auth users in Supabase Dashboard; dependent staging rows cascade.");
}

main().catch(error => {
  console.error("RESULT: FAIL");
  console.error(error instanceof Error ? error.message : "Unexpected error");
  process.exitCode = 1;
});
