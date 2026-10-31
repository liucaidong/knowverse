const NODES = [
  { id: "promise", label: "Promise", sub: "对象 / 状态", p: [0, 0, 0], r: 0.8 },
  { id: "thenable", label: "Thenable", sub: "Get(then)", p: [-3.1, 1.25, -0.5], r: 0.62 },
  { id: "inner", label: "Inner", sub: "adoption", p: [-1.5, -1.7, 1.4], r: 0.58 },
  { id: "jobs", label: "Jobs", sub: "Reaction / Thenable", p: [2.5, 1.7, 0.4], r: 0.68 },
  { id: "microtasks", label: "Microtasks", sub: "FIFO queue", p: [3.4, -1.1, -0.8], r: 0.7 },
  { id: "chain", label: "Chain", sub: "then / catch", p: [0.9, -2.8, -1.2], r: 0.6 },
  { id: "combinators", label: "Combinators", sub: "all / race / any", p: [-3.2, -1.0, -1.5], r: 0.64 },
];

const EDGES = [
  ["thenable", "promise"], ["promise", "inner"], ["promise", "jobs"],
  ["jobs", "microtasks"], ["microtasks", "chain"], ["chain", "combinators"],
  ["thenable", "jobs"], ["inner", "microtasks"], ["promise", "chain"],
];

const STAGE_FOCUS = [
  ["thenable", "promise", "inner", "jobs"],
  ["promise", "jobs", "microtasks"],
  ["promise", "jobs", "chain"],
  ["promise", "combinators", "microtasks"],
  NODES.map(node => node.id),
];

const STAGE_CAPTIONS = [
  "RESOLUTION / ADOPTION",
  "REACTION / FIFO",
  "CHAIN / ERROR FLOW",
  "COMBINATORS",
  "INTEGRATED TIMELINE",
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function mountPromiseQuestWorld(canvas) {
  const context = canvas?.getContext("2d");
  if (!context) return { supported: false, setStage() {}, destroy() {} };

  const nodeById = new Map(NODES.map(node => [node.id, node]));
  const stars = Array.from({ length: 72 }, (_, index) => ({
    x: ((index * 137.508) % 1000) / 1000,
    y: ((index * 79.31 + 17) % 1000) / 1000,
    r: 0.5 + ((index * 17) % 9) / 10,
    a: 0.18 + ((index * 13) % 55) / 100,
  }));

  let width = 1;
  let height = 1;
  let ratio = 1;
  let yaw = -0.34;
  let pitch = 0.12;
  let stage = 0;
  let selectedId = "promise";
  let dragging = null;
  let previousTime = 0;
  let frame = 0;
  let destroyed = false;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    ratio = Math.min(window.devicePixelRatio || 1, 1.8);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function rotate(point) {
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const x = point[0] * cosY - point[2] * sinY;
    const z0 = point[0] * sinY + point[2] * cosY;
    const cosX = Math.cos(pitch);
    const sinX = Math.sin(pitch);
    const y = point[1] * cosX - z0 * sinX;
    const z = point[1] * sinX + z0 * cosX;
    return [x, y, z];
  }

  function project(point) {
    const rotated = rotate(point);
    const depth = rotated[2] + 10.2;
    if (depth < 1) return null;
    const scale = Math.min(width, height) * 0.92 / depth;
    return {
      x: width * 0.5 + rotated[0] * scale,
      y: height * 0.51 - rotated[1] * scale,
      depth,
      scale,
    };
  }

  function pathLine(from, to, color, alpha = 1, thickness = 1.2) {
    const a = project(from);
    const b = project(to);
    if (!a || !b) return;
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineWidth = thickness;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    context.globalAlpha = 1;
  }

  function drawOrb(node, focused, selected) {
    const point = project(node.p);
    if (!point) return;
    const radius = clamp(node.r * point.scale * 0.43, 7, 48);
    const alpha = focused ? 1 : 0.22;
    context.save();
    context.globalAlpha = alpha;

    const halo = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 3.2);
    halo.addColorStop(0, selected ? "rgba(157,255,229,.34)" : "rgba(87,201,223,.21)");
    halo.addColorStop(1, "rgba(22,100,145,0)");
    context.fillStyle = halo;
    context.beginPath();
    context.arc(point.x, point.y, radius * 3.2, 0, Math.PI * 2);
    context.fill();

    const sphere = context.createRadialGradient(
      point.x - radius * 0.38, point.y - radius * 0.46, radius * 0.06,
      point.x, point.y, radius
    );
    sphere.addColorStop(0, selected ? "#e1fff4" : "#c5f6ef");
    sphere.addColorStop(0.25, selected ? "#69eacb" : "#54c5cb");
    sphere.addColorStop(0.7, selected ? "#176b86" : "#174a75");
    sphere.addColorStop(1, "#08162d");
    context.fillStyle = sphere;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = selected ? "rgba(193,255,232,.9)" : "rgba(122,223,225,.35)";
    context.lineWidth = selected ? 1.8 : 0.8;
    context.stroke();

    context.save();
    context.translate(point.x, point.y);
    context.rotate(-0.19 + yaw * 0.15);
    context.strokeStyle = selected ? "rgba(170,255,224,.8)" : "rgba(100,204,225,.38)";
    context.lineWidth = Math.max(0.7, radius * 0.045);
    context.beginPath();
    context.ellipse(0, 0, radius * 1.42, radius * 0.42, 0, 0, Math.PI * 2);
    context.stroke();
    context.restore();

    context.textAlign = "center";
    context.font = selected ? "700 11px ui-monospace, monospace" : "600 10px ui-monospace, monospace";
    context.fillStyle = selected ? "#d9fff1" : "#91bacd";
    context.fillText(node.label, point.x, point.y + radius + 16);
    context.font = "9px ui-monospace, monospace";
    context.fillStyle = "#6d91a7";
    context.fillText(node.sub, point.x, point.y + radius + 29);
    context.restore();
  }

  function render(now) {
    if (destroyed) return;
    const delta = previousTime ? Math.min(0.04, (now - previousTime) / 1000) : 0.016;
    previousTime = now;
    if (!dragging) yaw += delta * 0.035;
    resize();

    const background = context.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "#061222");
    background.addColorStop(0.58, "#0a2036");
    background.addColorStop(1, "#10182e");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    const fog = context.createRadialGradient(width * 0.52, height * 0.49, 4, width * 0.52, height * 0.49, width * 0.54);
    fog.addColorStop(0, "rgba(33,119,135,.15)");
    fog.addColorStop(1, "rgba(8,18,34,0)");
    context.fillStyle = fog;
    context.fillRect(0, 0, width, height);

    stars.forEach(star => {
      context.globalAlpha = star.a;
      context.fillStyle = "#b6e9ef";
      context.beginPath();
      context.arc(star.x * width, star.y * height, star.r, 0, Math.PI * 2);
      context.fill();
    });
    context.globalAlpha = 1;

    const focus = new Set(STAGE_FOCUS[stage]);
    EDGES.forEach(([fromId, toId]) => {
      const from = nodeById.get(fromId);
      const to = nodeById.get(toId);
      const emphasized = focus.has(fromId) && focus.has(toId);
      pathLine(from.p, to.p, emphasized ? "#56e3cb" : "#3e7595", emphasized ? 0.55 : 0.12, emphasized ? 1.6 : 0.8);
    });

    const ordered = [...NODES].sort((a, b) => {
      const pa = project(a.p), pb = project(b.p);
      return (pb?.depth || 0) - (pa?.depth || 0);
    });
    ordered.forEach(node => drawOrb(node, focus.has(node.id), node.id === selectedId));

    context.fillStyle = "rgba(184,226,234,.58)";
    context.font = "10px ui-monospace, monospace";
    context.fillText(STAGE_CAPTIONS[stage], 18, 25);
    context.fillStyle = "rgba(112,164,187,.54)";
    context.fillText("DRAG TO ROTATE / PROMISE MECHANISM MAP", 18, height - 16);

    frame = requestAnimationFrame(render);
  }

  function hitTest(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    let nearest = null;
    let distance = 30;
    for (const node of NODES) {
      const point = project(node.p);
      if (!point) continue;
      const d = Math.hypot(point.x + rect.left - clientX, point.y + rect.top - clientY);
      if (d < distance) {
        nearest = node.id;
        distance = d;
      }
    }
    if (nearest) selectedId = nearest;
  }

  canvas.addEventListener("pointerdown", event => {
    dragging = { x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    if (!dragging) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true;
    if (dragging.moved) {
      yaw += dx * 0.006;
      pitch = clamp(pitch + dy * 0.004, -0.65, 0.65);
    }
    dragging.x = event.clientX;
    dragging.y = event.clientY;
  });
  canvas.addEventListener("pointerup", event => {
    if (dragging && !dragging.moved) hitTest(event.clientX, event.clientY);
    dragging = null;
  });
  canvas.addEventListener("pointercancel", () => { dragging = null; });

  const observer = "ResizeObserver" in window ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);
  window.addEventListener("resize", resize);
  resize();
  frame = requestAnimationFrame(render);

  return {
    supported: true,
    setStage(next) { stage = clamp(next, 0, STAGE_FOCUS.length - 1); },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", () => {});
      canvas.removeEventListener("pointermove", () => {});
      canvas.removeEventListener("pointerup", () => {});
    },
  };
}
