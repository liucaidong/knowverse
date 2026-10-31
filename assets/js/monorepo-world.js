import { getAffectedIds } from "./monorepo-graph-model.mjs";

const NODE_COLORS = {
  package: [0.22, 0.83, 0.72],
  app: [0.42, 0.62, 1.0],
};
const BUILD_COLORS = [
  [0.98, 0.78, 0.38],
  [0.34, 0.88, 0.75],
  [0.48, 0.67, 1.0],
  [0.72, 0.57, 0.98],
];

function compileShader(gl, type, source) {
  const result = gl.createShader(type);
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(result) || "Unknown shader error";
    gl.deleteShader(result);
    throw new Error(message);
  }
  return result;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Could not link WebGL program");
  }
  return program;
}

function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function lookAt(out, eye, center, up) {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let length = Math.hypot(zx, zy, zz) || 1;
  zx /= length; zy /= length; zz /= length;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  length = Math.hypot(xx, xy, xz) || 1;
  xx /= length; xy /= length; xz /= length;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

function modelMatrix(position, scale) {
  const out = new Float32Array(16);
  out[0] = scale; out[5] = scale; out[10] = scale; out[15] = 1;
  out[12] = position[0]; out[13] = position[1]; out[14] = position[2];
  return out;
}

function project(point, view, projection, width, height) {
  const x = point[0], y = point[1], z = point[2];
  const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
  const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
  const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
  const cx = projection[0] * vx + projection[4] * vy + projection[8] * vz + projection[12];
  const cy = projection[1] * vx + projection[5] * vy + projection[9] * vz + projection[13];
  const cw = projection[3] * vx + projection[7] * vy + projection[11] * vz + projection[15];
  if (cw <= 0) return null;
  return {
    x: (cx / cw * 0.5 + 0.5) * width,
    y: (1 - (cy / cw * 0.5 + 0.5)) * height,
  };
}

function cubeVertices() {
  const faces = [
    [[-1,-1,1],[1,-1,1],[1,1,1],[-1,-1,1],[1,1,1],[-1,1,1],[0,0,1]],
    [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,-1,-1],[-1,1,-1],[1,1,-1],[0,0,-1]],
    [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,1],[1,1,-1],[-1,1,-1],[0,1,0]],
    [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,-1],[1,-1,1],[-1,-1,1],[0,-1,0]],
    [[1,-1,1],[1,-1,-1],[1,1,-1],[1,-1,1],[1,1,-1],[1,1,1],[1,0,0]],
    [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,-1,-1],[-1,1,1],[-1,1,-1],[-1,0,0]],
  ];
  const values = [];
  faces.forEach(face => face.slice(0, 6).forEach(vertex => values.push(...vertex, ...face[6])));
  return new Float32Array(values);
}

export function mountMonorepoWorld(container, graph, options = {}) {
  const canvas = container.querySelector("canvas");
  const gl = canvas?.getContext("webgl", {
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  if (!canvas || !gl) {
    container.classList.add("webgl-unavailable");
    return { supported: false, select() {}, setMode() {}, destroy() {} };
  }

  const vertexSource = [
    "attribute vec3 aPosition;",
    "attribute vec3 aNormal;",
    "uniform mat4 uView;",
    "uniform mat4 uProjection;",
    "uniform mat4 uModel;",
    "varying vec3 vNormal;",
    "void main() {",
    "  vec4 world = uModel * vec4(aPosition, 1.0);",
    "  vNormal = normalize(mat3(uModel) * aNormal);",
    "  gl_Position = uProjection * uView * world;",
    "}"
  ].join("\n");
  const fragmentSource = [
    "precision mediump float;",
    "uniform vec3 uColor;",
    "uniform float uSelected;",
    "uniform float uTime;",
    "varying vec3 vNormal;",
    "void main() {",
    "  vec3 normal = normalize(vNormal);",
    "  vec3 light = normalize(vec3(-0.45, 0.75, 0.85));",
    "  float diffuse = max(dot(normal, light), 0.0);",
    "  float rim = pow(1.0 - max(dot(normal, vec3(0.0, 0.0, 1.0)), 0.0), 2.0);",
    "  float pulse = 1.0 + uSelected * (0.08 + 0.06 * sin(uTime * 2.0));",
    "  vec3 color = uColor * (0.38 + diffuse * 0.75) * pulse;",
    "  color += vec3(0.23, 0.98, 0.79) * rim * 0.22;",
    "  gl_FragColor = vec4(color, 1.0);",
    "}"
  ].join("\n");

  let program;
  try {
    program = createProgram(gl, vertexSource, fragmentSource);
  } catch (error) {
    container.classList.add("webgl-unavailable");
    const notice = container.querySelector("[data-webgl-notice]");
    if (notice) notice.textContent = "3D 渲染初始化失败；仍可使用右侧结构列表和交互内容。";
    return { supported: false, select() {}, setMode() {}, destroy() {} };
  }

  const locations = {
    position: gl.getAttribLocation(program, "aPosition"),
    normal: gl.getAttribLocation(program, "aNormal"),
    view: gl.getUniformLocation(program, "uView"),
    projection: gl.getUniformLocation(program, "uProjection"),
    model: gl.getUniformLocation(program, "uModel"),
    color: gl.getUniformLocation(program, "uColor"),
    selected: gl.getUniformLocation(program, "uSelected"),
    time: gl.getUniformLocation(program, "uTime"),
  };
  const cubeBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, cubeVertices(), gl.STATIC_DRAW);

  const nodeMap = new Map(graph.nodes.map(node => [node.id, node]));
  const positions = new Map();
  const labelHost = container.querySelector("[data-world-labels]");
  const labels = new Map();
  if (labelHost) {
    graph.nodes.forEach(node => {
      const label = document.createElement("span");
      label.className = "world-node-label";
      label.textContent = node.name.replace(/^@[^/]+\//, "");
      labelHost.append(label);
      labels.set(node.id, label);
    });
  }
  graph.build_layers.forEach((layer, layerIndex) => {
    layer.forEach((id, index) => {
      const centered = index - (layer.length - 1) / 2;
      positions.set(id, [-2.7 + layerIndex * 2.7, centered * 1.45, (index % 2) * 0.34]);
    });
  });
  const lineVertices = [];
  graph.edges.forEach(edge => {
    const from = positions.get(edge.consumer);
    const to = positions.get(edge.dependency);
    if (from && to) lineVertices.push(...from, 0, 0, 1, ...to, 0, 0, 1);
  });
  const edgeBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineVertices), gl.STATIC_DRAW);

  const projection = new Float32Array(16);
  const view = new Float32Array(16);
  let yaw = -0.13;
  let pitch = 0.12;
  let selectedId = options.selected || graph.nodes[0]?.id || null;
  let mode = options.mode || "dependencies";
  let frame = 0;
  let destroyed = false;
  let pointer = null;

  function setAttributes(buffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(locations.normal);
    gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 24, 12);
  }

  function highlightedIds() {
    if (mode === "affected" && selectedId) return new Set(getAffectedIds(graph, selectedId));
    if (mode === "dependencies" && selectedId) {
      const node = nodeMap.get(selectedId);
      const related = new Set([selectedId, ...(node?.dependencies || [])]);
      graph.edges.forEach(edge => { if (edge.dependency === selectedId) related.add(edge.consumer); });
      return related;
    }
    if (mode === "build") return new Set(graph.build_order);
    return new Set();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 1.8);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    perspective(projection, Math.PI / 4.2, width / height, 0.1, 60);
  }

  function render(now) {
    if (destroyed) return;
    resize();
    const radius = 8.4;
    const eye = [Math.sin(yaw) * radius, 2.25 + pitch * 4.0, Math.cos(yaw) * radius];
    lookAt(view, eye, [0, 0, 0], [0, 1, 0]);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.018, 0.035, 0.075, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniformMatrix4fv(locations.view, false, view);
    gl.uniformMatrix4fv(locations.projection, false, projection);
    gl.uniform1f(locations.time, now * 0.001);

    setAttributes(edgeBuffer);
    gl.uniformMatrix4fv(locations.model, false, modelMatrix([0, 0, 0], 1));
    gl.uniform3f(locations.color, 0.17, 0.62, 0.62);
    gl.uniform1f(locations.selected, 0);
    gl.drawArrays(gl.LINES, 0, lineVertices.length / 6);

    setAttributes(cubeBuffer);
    const highlighted = highlightedIds();
    graph.nodes.forEach(node => {
      const isSelected = node.id === selectedId;
      const isHighlighted = highlighted.has(node.id);
      const layerIndex = graph.build_layers.findIndex(layer => layer.includes(node.id));
      let color = NODE_COLORS[node.kind] || [0.42, 0.7, 0.77];
      if (mode === "build") color = BUILD_COLORS[Math.max(0, layerIndex) % BUILD_COLORS.length];
      if (mode === "affected" && !isHighlighted) color = [0.15, 0.25, 0.35];
      if (mode === "dependencies" && highlighted.size && !isHighlighted) color = [0.16, 0.29, 0.39];
      gl.uniformMatrix4fv(locations.model, false, modelMatrix(positions.get(node.id), isSelected ? 0.62 : 0.52));
      gl.uniform3f(locations.color, color[0], color[1], color[2]);
      gl.uniform1f(locations.selected, isSelected ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    });

    if (labels.size) {
      const rect = canvas.getBoundingClientRect();
      graph.nodes.forEach(node => {
        const label = labels.get(node.id);
        const point = project(positions.get(node.id), view, projection, canvas.width, canvas.height);
        if (!label || !point || point.x < 0 || point.y < 0 || point.x > canvas.width || point.y > canvas.height) {
          if (label) label.hidden = true;
          return;
        }
        label.hidden = false;
        label.style.left = (point.x / canvas.width * rect.width) + "px";
        label.style.top = (point.y / canvas.height * rect.height - 42) + "px";
        label.classList.toggle("is-selected", node.id === selectedId);
        label.classList.toggle("is-dimmed", mode === "affected" && !highlighted.has(node.id));
      });
    }

    frame = requestAnimationFrame(render);
  }

  function chooseAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    let candidate = null;
    let nearest = 58;
    graph.nodes.forEach(node => {
      const point = project(positions.get(node.id), view, projection, canvas.width, canvas.height);
      if (!point) return;
      const sx = point.x / canvas.width * width + rect.left;
      const sy = point.y / canvas.height * height + rect.top;
      const distance = Math.hypot(sx - clientX, sy - clientY);
      if (distance < nearest) { nearest = distance; candidate = node.id; }
    });
    if (candidate) {
      selectedId = candidate;
      options.onSelect?.(candidate);
    }
  }

  canvas.addEventListener("pointerdown", event => {
    pointer = { x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    if (!pointer) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) pointer.moved = true;
    if (pointer.moved) {
      yaw += dx * 0.006;
      pitch = Math.max(-0.55, Math.min(0.55, pitch + dy * 0.004));
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  });
  canvas.addEventListener("pointerup", event => {
    if (pointer && !pointer.moved) chooseAt(event.clientX, event.clientY);
    pointer = null;
  });
  canvas.addEventListener("pointercancel", () => { pointer = null; });

  const observer = "ResizeObserver" in window ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);
  window.addEventListener("resize", resize);
  resize();
  frame = requestAnimationFrame(render);

  return {
    supported: true,
    select(id) { if (nodeMap.has(id)) selectedId = id; },
    setMode(nextMode) { mode = nextMode; },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      gl.deleteBuffer(cubeBuffer);
      gl.deleteBuffer(edgeBuffer);
      gl.deleteProgram(program);
    },
  };
}
