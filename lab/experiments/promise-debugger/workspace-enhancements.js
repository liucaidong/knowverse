const $ = selector => document.querySelector(selector);
const diffTarget = $("#step-diff-content");
const diffStatus = $("#step-diff-status");
const watchedPanels = [
  { key: "promise", label: "Promise 对象", selector: "#promise-graph", panel: ".promise-panel" },
  { key: "queue", label: "微任务 FIFO", selector: "#queue-content", panel: ".queue-panel" },
  { key: "stack", label: "调用栈", selector: "#stack-content", panel: ".stack-panel" },
  { key: "timer", label: "计时器", selector: "#timer-content", panel: ".stack-panel" },
  { key: "console", label: "控制台", selector: "#console-output", panel: ".console-panel" }
];

function normalizeText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\r/g, "").split("\n").map(line => line.trim()).filter(Boolean);
}

function capture(element) {
  if (!element) return { text: "", signature: "" };
  const text = (element.innerText || element.textContent || "").trim();
  const signature = Array.from(element.querySelectorAll("*")).map(node => {
    const className = typeof node.className === "string" ? node.className : "";
    const state = node.getAttribute("data-state") || "";
    return node.tagName + "." + className + ":" + state;
  }).join("|");
  return { text, signature };
}

function snapshot() {
  const promise = capture($("#promise-graph"));
  const selected = capture($("#selected-promise"));
  return {
    event: capture($("#current-event")).text,
    promise: { text: promise.text + (selected.text ? "\n选中对象：" + selected.text : ""), signature: promise.signature + "|" + selected.signature },
    queue: capture($("#queue-content")),
    stack: capture($("#stack-content")),
    timer: capture($("#timer-content")),
    console: capture($("#console-output"))
  };
}

function lineDifference(beforeText, afterText) {
  const before = normalizeText(beforeText);
  const remaining = before.slice();
  const added = [];
  normalizeText(afterText).forEach(line => {
    const index = remaining.indexOf(line);
    if (index >= 0) remaining.splice(index, 1);
    else added.push(line);
  });
  return { removed: remaining, added };
}

function appendLine(container, kind, value) {
  const row = document.createElement("div");
  row.className = "diff-line " + kind;
  const symbol = document.createElement("span");
  symbol.className = "diff-symbol";
  symbol.textContent = kind === "added" ? "+" : kind === "removed" ? "−" : "·";
  const text = document.createElement("span");
  text.textContent = value;
  row.append(symbol, text);
  container.append(row);
}

function appendGroup(root, label, difference, structuralOnly) {
  const group = document.createElement("section");
  group.className = "diff-group";
  const head = document.createElement("div");
  head.className = "diff-head";
  const title = document.createElement("span");
  title.textContent = label;
  const count = document.createElement("span");
  count.className = "diff-count";
  count.textContent = "+" + difference.added.length + " / −" + difference.removed.length;
  head.append(title, count);
  group.append(head);
  if (difference.removed.length || difference.added.length) {
    difference.removed.slice(0, 2).forEach(line => appendLine(group, "removed", line));
    difference.added.slice(0, 3).forEach(line => appendLine(group, "added", line));
    const hidden = Math.max(0, difference.removed.length - 2) + Math.max(0, difference.added.length - 3);
    if (hidden) appendLine(group, "neutral", "另有 " + hidden + " 项变化，展开对应面板查看");
  } else if (structuralOnly) {
    appendLine(group, "neutral", "对象节点或状态标记发生变化（文本未变化）");
  }
  root.append(group);
}

function flashPanel(selector) {
  const panel = $(selector);
  if (!panel) return;
  panel.classList.remove("step-changed");
  void panel.offsetWidth;
  panel.classList.add("step-changed");
  window.setTimeout(() => panel.classList.remove("step-changed"), 760);
}

let previous = snapshot();
let scheduled = false;
let stepNumber = 0;

function renderStepDiff() {
  scheduled = false;
  const next = snapshot();
  const eventChanged = next.event !== previous.event;
  const changedGroups = [];
  watchedPanels.forEach(item => {
    const before = previous[item.key] || { text: "", signature: "" };
    const after = next[item.key] || { text: "", signature: "" };
    const difference = lineDifference(before.text, after.text);
    const structuralOnly = before.signature !== after.signature && !difference.added.length && !difference.removed.length;
    if (difference.added.length || difference.removed.length || structuralOnly) {
      changedGroups.push({ item, difference, structuralOnly });
      flashPanel(item.panel);
    }
  });

  if (eventChanged || changedGroups.length) {
    stepNumber += 1;
    diffTarget.replaceChildren();
    const event = normalizeText(next.event);
    if (event.length) {
      const eventNode = document.createElement("div");
      eventNode.className = "diff-event";
      eventNode.textContent = event.slice(0, 2).join(" · ");
      diffTarget.append(eventNode);
    }
    changedGroups.forEach(entry => appendGroup(diffTarget, entry.item.label, entry.difference, entry.structuralOnly));
    if (!changedGroups.length) {
      const note = document.createElement("div");
      note.className = "diff-empty";
      const heading = document.createElement("strong");
      heading.textContent = "事件已推进";
      const detail = document.createElement("span");
      detail.textContent = "当前事件变化，但本帧可见的对象、队列、调用栈和输出快照没有变化。";
      note.append(heading, detail);
      diffTarget.append(note);
    }
    diffStatus.textContent = "STEP " + stepNumber + " · " + changedGroups.length + " CHANGES";
  }
  previous = next;
}

function scheduleDiff() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => window.requestAnimationFrame(renderStepDiff));
}

const observer = new MutationObserver(scheduleDiff);
["#current-event", "#promise-graph", "#selected-promise", "#queue-content", "#stack-content", "#timer-content", "#console-output"].forEach(selector => {
  const element = $(selector);
  if (element) observer.observe(element, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "data-state", "aria-label"] });
});

function bindLayoutToggle(buttonId, bodyClass, expandedText, collapsedText) {
  const button = document.getElementById(buttonId);
  if (!button) return;
  let expanded = false;
  try { expanded = localStorage.getItem("knowverse-promise-" + bodyClass) === "true"; } catch (_) {}
  document.body.classList.toggle(bodyClass, expanded);
  button.setAttribute("aria-pressed", String(expanded));
  button.textContent = expanded ? collapsedText : expandedText;
  button.addEventListener("click", () => {
    expanded = !expanded;
    document.body.classList.toggle(bodyClass, expanded);
    button.setAttribute("aria-pressed", String(expanded));
    button.textContent = expanded ? collapsedText : expandedText;
    try { localStorage.setItem("knowverse-promise-" + bodyClass, String(expanded)); } catch (_) {}
  });
}

bindLayoutToggle("toggle-scenarios", "hide-scenarios", "收起场景库", "展开场景库");
bindLayoutToggle("toggle-inspector", "hide-inspector", "收起检查器", "展开检查器");

const fullscreenButton = $("#fullscreen-toggle");
if (fullscreenButton) {
  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    } catch (error) {
      fullscreenButton.title = "当前浏览器未允许切换全屏：" + (error && error.message ? error.message : String(error));
    }
  });
  document.addEventListener("fullscreenchange", () => {
    fullscreenButton.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
  });
}

document.addEventListener("keydown", event => {
  const active = document.activeElement;
  const editing = active && (active.matches("textarea,input,select") || active.isContentEditable);
  if (editing || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === "ArrowRight" && $("#step-forward") && !$("#step-forward").disabled) {
    event.preventDefault();
    $("#step-forward").click();
  } else if (event.key === "ArrowLeft" && $("#step-back") && !$("#step-back").disabled) {
    event.preventDefault();
    $("#step-back").click();
  }
});

window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
