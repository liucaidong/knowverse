import { BACKEND_CONFIG } from "./backend/config.mjs";
import { createSupabaseAuthClient } from "./backend/auth.mjs";

const auth = createSupabaseAuthClient();
const make = (tag, className = "", value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
};

function toUrl(path, root) {
  if (typeof path !== "string" || !path) return null;
  try {
    const url = new URL(path.replace(/^\.\//, ""), root);
    return url.origin === root.origin && url.pathname.startsWith(root.pathname) ? url : null;
  } catch {
    return null;
  }
}

function isCurrent(path, root) {
  const target = toUrl(path, root);
  return Boolean(target && location.pathname.startsWith(target.pathname));
}

function makeLink(parent, label, path, root, className = "kv-nav-subitem") {
  const url = toUrl(path, root);
  if (!url) return null;
  const link = make("a", className, label);
  link.href = url.href;
  if (isCurrent(path, root)) link.setAttribute("aria-current", "page");
  parent.append(link);
  return link;
}

function closeGroups(container) {
  container.querySelectorAll(".kv-nav-group").forEach(group => {
    group.classList.remove("is-open");
    const toggle = group.querySelector(".kv-nav-toggle");
    const menu = group.querySelector(".kv-nav-submenu");
    toggle?.setAttribute("aria-expanded", "false");
    if (menu) menu.hidden = true;
  });
}

function buildKnowledgeSections(topics) {
  const categories = new Map();
  for (const topic of topics) {
    const label = topic.category || "其他专题";
    if (!categories.has(label)) categories.set(label, []);
    categories.get(label).push({ label: topic.title, path: topic.href });
  }
  return [...categories].map(([label, items]) => ({ label, items }));
}

function createGroup(group, root, navLinks) {
  const wrapper = make("div", "kv-nav-group");
  const top = make("div", "kv-nav-top");
  const active = isCurrent(group.path, root) ||
    (group.activePaths || []).some(path => isCurrent(path, root));
  const main = makeLink(top, group.label, group.path, root, "kv-nav-link");
  if (!main) return null;
  if (active) main.setAttribute("aria-current", "page");

  const toggle = make("button", "kv-nav-toggle", "⌄");
  toggle.type = "button";
  toggle.setAttribute("aria-label", "展开" + group.label + "二级菜单");
  toggle.setAttribute("aria-expanded", "false");
  const menu = make("div", "kv-nav-submenu");
  menu.hidden = true;

  for (const section of group.sections || []) {
    if (section.label) menu.append(make("div", "kv-nav-section-title", section.label));
    const list = make("div", "kv-nav-sublist");
    for (const item of section.items || []) makeLink(list, item.label, item.path, root);
    if (list.childElementCount) menu.append(list);
  }

  toggle.addEventListener("click", () => {
    const shouldOpen = toggle.getAttribute("aria-expanded") !== "true";
    closeGroups(navLinks);
    if (shouldOpen) {
      wrapper.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      menu.hidden = false;
    }
  });
  top.append(toggle);
  wrapper.append(top, menu);
  return wrapper;
}

function mountGlobalAccount(root, nav) {
  nav.querySelector("#kv-global-account")?.remove();
  const details = make("details", "kv-global-account");
  details.id = "kv-global-account";
  const summary = make("summary", "kv-account-trigger");
  const dot = make("span", "kv-account-dot");
  dot.setAttribute("aria-hidden", "true");
  const label = make("span", "kv-account-label");
  label.append(make("small", "", "全站账户"));
  const state = make("strong", "kv-account-state", "正在检查…");
  label.append(state);
  summary.append(dot, label, make("span", "kv-account-chevron", "⌄"));

  const panel = make("div", "kv-account-panel");
  panel.append(make("strong", "kv-account-panel-title", "一个账户，贯穿整个 KNOWVERSE"));
  panel.append(make("p", "kv-account-scope",
    "这是全站共享登录，不是某个页面的单独授权。同一站点下的知识库、实验室、展厅、解谜和学习驾驶舱共用同一认证会话。"));
  panel.append(make("p", "kv-account-scope",
    "公开知识内容和互动作品无需登录。登录用于关联个人学习档案与云端同步；GitHub OAuth 仅请求 read:user。身份认证成功不代表自动获得云端同步权限，云端仍受账户白名单、RLS 与受控 RPC 限制。"));
  const message = make("p", "kv-account-message", "未登录时仍可在当前设备学习，学习记录继续保存在本机。");
  const identity = make("p", "kv-account-identity", "");
  const signIn = make("button", "kv-account-action primary", "使用 GitHub 登录（全站）");
  signIn.type = "button";
  signIn.disabled = !BACKEND_CONFIG.enabled;
  const signOut = make("button", "kv-account-action", "退出全站账户");
  signOut.type = "button";
  signOut.hidden = true;
  const archive = makeLink(panel, "管理学习档案与云端同步 ↗", "progress/#cloud-account", root, "kv-account-manage");
  panel.append(message, identity, signIn, signOut);
  details.append(summary, panel);
  nav.append(details);

  async function refresh() {
    identity.textContent = "";
    details.dataset.status = "neutral";
    dot.dataset.status = "neutral";
    if (!BACKEND_CONFIG.enabled) {
      state.textContent = "云端未配置";
      message.textContent = "云端账户尚未启用；公开内容和本地学习功能无需登录。";
      signIn.disabled = true;
      signOut.hidden = true;
      return;
    }
    signIn.disabled = false;
    try {
      const session = await auth.getSession();
      if (!session) {
        state.textContent = "未登录 · 本机学习可用";
        message.textContent = "登录后，同一账户状态会在全站页面共享；跨设备同步还需云端授权。";
        details.dataset.status = "anonymous";
        dot.dataset.status = "anonymous";
        signIn.hidden = false;
        signOut.hidden = true;
        return;
      }
      const user = session.user || {};
      const displayName = user.user_metadata?.user_name || user.user_metadata?.full_name ||
        user.email || user.id || "已认证账户";
      state.textContent = "已登录 · 全站共享";
      identity.textContent = "当前账户：" + displayName;
      message.textContent = "全站共享会话有效。注意：身份认证成功不等于已获云端同步白名单权限；同步状态以学习档案面板为准。";
      details.dataset.status = "authenticated";
      dot.dataset.status = "authenticated";
      signIn.hidden = true;
      signOut.hidden = false;
    } catch (error) {
      state.textContent = "账户状态待确认";
      message.textContent = "无法刷新登录状态：" + (error.message || "网络异常") + "。可以稍后重试。";
      details.dataset.status = "warning";
      dot.dataset.status = "warning";
      signIn.hidden = false;
      signOut.hidden = true;
    }
  }

  signIn.addEventListener("click", async () => {
    signIn.disabled = true;
    signIn.textContent = "正在跳转到 GitHub…";
    try {
      await auth.signInWithGitHub(root, location.href);
    } catch (error) {
      message.textContent = error.message || "GitHub 登录启动失败。";
      signIn.disabled = false;
      signIn.textContent = "重新尝试 GitHub 登录";
    }
  });
  signOut.addEventListener("click", async () => {
    signOut.disabled = true;
    try {
      await auth.signOut();
      details.open = false;
      await refresh();
    } catch (error) {
      message.textContent = error.message || "退出登录失败。";
    } finally {
      signOut.disabled = false;
    }
  });
  window.addEventListener("storage", event => {
    if (event.key === BACKEND_CONFIG.authStorageKey) refresh();
  });
  window.addEventListener("knowverse:sync-state", event => {
    const status = event.detail?.status;
    if (status === "pending-authorization") message.textContent =
      "GitHub 身份认证已完成，但账户尚未获云端学习档案白名单授权。公开内容与本机学习不受影响。";
    if (status === "synced") message.textContent = "全站共享账户已登录，云端学习档案同步成功。";
    if (status === "offline") message.textContent = "全站共享账户已登录；当前离线，学习事件将留在本机并等待同步。";
  });
  refresh();
}

export async function mountSiteShell(base = document.body.dataset.root || "./") {
  const root = new URL(base, location.href);
  const header = document.querySelector(".navwrap");
  const nav = header?.querySelector(".navbar");
  if (!nav || nav.dataset.kvMounted === "true") return;
  nav.dataset.kvMounted = "true";

  const styles = make("link");
  styles.rel = "stylesheet";
  styles.href = new URL("assets/css/site-architecture.css", root).href;
  document.head.append(styles);
  nav.classList.add("kv-navbar");

  const oldLinks = nav.querySelector(".navlinks");
  const links = make("div", "navlinks kv-navlinks");
  links.id = "kv-site-navigation";
  links.setAttribute("aria-label", "全站导航分区");
  let topics = [];
  let groups = [
    { id: "knowledge", label: "知识体系", path: "knowledge/", activePaths: ["knowledge/"], sections: [] },
    { id: "experience", label: "实践体验", path: "works/", activePaths: ["works/", "lab/", "gallery/", "puzzles/"], sections: [] },
    { id: "learning", label: "学习成长", path: "progress/", activePaths: ["progress/", "review/", "timeline/", "provenance/"], sections: [] },
  ];

  try {
    const responses = await Promise.all([
      fetch(new URL("content/knowledge.json", root)),
      fetch(new URL("content/navigation.json", root)),
    ]);
    for (const response of responses) if (!response.ok) throw new Error("导航注册表 HTTP " + response.status);
    const [knowledge, navigation] = await Promise.all(responses.map(response => response.json()));
    if (!Array.isArray(knowledge.topics) || !Array.isArray(navigation.groups)) {
      throw new Error("导航注册表结构无效");
    }
    topics = knowledge.topics;
    groups = navigation.groups.map(group => ({
      ...group,
      sections: group.id === "knowledge"
        ? [...(group.sections || []), ...buildKnowledgeSections(topics)]
        : (group.sections || []),
    }));
  } catch (error) {
    console.warn("[KNOWVERSE] navigation registry unavailable; using safe fallback:", error);
  }

  groups.forEach(group => {
    const item = createGroup(group, root, links);
    if (item) links.append(item);
  });
  if (oldLinks) oldLinks.replaceWith(links);
  else nav.append(links);

  const brand = nav.querySelector(".mark");
  const search = nav.querySelector("#search-open");
  const mobile = nav.querySelector("#mobile-menu");
  if (brand) brand.href = root.href;
  if (search) search.setAttribute("aria-label", "全站搜索知识与作品");
  if (mobile) {
    mobile.setAttribute("aria-label", "展开全站导航");
    mobile.setAttribute("aria-controls", links.id);
    mobile.setAttribute("aria-expanded", "false");
    if (!mobile.dataset.kvBound) {
      mobile.dataset.kvBound = "true";
      mobile.addEventListener("click", () => {
        mobile.setAttribute("aria-expanded", String(links.classList.contains("open")));
      });
    }
  }

  mountGlobalAccount(root, nav);
  document.addEventListener("click", event => {
    if (event.target.closest(".kv-nav-group") || event.target.closest(".kv-global-account")) return;
    closeGroups(links);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeGroups(links);
      nav.querySelector(".kv-global-account")?.removeAttribute("open");
    }
  });
}
