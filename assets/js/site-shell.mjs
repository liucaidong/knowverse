import { BACKEND_CONFIG } from "./backend/config.mjs";
import { createSupabaseAuthClient } from "./backend/auth.mjs";

const auth = createSupabaseAuthClient();

function closeNavigation(groups, links, mobileToggle) {
  groups.forEach(group => {
    group.classList.remove("is-open");
    const toggle = group.querySelector(".kv-nav-toggle");
    const menu = group.querySelector(".kv-nav-submenu");
    toggle?.setAttribute("aria-expanded", "false");
    if (menu) menu.hidden = true;
  });
  links?.classList.remove("open");
  mobileToggle?.setAttribute("aria-expanded", "false");
}

function markCurrentRoute(groups) {
  const current = new URL(location.href);
  for (const group of groups) {
    const activeRouteIds = new Set((group.dataset.activeRoutes || "").split(/\s+/).filter(Boolean));
    let groupActive = false;
    for (const link of group.querySelectorAll("a[data-route-id]")) {
      const target = new URL(link.href, location.href);
      const targetPath = target.pathname.endsWith("/") ? target.pathname : target.pathname + "/";
      const currentPath = current.pathname.endsWith("/") ? current.pathname : current.pathname + "/";
      const samePath = target.pathname.endsWith("/") ? currentPath.startsWith(targetPath) : current.pathname === target.pathname;
      const hashMatch = !target.hash || target.hash === current.hash;
      const active = activeRouteIds.has(link.dataset.routeId) && samePath && hashMatch;
      if (active) {
        link.setAttribute("aria-current", "page");
        groupActive = true;
      } else {
        link.removeAttribute("aria-current");
      }
    }
    group.classList.toggle("is-current", groupActive);
    const topLink = group.querySelector(".kv-nav-link");
    if (groupActive) topLink?.setAttribute("aria-current", "page");
    else topLink?.removeAttribute("aria-current");
  }
}

function mountNavigation(nav) {
  const links = nav.querySelector("#kv-site-navigation");
  const groups = [...(links?.querySelectorAll(".kv-nav-group") || [])];
  const mobileToggle = nav.querySelector("#mobile-menu");
  if (!links) return;
  if (nav.dataset.kvBehaviorMounted === "true") return;
  nav.dataset.kvBehaviorMounted = "true";

  groups.forEach(group => {
    const toggle = group.querySelector(".kv-nav-toggle");
    const menu = group.querySelector(".kv-nav-submenu");
    if (!toggle || !menu) return;
    toggle.addEventListener("click", () => {
      const shouldOpen = toggle.getAttribute("aria-expanded") !== "true";
      closeNavigation(groups, null, null);
      if (shouldOpen) {
        group.classList.add("is-open");
        toggle.setAttribute("aria-expanded", "true");
        menu.hidden = false;
      }
    });
    menu.addEventListener("click", event => {
      if (event.target.closest("a")) closeNavigation(groups, links, mobileToggle);
    });
  });

  mobileToggle?.addEventListener("click", () => {
    const open = !links.classList.contains("open");
    links.classList.toggle("open", open);
    mobileToggle.setAttribute("aria-expanded", String(open));
    if (!open) closeNavigation(groups, links, mobileToggle);
  });
  document.addEventListener("click", event => {
    if (event.target.closest(".kv-nav-group") || event.target.closest(".kv-global-account") || event.target.closest("#mobile-menu")) return;
    closeNavigation(groups, links, mobileToggle);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeNavigation(groups, links, mobileToggle);
      nav.querySelector(".kv-global-account")?.removeAttribute("open");
    }
  });
  markCurrentRoute(groups);
}

function mountGlobalAccount(root, nav) {
  const details = nav.querySelector("#kv-global-account");
  if (!details || details.dataset.kvBehaviorMounted === "true") return;
  details.dataset.kvBehaviorMounted = "true";

  const state = details.querySelector("[data-kv-account-state]");
  const dot = details.querySelector(".kv-account-dot");
  const message = details.querySelector("[data-kv-account-message]");
  const identity = details.querySelector("[data-kv-account-identity]");
  const signIn = details.querySelector("[data-kv-sign-in]");
  const signOut = details.querySelector("[data-kv-sign-out]");

  function setStatus(status) {
    details.dataset.status = status;
    if (dot) dot.dataset.status = status;
  }

  async function refresh() {
    if (!state || !message || !signIn || !signOut) return;
    identity && (identity.hidden = true);
    setStatus("neutral");
    if (!BACKEND_CONFIG.enabled) {
      state.textContent = "本机学习可用";
      message.textContent = "云端账户尚未配置。公开知识、实验和本机学习仍可使用；当前不会尝试网络认证。";
      signIn.disabled = true;
      signIn.textContent = "云端尚未配置";
      signIn.hidden = false;
      signOut.hidden = true;
      return;
    }
    try {
      const session = await auth.getSession();
      if (!session) {
        state.textContent = "GitHub 登录";
        message.textContent = "登录用于关联个人学习档案。云端同步授权会单独检查，不会因登录而自动授予。";
        signIn.disabled = false;
        signIn.textContent = "使用 GitHub 登录";
        signIn.hidden = false;
        signOut.hidden = true;
        setStatus("anonymous");
        return;
      }
      const user = session.user || {};
      const displayName = user.user_metadata?.user_name || user.user_metadata?.full_name || user.email || user.id || "已认证账户";
      state.textContent = displayName;
      if (identity) {
        identity.textContent = "当前 GitHub 账户：" + displayName;
        identity.hidden = false;
      }
      message.textContent = "身份认证已完成。个人学习档案是否可同步，以账户白名单、RLS 与同步面板的实际结果为准。";
      signIn.hidden = true;
      signOut.hidden = false;
      setStatus("authenticated");
    } catch (error) {
      state.textContent = "账户状态待确认";
      message.textContent = "无法刷新认证状态：" + (error?.message || "网络异常") + "。本机学习不受影响。";
      signIn.disabled = false;
      signIn.textContent = "重试 GitHub 登录";
      signIn.hidden = false;
      signOut.hidden = true;
      setStatus("warning");
    }
  }

  signIn?.addEventListener("click", async () => {
    signIn.disabled = true;
    signIn.textContent = "正在跳转…";
    try {
      await auth.signInWithGitHub(root, location.href);
    } catch (error) {
      message.textContent = error?.message || "GitHub 登录启动失败。";
      signIn.disabled = false;
      signIn.textContent = "重试 GitHub 登录";
      setStatus("warning");
    }
  });

  signOut?.addEventListener("click", async () => {
    signOut.disabled = true;
    try {
      await auth.signOut();
      details.open = false;
      await refresh();
    } catch (error) {
      message.textContent = error?.message || "退出登录失败。";
      setStatus("warning");
    } finally {
      signOut.disabled = false;
    }
  });

  window.addEventListener("storage", event => {
    if (event.key === BACKEND_CONFIG.authStorageKey) refresh();
  });
  window.addEventListener("knowverse:sync-state", event => {
    const status = event.detail?.status;
    if (status === "pending-authorization") message.textContent = "GitHub 身份认证已完成，但该账户尚未获云端学习档案白名单授权；本机学习仍可继续。";
    if (status === "synced") message.textContent = "学习档案已完成本次云端同步。";
    if (status === "offline") message.textContent = "当前离线；学习事件保留在本机，等待网络恢复后同步。";
    if (status === "conflict") message.textContent = "检测到跨设备数据冲突，需要按同步引擎的冲突处理结果确认；不会静默覆盖。";
  });
  refresh();
}

export async function mountSiteShell(base = document.body.dataset.root || "./") {
  const root = new URL(base, location.href);
  const header = document.querySelector('header[data-kv-static-shell="true"]');
  const nav = header?.querySelector(".kv-navbar");
  if (!header || !nav) return false;
  if (!document.querySelector('link[href*="assets/css/site-architecture.css"]')) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = new URL("assets/css/site-architecture.css", root).href;
    document.head.append(stylesheet);
  }
  mountNavigation(nav);
  mountGlobalAccount(root, nav);
  return true;
}
