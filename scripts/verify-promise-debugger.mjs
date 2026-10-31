import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const encoded = [1, 2, 3, 4].map(index => {
  const path = new URL("../lab/experiments/promise-debugger/workbench.bundle.part-" + String(index).padStart(2, "0") + ".b64", import.meta.url);
  return readFileSync(path, "utf8").trim();
}).join("");
const bundle = JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
assert.equal(bundle.format, "knowverse-promise-workbench-bundle-v1");
assert.ok(bundle.debugger.includes('from "./scenarios.mjs"'));
assert.ok(bundle.worker.includes('from "./runtime.mjs"'));
assert.ok(bundle.css.length > 5000);

const moduleUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const loaded = await Promise.all([import(moduleUrl(bundle.runtime)), import(moduleUrl(bundle.scenarios))]);
const TraceRuntime = loaded[0].TraceRuntime;
const scenarios = loaded[1].scenarios;
assert.equal(scenarios.length, 13);
assert.equal(new Set(scenarios.map(item => item.id)).size, scenarios.length);

for (const scenario of scenarios) {
  const runtime = new TraceRuntime();
  const events = runtime.run(scenario.code);
  assert.deepEqual(runtime.logs, scenario.expected, scenario.id + ": TracePromise output");
  assert.ok(events.length > 8, scenario.id + ": inspectable runtime events");
  assert.ok(events.some(event => event.type === "script-start"), scenario.id + ": script start");
  assert.ok(events.some(event => event.type === "complete"), scenario.id + ": completion");
  for (const event of events) {
    assert.ok(Array.isArray(event.promises), scenario.id + ": Promise snapshots");
    assert.ok(Array.isArray(event.queue), scenario.id + ": FIFO snapshot");
    assert.ok(Array.isArray(event.stack), scenario.id + ": call stack snapshot");
  }
}

const nativeFormat = value => {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  if (value instanceof Error) return value.name + ": " + value.message;
  if (Array.isArray(value)) return "[" + value.map(nativeFormat).join(", ") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).join(", ") + "}";
  return String(value);
};
for (const scenario of scenarios) {
  const nativeLogs = [];
  const nativeConsole = {
    log: (...args) => nativeLogs.push(args.map(nativeFormat).join(" ")),
    warn: (...args) => nativeLogs.push("⚠ " + args.map(nativeFormat).join(" ")),
    error: (...args) => nativeLogs.push("✖ " + args.map(nativeFormat).join(" "))
  };
  const execute = new Function("Promise", "queueMicrotask", "setTimeout", "console", "AggregateError", scenario.code);
  execute(Promise, queueMicrotask, setTimeout, nativeConsole, AggregateError);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.deepEqual(nativeLogs, scenario.expected, scenario.id + ": native Promise observable output");
}

const thenable = new TraceRuntime();
thenable.run(scenarios.find(item => item.id === "thenable-adoption").code);
assert.equal(thenable.logs.filter(line => line === "get then").length, 1);
const thenGet = thenable.events.findIndex(event => event.type === "then-get");
const scriptEnd = thenable.events.findIndex(event => event.type === "script-end");
const thenCall = thenable.events.findIndex(event => event.type === "thenable-call");
assert.ok(thenGet < scriptEnd && thenCall > scriptEnd);
assert.ok(thenable.events.some(event => event.type === "thenable-throw"));

const lock = new TraceRuntime();
lock.run(scenarios.find(item => item.id === "resolve-lock").code);
assert.ok(lock.events.some(event => event.type === "reject-ignored"));
assert.ok(lock.events.some(event => event.type === "resolve-ignored"));
assert.ok(lock.events.some(event => event.type === "executor-throw"));

const empty = new TraceRuntime();
empty.run(scenarios.find(item => item.id === "empty-combinators").code);
assert.equal(empty.events.at(-1).promises.find(item => item.name === "Promise.race").state, "pending");
const any = new TraceRuntime();
any.run(scenarios.find(item => item.id === "combinator-any").code);
assert.ok(any.events.some(event => event.detail.includes("AggregateError")));

console.log("PASS: Promise workbench runtime, " + scenarios.length + " scenarios, native differential output, resolution and FIFO invariants");
