import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../lab/experiments/promise-debugger/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../lab/experiments/promise-debugger/workspace-layout.css", import.meta.url), "utf8");
const enhancement = readFileSync(new URL("../lab/experiments/promise-debugger/workspace-enhancements.js", import.meta.url), "utf8");

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

assert.match(css, /\.workbench-layout\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/s, "workbench grid must define a full-height row");
assert.match(css, /\.workbench-layout\s*>\s*\.main-workspace\s*\{[^}]*height:\s*100%/s, "main workspace must stretch to the sidebar's full height");
assert.match(css, /\.main-workspace\s*>\s*\.workspace-grid\s*\{[^}]*flex:\s*1\s+1\s+0/si, "workspace grid must consume remaining main-workspace height");
assert.match(css, /\.primary-column\s*\{[^}]*clamp\(132px,\s*21vh,\s*200px\)/s, "output dock must have a useful responsive minimum and maximum");
assert.match(html, /rel="icon" href="\.\.\/\.\.\/\.\.\/favicon\.ico"/, "workbench must declare its site-relative favicon");
assert.match(html, /rel="icon" href="\.\.\/\.\.\/\.\.\/favicon\.svg"/, "workbench must declare its SVG favicon");
console.log("PASS: full-height parent sizing and site-relative favicons");


const heroTitle = html.indexOf('<div class="hero-title-row">');
const heroChips = html.indexOf('class="capability-row"', heroTitle);
const heroStats = html.indexOf('class="hero-stats"', heroTitle);
assert.ok(heroTitle >= 0 && heroChips > heroTitle && heroStats > heroChips, "capability chips must sit beside the hero title, before hero stats");
assert.equal((html.match(/class="capability-row"/g) || []).length, 1, "capability chips must not be duplicated below the title");
const stageStart = html.indexOf('<div class="workbench-stage" id="workbench-stage"');
const workbenchStart2 = html.indexOf('<div class="workbench-layout"', stageStart);
const boundaryIndex = html.indexOf('<details class="boundary-note panel">', stageStart);
const stageEnd = html.indexOf('</div>\n\n    <footer class="page-footer">', boundaryIndex);
assert.ok(stageStart >= 0 && workbenchStart2 > stageStart && boundaryIndex > workbenchStart2 && stageEnd > boundaryIndex, "full workbench and boundary note must be grouped in one stage");
assert.match(html, /id="workbench-fullscreen"/, "fullscreen exit control must be available inside the workbench");
assert.match(enhancement, /document\.fullscreenElement === workbenchStage/, "fullscreen target must be the workbench stage, not the entire document");
assert.match(enhancement, /workbenchStage\.classList\.add\("is-expanded"\)/, "fullscreen must have a fallback expanded mode");
assert.match(enhancement, /document\.addEventListener\("fullscreenchange", syncWorkbenchFullscreenControls\)/, "controls must stay synchronized when users press Escape");
assert.match(css, /\.workbench-stage:fullscreen/, "workbench fullscreen layout rules must exist");
assert.match(css, /\.hero-title-row\s*\{[^}]*display:\s*flex/s, "title and capability chips must share a responsive title row");
console.log("PASS: capability chips in hero title row and workbench-only fullscreen/restore controls");

assert.match(css, /\.workbench-stage\.is-expanded\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/s, "fullscreen fallback must overlay the viewport");


const toolbarMetaStart = html.indexOf('<div class="toolbar-meta">');
const toolbarMetaEnd = html.indexOf('</div>', toolbarMetaStart);
const toolbarMeta = html.slice(toolbarMetaStart, toolbarMetaEnd);
assert.ok(toolbarMeta.indexOf('id="workbench-fullscreen"') > toolbarMeta.indexOf('id="frame-counter"'), "workbench expand icon must be the last item at the far right of toolbar");
assert.match(html, /id="workbench-fullscreen"[^>]*aria-label="放大工作区"/, "icon-only expand control must have an accessible label");
assert.match(html, /<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">/, "expand control must use inline SVG icon artwork");
assert.match(enhancement, /button\.innerHTML = expanded[\s\S]*?button\.setAttribute\("aria-label", expanded \? "还原工作区" : "放大工作区"\)/, "expand/minimize icons and accessible labels must sync with state");
assert.match(css, /\.workbench-stage:fullscreen,\s*\.workbench-stage\.is-expanded\s*\{[^}]*position:\s*fixed;\s*inset:\s*0/s, "fullscreen stage must be pinned to viewport origin");
assert.match(css, /\.workbench-stage:fullscreen > \.workbench-layout > \.sidebar,[\s\S]*?grid-row:\s*1;[\s\S]*?height:\s*100%/s, "scenario sidebar must stretch from the top in fullscreen");
console.log("PASS: fullscreen sidebar top alignment and far-right icon-only maximize/minimize control");
