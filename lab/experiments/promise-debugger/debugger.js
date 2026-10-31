async function bootPromiseWorkbench() {
  try {
    const parts = await Promise.all([1, 2, 3, 4].map(async index => {
      const name = "./workbench.bundle.part-" + String(index).padStart(2, "0") + ".b64";
      const response = await fetch(new URL(name, import.meta.url));
      if (!response.ok) throw new Error("工作台资源加载失败：" + name + " (HTTP " + response.status + ")");
      return response.text();
    }));
    const binary = atob(parts.join("").replace(/\s+/g, ""));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (!globalThis.DecompressionStream) throw new Error("请使用支持 gzip 解压流的现代浏览器");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const bundle = await new Response(stream).json();
    if (bundle.format !== "knowverse-promise-workbench-bundle-v1") throw new Error("Promise 工作台资源包版本不匹配");

    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      if (link.href.includes("debugger.css")) link.remove();
    });
    const style = document.createElement("style");
    style.textContent = bundle.css;
    document.head.append(style);

    await new Promise(resolve => {
      const layout = document.createElement("link");
      layout.rel = "stylesheet";
      layout.href = new URL("./workspace-layout.css", import.meta.url).href;
      layout.onload = resolve;
      layout.onerror = resolve;
      document.head.append(layout);
    });

    const runtimeUrl = URL.createObjectURL(new Blob([bundle.runtime], { type: "text/javascript" }));
    const scenariosUrl = URL.createObjectURL(new Blob([bundle.scenarios], { type: "text/javascript" }));
    const workerSource = bundle.worker.replace('from "./runtime.mjs"', 'from "' + runtimeUrl + '"');
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    const debuggerSource = bundle.debugger
      .replace('from "./scenarios.mjs"', 'from "' + scenariosUrl + '"')
      .replace('new URL("./worker.mjs", import.meta.url)', 'new URL("' + workerUrl + '")');
    const debuggerUrl = URL.createObjectURL(new Blob([debuggerSource], { type: "text/javascript" }));
    await import(debuggerUrl);
    await import(new URL("./workspace-enhancements.js", import.meta.url).href);
    window.addEventListener("pagehide", () => {
      [runtimeUrl, scenariosUrl, workerUrl, debuggerUrl].forEach(url => URL.revokeObjectURL(url));
    }, { once: true });
  } catch (error) {
    const target = document.getElementById("native-result");
    if (target) target.textContent = "Promise 工作台加载失败：" + (error?.message || String(error));
    console.error(error);
  }
}

bootPromiseWorkbench();