import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(scriptDir, "..");
const argRoot = process.argv.find((value, index) => process.argv[index - 1] === "--root");
const root = path.resolve(argRoot || sourceRoot);
const readJson = async name => JSON.parse(await readFile(path.join(root, name), "utf8"));
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const trimPath = value => String(value || "").replace(/^\.\//, "").replace(/^\/+/, "");

function routeHref(route, prefix) {
  if (!route?.path || !route.path.startsWith("./")) throw new Error(`Invalid internal route: ${route?.id}`);
  return prefix + trimPath(route.path);
}

function renderAccount(prefix) {
  return `<details class="kv-global-account" id="kv-global-account" data-status="anonymous">
    <summary class="kv-account-trigger" aria-label="打开全站账户与同步状态">
      <span class="kv-account-dot" data-status="neutral" aria-hidden="true"></span>
      <span class="kv-account-label"><small>ACCOUNT / SYNC</small><strong class="kv-account-state" data-kv-account-state>GitHub 登录</strong></span>
      <span class="kv-account-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div class="kv-account-panel" aria-label="账户面板">
      <strong class="kv-account-panel-title">一个账户，贯穿整个 KNOWVERSE</strong>
      <p class="kv-account-scope">公开知识、实验、展厅和挑战无需登录。身份认证与云端学习档案授权是两个独立状态。</p>
      <p class="kv-account-message" data-kv-account-message>当前设备可以直接学习；登录后可在获授权时同步个人学习档案。</p>
      <p class="kv-account-identity" data-kv-account-identity hidden></p>
      <button class="kv-account-action primary" type="button" data-kv-sign-in disabled>使用 GitHub 登录</button>
      <noscript><p class="kv-account-scope">账户操作需要启用 JavaScript；本页导航与知识内容仍可直接访问。</p></noscript>
      <button class="kv-account-action" type="button" data-kv-sign-out hidden>退出登录</button>
      <a class="kv-account-manage" href="${prefix}progress/#cloud-account">管理个人学习档案与同步状态 ↗</a>
    </div>
  </details>`;
}

function renderGroup(group, routeById, topicById, prefix) {
  const topRoute = routeById.get(group.routeId);
  if (!topRoute) throw new Error(`Unknown navigation routeId: ${group.routeId}`);
  const sections = (group.sections || []).map(section => {
    let items = section.items || [];
    if (section.dynamic === "knowledge.topics") {
      items = [...items, ...[...topicById.values()].map(topic => ({ label: topic.title, routeId: `topic.${topic.id}` }))];
    }
    const links = items.map(item => {
      const route = routeById.get(item.routeId);
      if (!route) throw new Error(`Unknown navigation item routeId: ${item.routeId}`);
      return `<a class="kv-nav-subitem" data-route-id="${escapeHtml(route.id)}" href="${escapeHtml(routeHref(route, prefix))}">${escapeHtml(item.label || route.label)}</a>`;
    }).join("");
    return links ? `<section class="kv-nav-section"><h2 class="kv-nav-section-title">${escapeHtml(section.label || "")}</h2><div class="kv-nav-sublist">${links}</div></section>` : "";
  }).join("");
  const activeIds = [group.routeId, ...(group.activeRouteIds || [])];
  return `<div class="kv-nav-group" data-group-id="${escapeHtml(group.id)}" data-active-routes="${escapeHtml(activeIds.join(" "))}">
    <div class="kv-nav-top"><a class="kv-nav-link" data-route-id="${escapeHtml(topRoute.id)}" href="${escapeHtml(routeHref(topRoute, prefix))}">${escapeHtml(group.label)}</a>
      <button class="kv-nav-toggle" type="button" aria-label="展开${escapeHtml(group.label)}二级菜单" aria-expanded="false" aria-controls="kv-menu-${escapeHtml(group.id)}"><span aria-hidden="true">⌄</span></button></div>
    <div class="kv-nav-submenu" id="kv-menu-${escapeHtml(group.id)}" hidden>${sections}</div>
  </div>`;
}

function renderHeader(prefix, navigation, routes, topics) {
  const routeById = new Map(routes.routes.map(route => [route.id, route]));
  const topicById = new Map(topics.topics.map(topic => [topic.id, topic]));
  const groups = navigation.groups.map(group => renderGroup(group, routeById, topicById, prefix)).join("");
  return `<header class="navwrap kv-static-shell" data-kv-static-shell="true" data-kv-shell-version="3.0"><nav class="navbar kv-navbar" aria-label="KNOWVERSE 全站导航">
    <a class="mark" href="${prefix}">KNOW<b>VERSE</b><small>FROM KNOWLEDGE TO MASTERY</small></a>
    <div class="navlinks kv-navlinks" id="kv-site-navigation" aria-label="全站主分区">${groups}</div>
    <button id="mobile-menu" class="mobilemenu kv-mobile-toggle" type="button" aria-label="展开全站导航" aria-controls="kv-site-navigation" aria-expanded="false">菜单</button>
    <button class="search-trigger" id="search-open" type="button" aria-label="全站搜索知识与作品">搜索 <span>⌘ K</span></button>
    ${renderAccount(prefix)}
  </nav></header>`;
}

function renderSearchOverlay() {
  return `<div class="searchoverlay" id="search-overlay" aria-hidden="true" role="dialog" aria-modal="true" aria-label="全站搜索">
    <div class="searchbox"><div class="searchheading"><strong>搜索 KNOWVERSE 知识宇宙</strong><button id="search-close" type="button">关闭 ✕</button></div>
    <input id="search-input" type="search" placeholder="搜索 Promise、Monorepo、React Native、AI…" aria-label="输入搜索关键词"><div id="search-results" class="searchresults" aria-live="polite"></div></div></div>`;
}

function renderFooter(prefix) {
  return `<div class="kv-footer-links" aria-label="全站快捷入口"><a href="${prefix}knowledge/">知识体系</a><a href="${prefix}works/">实践体验</a><a href="${prefix}progress/">学习成长</a><a href="https://github.com/liucaidong/knowverse" target="_blank" rel="noopener">GitHub ↗</a></div>`;
}

async function walk(dir, rel = "") {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "_site", ".next"].includes(entry.name)) continue;
    const childRel = path.posix.join(rel, entry.name);
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await walk(child, childRel));
    else if (entry.isFile() && entry.name.endsWith(".html")) output.push({ file: child, rel: childRel });
  }
  return output;
}

function relativePrefix(rel) {
  const directory = path.posix.dirname(rel);
  const depth = directory === "." ? 0 : directory.split("/").length;
  return depth ? "../".repeat(depth) : "./";
}

const [navigation, routes, knowledge] = await Promise.all([
  readJson("content/navigation.json"), readJson("content/routes.json"), readJson("content/knowledge.json"),
]);
const htmlFiles = await walk(root);
let transformed = 0, searchAdded = 0, footerLinked = 0;
const excluded = new Set([
  "scripts/fixtures/archive-harness.html",
  "auth/callback/index.html",
  "knowledge/monorepo/fullstack/project/apps/web/index.html",
]);
const immersive = new Set([
  "puzzles/worlds/first-realm/index.html",
  "puzzles/worlds/promise-realm/index.html",
  "gallery/exhibits/promise-cosmos/index.html",
]);
for (const { file, rel } of htmlFiles) {
  if (excluded.has(rel)) continue;
  let html = await readFile(file, "utf8");
  const prefix = relativePrefix(rel);
  const headerMatch = html.match(/<header\b([^>]*)>([\s\S]*?)<\/header>/i);
  const hasStaticShell = html.includes('data-kv-shell-version="3.0"');
  const isSiteHeader = Boolean(headerMatch && /class\s*=\s*["'][^"']*(?:navwrap|sitehead)[^"']*["']/i.test(headerMatch[0]));

  if (!hasStaticShell && !immersive.has(rel)) {
    const sharedHeader = renderHeader(prefix, navigation, routes, knowledge);
    if (isSiteHeader) html = html.replace(headerMatch[0], sharedHeader);
    else html = html.replace(/<body\b[^>]*>/i, match => match + sharedHeader);
  }

  if (immersive.has(rel) && !html.includes("kv-immersive-exit")) {
    const label = rel.includes("promise-cosmos") ? "返回 KNOWVERSE" : "退出沉浸体验";
    const exit = `<a class="kv-immersive-exit" href="${prefix}" aria-label="返回 KNOWVERSE 首页">← ${label}</a>`;
    html = html.replace(/<body\b[^>]*>/i, match => match + exit);
  }

  const bodyMatch = html.match(/<body\b([^>]*)>/i);
  if (bodyMatch && !/\bdata-root\s*=/.test(bodyMatch[1])) {
    html = html.replace(bodyMatch[0], bodyMatch[0].replace(/>$/, ` data-root="${prefix}">`));
  }

  const stylesheet = `${prefix}assets/css/site-architecture.css`;
  if (!html.includes("assets/css/site-architecture.css")) {
    html = html.replace(/<\/head>/i, `  <link rel="stylesheet" href="${stylesheet}">\n</head>`);
  }

  // Normalize all previous runs to exactly one footer link group.
  html = html.replace(/<div\s+class=["']kv-footer-links["'][^>]*>[\s\S]*?<\/div>/gi, "");
  if (immersive.has(rel)) {
    // Full-screen exhibits keep their original canvas/footer controls; only the exit affordance is shared.
    html = html.replace(/(<footer\b[^>]*class=["'][^"']*)\s+kv-shared-footer([^"']*["'])/i, "$1$2");
  } else {
    const footerMatch = html.match(/<footer\b([^>]*)>([\s\S]*?)<\/footer>/i);
    if (footerMatch) {
      const classAttrs = [...footerMatch[1].matchAll(/class=["']([^"']*)["']/gi)].map(match => match[1]);
      const existingClasses = classAttrs.join(" ").split(/\s+/).filter(Boolean);
      const customWorkspaceFooter = existingClasses.includes("page-footer");
      if (!customWorkspaceFooter) {
        const classes = [...new Set([...existingClasses, "kv-shared-footer"])].join(" ");
        const otherAttrs = footerMatch[1].replace(/\s*class=["'][^"']*["']/gi, "");
        html = html.replace(footerMatch[0], "<footer" + otherAttrs + " class=\"" + classes + "\">" + footerMatch[2] + renderFooter(prefix) + "</footer>");
        footerLinked++;
      } else {
        const classes = [...new Set(existingClasses.filter(name => name !== "kv-shared-footer"))].join(" ");
        const otherAttrs = footerMatch[1].replace(/\s*class=["'][^"']*["']/gi, "");
        const classAttribute = classes ? " class=\"" + classes + "\"" : "";
        html = html.replace(footerMatch[0], "<footer" + otherAttrs + classAttribute + ">" + footerMatch[2] + "</footer>");
      }
    } else {
      html = html.replace(/<\/body>/i, "<footer class=\"kv-minimal-footer kv-shared-footer\">" + renderFooter(prefix) + "</footer>\n</body>");
      footerLinked++;
    }
  }
  if (!html.includes(`${prefix}assets/js/v2.js`)) {
    html = html.replace(/<\/body>/i, `<script defer src="${prefix}assets/js/v2.js"></script>\n</body>`);
  }
  if (!immersive.has(rel) && !html.includes('id="search-overlay"')) {
    html = html.replace(/<\/body>/i, `${renderSearchOverlay()}\n</body>`);
    searchAdded++;
  }
  await writeFile(file, html);
  transformed++;
}
console.log(`Static site shell generated: ${transformed} pages; ${searchAdded} search overlays added; ${footerLinked} shared footer link sets added.`);
