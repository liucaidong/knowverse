import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const scenario = JSON.parse(await readFile(new URL("lab/experiments/promise-debugger/scenario.json", root), "utf8"));

assert.equal(scenario.id, "thenable-inner-adoption");
assert.ok(scenario.steps.length >= 14, "debugger should expose at least 14 trace frames");
assert.deepEqual(
  scenario.expectedOutput,
  ["start", "get", "end", "call", "M1", "M2", "value 42"]
);

for (const [index, step] of scenario.steps.entries()) {
  assert.ok(step.title, `step ${index + 1} needs a title`);
  assert.ok(step.explain, `step ${index + 1} needs a mechanism explanation`);
  assert.ok(Array.isArray(step.queue), `step ${index + 1} needs a FIFO queue snapshot`);
  assert.ok(Array.isArray(step.stack), `step ${index + 1} needs a call stack snapshot`);
  assert.ok(Array.isArray(step.states) && step.states.length === 2, `step ${index + 1} needs inner/outer state`);
  if (step.line !== null) {
    assert.ok(step.line >= 1 && step.line <= scenario.code.length, `step ${index + 1} line is outside source`);
  }
}

const logs = [];
let finish;
const inner = new Promise(resolve => { finish = resolve; });
const thenable = {
  get then() {
    logs.push("get");
    return (resolve, reject) => {
      logs.push("call");
      resolve(inner);
      reject(new Error("late"));
      throw new Error("thenable-throw");
    };
  }
};

logs.push("start");
const outer = Promise.resolve(thenable);
outer.then(value => logs.push("value " + value));
queueMicrotask(() => {
  logs.push("M1");
  finish(42);
  queueMicrotask(() => logs.push("M2"));
});
logs.push("end");
await new Promise(resolve => setTimeout(resolve, 0));

assert.deepEqual(logs, scenario.expectedOutput, "native Promise output must match the debugger trace");
assert.deepEqual(scenario.steps.at(-1).logs, scenario.expectedOutput, "final frame must match expected output");

const byTitle = title => scenario.steps.find(step => step.title === title);
assert.deepEqual(byTitle("同步脚本结束").queue.map(job => job.name), ["ThenableJob", "M1"]);
assert.deepEqual(byTitle("执行 M1：兑现 inner，并安排 M2").queue.map(job => job.name), ["AdoptInnerJob", "M2"]);
assert.deepEqual(byTitle("执行 AdoptInnerJob：订阅已兑现的 inner").queue.map(job => job.name), ["M2", "InnerReactionJob"]);
assert.deepEqual(byTitle("执行 InnerReactionJob：outer fulfilled").queue.map(job => job.name), ["OuterReactionJob"]);

console.log("PASS: Promise debugger trace snapshots + native Promise FIFO order");
