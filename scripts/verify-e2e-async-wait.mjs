import assert from "node:assert/strict";
import test from "node:test";
import { waitForAsyncPageCondition } from "./helpers/wait-for-async-page-condition.mjs";

function createPage() {
  return {
    closed: false,
    isClosed() { return this.closed; },
    async evaluate(predicate, arg) { return await predicate(arg); },
    async waitForTimeout(milliseconds) {
      await new Promise(resolve => setTimeout(resolve, milliseconds));
    },
  };
}

test("async false results are awaited and never treated as truthy promises", async () => {
  const page = createPage();
  let reads = 0;
  const result = await waitForAsyncPageCondition(page, async expected => {
    await new Promise(resolve => setTimeout(resolve, 2));
    reads += 1;
    return reads >= expected ? { persisted: true, reads } : false;
  }, { arg: 3, polling: 10, timeout: 500, label: "three durable reads" });

  assert.deepEqual(result, { persisted: true, reads: 3 });
  assert.equal(reads, 3);
});

test("async conditions report a useful timeout instead of passing a pending promise", async () => {
  const page = createPage();
  let reads = 0;
  await assert.rejects(
    waitForAsyncPageCondition(page, async () => {
      await new Promise(resolve => setTimeout(resolve, 2));
      reads += 1;
      return false;
    }, { polling: 10, timeout: 60, label: "a condition that never becomes true" }),
    /Timed out waiting for a condition that never becomes true/,
  );
  assert.ok(reads >= 2);
});

test("closed pages fail fast with the awaited condition label", async () => {
  const page = createPage();
  page.closed = true;
  await assert.rejects(
    waitForAsyncPageCondition(page, async () => true, { label: "a durable write" }),
    /Page closed while waiting for a durable write/,
  );
});
