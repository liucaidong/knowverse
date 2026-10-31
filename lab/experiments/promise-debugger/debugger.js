import scenario from "./scenario.json" with { type: "json" };

const $ = (id) => document.getElementById(id);
const ui = {
  source: $("source-code"),
  console: $("console-output"),
  title: $("stage-title"),
  phase: $("phase-badge"),
  action: $("stage-action"),
  explain: $("stage-explain"),
  tags: $("stage-tags"),
  frameCount: $("frame-count"),
  scrubber: $("scrubber"),
  states: $("promise-states"),
  queue: $("microtask-queue"),
  stack: $("call-stack"),
  reaction: $("reaction-state"),
  timers: $("timer-queue"),
  prev: $("step-prev"),
  next: $("step-next"),
  play: $("play"),
  reset: $("reset"),
  verify: $("verify-native"),
  verifyResult: $("verify-result")
};

let frame = 0;
let playback = null;
const relatedLines = new Set([8,9,10,11,12,13,20,23,24,25]);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderSource(step) {
  ui.source.replaceChildren();
  scenario.code.forEach((line, index) => {
    const row = element("div", "code-line");
    if (step.line === index + 1) row.classList.add("current");
    else if (relatedLines.has(index + 1) && step.phase === "microtask") row.classList.add("related");
    const number = element("span", "line-no", String(index + 1).padStart(2, "0"));
    const code = element("code", "", line || " ");
    row.append(number, code);
    ui.source.append(row);
  });
  const active = ui.source.querySelector(".current");
  if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function renderLogs(logs) {
  ui.console.replaceChildren();
  if (!logs.length) {
    ui.console.append(element("div", "console-empty", "等待第一条 console 输出…"));
    return;
  }
  logs.forEach((value, index) => {
    const row = element("div", "console-row");
    row.append(element("span", "console-index", String(index + 1).padStart(2, "0")));
    row.append(element("span", "console-value", value));
    ui.console.append(row);
  });
}

function renderStates(states) {
  ui.states.replaceChildren();
  states.forEach(state => {
    const card = element("article", "promise-card");
    card.append(element("div", "promise-name", state.name));
    const status = element("div", "promise-status", state.status);
    if (state.status.includes("fulfilled")) status.classList.add("fulfilled");
    else if (state.status.includes("pending")) status.classList.add("pending");
    card.append(status, element("div", "promise-detail", state.detail));
    ui.states.append(card);
  });
}

function renderQueue(queue) {
  ui.queue.replaceChildren();
  if (!queue.length) {
    ui.queue.append(element("div", "queue-empty", "微任务队列为空"));
    return;
  }
  queue.forEach((job, index) => {
    const row = element("div", "queue-item");
    row.append(element("span", "queue-index", String(index + 1)));
    const type = element("span", "queue-type", job.kind === "reaction" ? "REACTION" : job.kind === "adopt" ? "ADOPT" : job.kind === "thenable" ? "THENABLE" : "MICRO");
    if (job.kind === "adopt") type.classList.add("adopt");
    if (job.kind === "reaction") type.classList.add("reaction");
    const copy = element("div");
    copy.append(element("strong", "", job.name), element("small", "", job.detail));
    row.append(type, copy);
    ui.queue.append(row);
  });
}

function renderStack(stack) {
  ui.stack.replaceChildren();
  if (!stack.length) {
    ui.stack.append(element("div", "stack-empty", "当前调用栈已清空"));
    return;
  }
  [...stack].reverse().forEach((item, index) => {
    const node = element("div", "stack-item", item);
    if (index === 0) node.classList.add("top");
    ui.stack.append(node);
  });
}

function renderTimers(items) {
  ui.timers.replaceChildren();
  if (!items.length) {
    ui.timers.append(element("div", "timer-empty", "本案例没有注册计时器任务"));
    return;
  }
  items.forEach(item => ui.timers.append(element("span", "timer-chip", item)));
}

function renderScrubber() {
  ui.scrubber.replaceChildren();
  scenario.steps.forEach((step, index) => {
    const button = element("button", "scrub-dot", String(index + 1));
    button.type = "button";
    button.title = step.title;
    button.setAttribute("aria-label", "跳转到第 " + (index + 1) + " 阶段：" + step.title);
    if (index < frame) button.classList.add("done");
    if (index === frame) {
      button.classList.add("active");
      button.setAttribute("aria-current", "step");
    }
    button.addEventListener("click", () => {
      stopPlayback();
      frame = index;
      render();
    });
    ui.scrubber.append(button);
  });
}

function render() {
  const step = scenario.steps[frame];
  ui.title.textContent = step.title;
  ui.phase.textContent = step.phaseLabel;
  ui.action.textContent = step.action;
  ui.explain.textContent = step.explain;
  ui.tags.replaceChildren(...step.tags.map(tag => element("span", "tag", tag)));
  ui.frameCount.textContent = "阶段 " + (frame + 1) + " / " + scenario.steps.length;
  renderSource(step);
  renderLogs(step.logs);
  renderStates(step.states);
  renderQueue(step.queue);
  renderStack(step.stack);
  renderTimers(step.timerQueue);
  ui.reaction.textContent = step.reactions.join(" · ");
  ui.prev.disabled = frame === 0;
  ui.next.disabled = frame === scenario.steps.length - 1;
  renderScrubber();
}

function stopPlayback() {
  if (playback !== null) {
    clearInterval(playback);
    playback = null;
  }
  ui.play.textContent = "▶ 自动播放";
}

function next() {
  if (frame < scenario.steps.length - 1) {
    frame += 1;
    render();
  } else {
    stopPlayback();
  }
}

function startPlayback() {
  if (playback !== null) return;
  if (frame === scenario.steps.length - 1) frame = 0;
  ui.play.textContent = "Ⅱ 暂停";
  render();
  playback = setInterval(() => {
    if (frame >= scenario.steps.length - 1) {
      stopPlayback();
      return;
    }
    next();
  }, 1050);
}

ui.prev.addEventListener("click", () => {
  stopPlayback();
  frame = Math.max(0, frame - 1);
  render();
});
ui.next.addEventListener("click", () => {
  stopPlayback();
  next();
});
ui.play.addEventListener("click", () => playback === null ? startPlayback() : stopPlayback());
ui.reset.addEventListener("click", () => {
  stopPlayback();
  frame = 0;
  ui.verifyResult.className = "verify-result";
  ui.verifyResult.textContent = "尚未运行原生验证。";
  render();
});

async function runNativeVerification() {
  stopPlayback();
  ui.verify.disabled = true;
  ui.verify.textContent = "正在运行真实 Promise…";
  ui.verifyResult.className = "verify-result";
  ui.verifyResult.textContent = "浏览器正在执行案例代码，并等待微任务检查点完成。";

  const nativeLogs = [];
  let finish;
  const inner = new Promise(resolve => {
    finish = resolve;
  });

  const thenable = {
    get then() {
      nativeLogs.push("get");
      return (resolve, reject) => {
        nativeLogs.push("call");
        resolve(inner);
        reject(new Error("late"));
        throw new Error("thenable-throw");
      };
    }
  };

  nativeLogs.push("start");
  const outer = Promise.resolve(thenable);
  outer.then(value => nativeLogs.push("value " + value));

  queueMicrotask(() => {
    nativeLogs.push("M1");
    finish(42);
    queueMicrotask(() => nativeLogs.push("M2"));
  });

  nativeLogs.push("end");

  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    const passed = JSON.stringify(nativeLogs) === JSON.stringify(scenario.expectedOutput);
    ui.verifyResult.className = "verify-result " + (passed ? "pass" : "fail");
    ui.verifyResult.textContent =
      (passed ? "✓ 原生验证通过。实际输出与逐帧模型一致。" : "✕ 输出不一致，请检查执行模型。") +
      "\n实际：" + nativeLogs.join(" → ") +
      "\n预期：" + scenario.expectedOutput.join(" → ");
  } catch (error) {
    ui.verifyResult.className = "verify-result fail";
    ui.verifyResult.textContent = "原生验证发生异常：" + error.message;
  } finally {
    ui.verify.disabled = false;
    ui.verify.textContent = "在当前浏览器运行原生代码 ↗";
  }
}

ui.verify.addEventListener("click", runNativeVerification);
document.addEventListener("keydown", event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName)) return;
  if (event.key === "ArrowRight") {
    event.preventDefault();
    stopPlayback();
    next();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    stopPlayback();
    frame = Math.max(0, frame - 1);
    render();
  } else if (event.key === "Home") {
    event.preventDefault();
    stopPlayback();
    frame = 0;
    render();
  } else if (event.key === " ") {
    event.preventDefault();
    playback === null ? startPlayback() : stopPlayback();
  }
});

render();
