import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../lab/experiments/promise-debugger/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../lab/experiments/promise-debugger/workspace-layout.css", import.meta.url), "utf8");

const dockStart = html.indexOf('<div class="output-dock">');
const consoleIndex = html.indexOf('class="panel console-panel"');
const nativeIndex = html.indexOf('class="panel native-panel"');
assert.ok(dockStart >= 0, "06/07 must be inside a dedicated output dock");
assert.ok(consoleIndex > dockStart && nativeIndex > consoleIndex, "console panel 06 must precede native comparison panel 07 inside the dock");
assert.ok(html.indexOf("</details>\n            </div>", nativeIndex) > nativeIndex, "output dock must close after panel 07");

assert.match(css, /\.primary-column\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+clamp\(/s, "top workspace row must be bounded by a shrinkable grid track");
assert.match(css, /\.editor-trace-grid\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/s, "panels 01/02 must share a bounded row");
assert.match(css, /\.editor-trace-grid\s*>\s*\.editor-panel,\s*\.editor-trace-grid\s*>\s*\.trace-panel\s*\{[^}]*max-height:\s*100%/s, "panels 01/02 must be capped to their grid row");
assert.match(css, /\.output-dock\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:/s, "panels 06/07 must use an independent grid dock");
assert.match(css, /\.output-dock\s*>\s*\.native-panel\s*\[open\]\s*\{/, "expanded panel 07 must remain inside the dock");
assert.match(css, /\.inspector-column\s*\{[^}]*grid-template-rows:/s, "the inspector must have explicit grid rows");
assert.match(css, /\.step-diff-content,[\s\S]*?\.promise-panel\s*\.promise-graph,[\s\S]*?overflow:\s*auto/s, "inspector content must scroll internally");
assert.match(css, /@media\s*\(max-width:\s*720px\)/, "mobile layout override must exist");
assert.match(css, /@media\s*\(max-height:\s*660px\)/, "short desktop viewport fallback must exist");

console.log("PASS: Promise workbench layout — bounded 01/02, isolated 06/07 dock, internally scrollable inspector, tablet/mobile/short-viewport rules");
