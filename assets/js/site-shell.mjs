import { BACKEND_CONFIG } from "./backend/config.mjs";
import { createSupabaseAuthClient } from "./backend/auth.mjs";

const auth = createSupabaseAuthClient();
const create = (tag, className, value) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
};

function safeUrl(path, siteRoot) {
  if (typeof path !== "string" || !path) return null;
  const url = new URL(path.replace(/^\.\//, ""), siteRoot);
  return url.origin === siteRoot.origin && url.pathname.startsWith(siteRoot.pathname) ? url : null;
}

function isCurrent(path, siteRoot) {
  const target = safeUrl(path, siteRoot);
  return Boolean(target && location.pathname.startsWith(target.pathname));
}

function addStyles(siteRoot) {
  if (document.getElementById("knowverse-site-architecture-css")) return;
  const link = create("link");
  link.id = "knowverse-site-architecture-css";
  link.rel = "stylesheet";
  link.href = new URL("assets/css/site-architecture.css", siteRoot).href;
  document.head.append(link);
}

function createAnchor(label, path, siteRoot, active = false) {
  const url = safeUrl(path, siteRoot);
  if (!url) return null;
  const anchor = create("a", "kv-nav-subitem", label);
  anchor.href = url.href;
  if (active || isCurrent(path, siteRoot)) anchor.setAttribute("aria-current", "page");
  return anchor;
}

function createMenuGroup({ label, path, sections, activePaths = [] }, siteRoot) {
  const wrapper = create("div", "kv-nav-group");
  const top = create("div", "kv-nav-top");
  const groupActive = isCurrent(path, siteRoot) || activePaths.some(candidate => isCurrent(candidate, siteRoot));
  const anchor = createAnchor(label, path, siteRoot, groupActive);
  anchor.className = "kv-nav-link";
  const toggle = create("button", "kv-nav-toggle", "âŒ„");
  toggle.type = "button";
  toggle.setAttribute("aria-label", "å±•å¼€" + label + "èœå•");
  toggle.setAttribute("aria-expanded", "false");
  const menu = create("div", "kv-nav-submenu");
  menu.hidden = true;
  sections.forEach(section => {
    if (section.label) menu.append(create("div", "kv-nav-section-title", section.label));
    const list = create("div", "kv-nav-sublist");
    section.items.forEach(item => {
      const link = createAnchor(item.label, item.path, siteRoot);
      if (link) list.append(link);
    });
    if (list.childElementCount) menu.append(list);
  });
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    document.querySelectorAll(".kv-nav-group").forEach(group => {
      group.classList.remove("is-open");
      group.querySelector(".kv-nav-toggle")?.setAttribute("aria-expanded", "false");
      const submenu = group.querySelector(".kv-nav-submenu");
      if (submenu) submenu.hidden = true;
    });
    if (open) {
      wrapper.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      menu.hidden = false;
    }
  });
  top.append(anchor, toggle);
  wrapper.append(top, menu);
  return wrapper;
}

function buildGroups(knowledgeTopics, navigation, siteRoot) {
  const knowledgeSections = [];
  const groupedTopics = new Map();
  for (const topic of knowledgeTopics) {
    const key = topic.category || "å…¶ä»–ä¸“é¢˜";
    if (!groupedTopics.has(key)) groupedTopics.set(key, []);
    groupedTopics.get(key).push(topic);
  }
  for (const [category, topics] of groupedTopics) {
    knowledgeSections.push({
      label: category,
      items: topics.map(topic => ({ label: topic.title, path: topic.href })),
    });
  }
  return (navigation.groups || []).map(group => ({
    ...group,
    sections: group.id === "knowledge"
      ? [...(group.sections || []), ...knowledgeSections]
      : (group.sections || []),
  }));
}

function mountAccount(siteRoot, nav) {
  nav.querySelector("#kv-global-account")?.remove();
  const details = create("details", "kv-global-account");
  details.id = "kv-global-account";
  const summary = create("summary", "kv-account-trigger");
  const dot = create("span", "kv-account-dot");
  dot.setAttribute("aria-hidden", "true");
  const label = create("span", "kv-account-label");
  label.append(create("small", "", "å…¨ç«™è´¦æˆ·"));
  const state = create("strong", "kv-account-state", "æ­£åœ¨æ£€æŸ¥â€¦");
  label.append(state);
  summary.append(dot, label, create("span", "kv-account-chevron", "âŒ„"));

  const panel = create("div", "kv-account-panel");
  panel.append(create("strong", "kv-account-panel-title", "ä¸€ä¸ªè´¦æˆ·ï¼Œè´¯ç©¿æ•´ä¸ª KNOWVERSE"));
  panel.append(create("p", "kv-account-scope",
    "è¿™æ˜¯å…¨ç«™å…±äº«ç™»å½•ï¼Œä¸æ˜¯æŸä¸ªé¡µé¢çš„å•ç‹¬æˆæƒã€‚ç™»å½•çŠ¶æ€ä¿å­˜åœ¨å½“å‰ç«™ç‚¹ï¼Œè¿›å…¥çŸ¥è¯†åº“ã€å®éªŒå®¤ã€å±•å…ã€è§£è°œå’Œå­¦ä¹ é©¾é©¶èˆ±æ—¶å…±ç”¨åŒä¸€è´¦æˆ·ã€‚"));
  panel.append(create("p", "kv-account-scope",
    "ç™»å½•ç”¨é€”ï¼šåŒæ­¥ä¸ªäººå­¦ä¹ æ¡£æ¡ˆã€‚å…¬å¼€çŸ¥è¯†å†…å®¹ä¸äº’åŠ¨ä½œå“æ— éœ€ç™»å½•ã€‚GitHub OAuth ä»…è¯·æ±‚ read:user åŸºç¡€èº«ä»½ä¿¡æ¯ï¼›äº‘ç«¯æ¡£æ¡ˆåŒæ­¥è¿˜éœ€è¦è´¦æˆ·ç™½åå•æˆæƒã€‚"));
  const message = create("p", "kv-account-message", "æœªç™»å½•æ—¶ä»å¯åœ¨å½“å‰è®¾å¤‡å­¦ä¹ ï¼Œå­¦ä¹ è®°å½•ç»§ç»­ä¿å­˜åœ¨æœ¬æœºã€‚");
  const identity = create("p", "kv-account-identity", "");
  const signIn = create("button", "kv-account-action primary", "ä½¿ç”¨ GitHub ç™»å½•ï¼ˆå…¨ç«™ï¼‰");
  signIn.type = "button";
  signIn.disabled = !BACKEND_CONFIG.enabled;
  const archive = createAnchor("ç®¡ç†å­¦ä¹ æ¡£æ¡ˆä¸äº‘ç«¯åŒæ­¥ â†—", "progress/#cloud-account", siteRoot);
  archive.className = "kv-account-manage";
  const signOut = create("button", "kv-account-action", "é€€å‡ºå…¨ç«™è´¦æˆ·");
  signOut.type = "button";
  signOut.hidden = true;
  panel.append(message, identity, signIn, signOut, archive);
  details.append(summary, panel);
  nav.append(details);

  async function refresh() {
    details.dataset.status = "neutral";
    dot.dataset.status = "neutral";
    identity.textContent = "";
    if (!BACKEND_CONFIG.enabled) {
      state.textContent = "äº‘ç«¯æœªé…ç½®";
      message.textContent = "å½“å‰ç«™ç‚¹å°šæœªå¯ç”¨ Supabase äº‘ç«¯è´¦æˆ·ï¼›æ— éœ€ç™»å½•å³å¯ä½¿ç”¨å…¬å¼€çŸ¥è¯†å†…å®¹å’Œæœ¬åœ°å­¦ä¹ åŠŸèƒ½ã€‚";
      signIn.disabled = true;
      signOut.hidden = true;
      return;
    }
    signIn.disabled = false;
    try {
      const session = await auth.getSession();
      if (!session) {
        state.textContent = "æœªç™»å½• Â· æœ¬æœºå­¦ä¹ å¯ç”¨";
        message.textContent = "ç™»å½•åå¯ä½¿ç”¨åŒä¸€è´¦æˆ·è®¿é—®å…¨ç«™è´¦æˆ·çŠ¶æ€ï¼Œå¹¶ç”³è¯·è·¨è®¾å¤‡å­¦ä¹ æ¡£æ¡ˆåŒæ­¥ã€‚";
        details.dataset.status = "anonymous";
        dot.dataset.status = "anonymous";
        signIn.hidden=false;
        signOut.hidden=true;
        return;
      }
      const user = session.user || {};
      const displayName = user.user_metadata?.user_name || user.user_metadata?.full_name || user.email || user.id || "å·²è®¤è¯è´¦æˆ·";
      state.textContent = "å·²å½“å‰ ï¼Œå…¬å­¦ä¸ª";
      identity.textContent = "å½“å‰ä¸Šä¸ºè´¦æˆ·ï¼š" + displayName;
      message.textContent = "å½“å‰è´¦æˆ·å¯è§¤åˆ†è´¦æˆ·ææ‰Œï¼Œä¸šå…ˆå¤çš„ä»¬è®´æœ‰äºä»¥å…²ï¼Œå±ï¼šä¸ç»„å¸ˆæ¨¡æˆ‘å‰ï¼Œä¸åŠ¨å…³ç™»å½•ä¸‡è¿™é¢„é™¤8à ¹ )úgh¹¨hù¨b9§où..¹aá¹.#¹ki¹.h9¬¢y§oùaî¹§gù¥b9kf9¥b8à ˆÂˆ]Z[Ë™]\Ù]œİ]\ÈH˜]][XØ]YÂˆİ™]\Ù]œİ]\ÈH˜]][XØ]YÂˆÚYÛ’[‹šY[ˆHYNÂˆÚYÛ“İ]šY[ˆH˜[ÙNÂˆHØ]Ú
\œ›ÜŠHÂˆİ]K^ÛÛ[H¹.¤yêëù§*ºacyïkˆÂˆY\ÜØYÙK^ÛÛ[H¹¥è9¬åyb-ù¥¬9ænùoeyâ­¹  {ï&ˆˆ
È
\œ›Ü‹›Y\ÜØYÙH¹ïdyîç9o ¹n.ŠH
È¸à ¹k©9 ìù.ézaãy¥¬9ænùoe{ï#9.#yîá9.ë:+­9¥®yo#ù¥'ùo 9 &¹/g9dày¥¬9nlùl!ú+ 9.#yk®y )ù..¹/ey/g9d#y«i9c­ùcíù.èùcez+åxà ˆÂˆ]Z[Ë™]\Ù]œİ]\ÈHØ\›š[™ÈÂˆİ™]\Ù]œİ]\ÈHØ\›š[™ÈÂˆÚYÛ’[‹šY[ˆH˜[ÙNÂˆÚYÛ’[‹™\ØX›YH˜[ÙNÂˆBˆB‚ˆÚYÛ’[‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹\Ş[˜È

HOˆÂˆÚYÛ’[‹™\ØX›YHYNÂˆÚYÛ’[‹^ÛÛ[H¹§«ùd$9æ¡9åfz+íùbª9¢`ÂˆHÂˆ]ØZ]]]œÚYÛ’[•Ú]Ú]XŠÚ]T›ÛİØØ][Û‹š™YŠNÂˆHØ]Ú
\œ›ÜŠHÂˆY\ÜØYÙK^ÛÛ[H\œ›Ü‹›Y\ÜØYÙH‘Ú]Xˆ9fï¹âaù )ù/g9dày.+yo%y¦+ùo#ú/æy.#yk®y )ù.#9æ¡;ï"ˆÂˆÚYÛ’[‹™\ØX›YH˜[ÙNÂˆÚYÛ’[‹^ÛÛ[H¹g*9ki¹.h9¢`9¦+ùoêùcëùb%ÂˆBˆJNÂˆÚYÛ“İ]˜Y]™[\İ[™\Š˜ÛXÚÈ‹\Ş[˜È

HOˆÂˆÚYÛ“İ]™\ØX›YHYNÂˆHÂˆ]ØZ]]]œÚYÛ“İ]

NÂˆ]Z[Ë›Ü[ˆH˜[ÙNÂˆ]ØZ]™Yœ™\Ú

NÂˆHØ]Ú
\œ›ÜŠHÂˆY\ÜØYÙK^ÛÛ[H\œ›Ü‹›Y\ÜØYÙHº` 9aî¹aj9êæyk§¹i!ÈÂˆHš[˜[HÂˆÚYÛ“İ]™\ØX›YH˜[ÙNÂˆBˆJNÂˆÚ[™İË˜Y]™[\İ[™\ŠœİÜ˜YÙH‹]™[OˆÂˆYˆ
]™[šÙ^HOOHPÒÑS‘ĞÓÓ‘’QË˜]]İÜ˜YÙRÙ^JH™Yœ™\Ú

NÂˆJNÂˆÚ[™İË˜Y]™[\İ[™\ŠšÛ›İİ™\œÙNœŞ[˜Ë\İ]H‹]™[OˆÂˆÛÛœİİ]\ÈH]™[™]Z[Ëœİ]\ÎÂˆYˆ
İ]\ÈOOHœ[™[™ËX]]Üš^˜][ÛˆŠHY\ÜØYÙK^ÛÛ[H¹l#ùi#yæ¡9.åy/cy.©:+­ù.+y.#yæ¡9 .ù.©ùæ¡9d+ù.éyal»ï#9aiyo 9am9d#yæ¡;ï#9ak9o 9aiyk®y.#¹kîz,hybc{ï#9§+9§.¹ki¹.h9.#ycåùoí9..¹câ¹i#yoæHÂˆYˆ
İ]\ÈOOHœŞ[˜ÙYŠHY\ÜØYÙK^ÛÛ[H¹§#yaj9êæykeù­mú` ymì¹odùbcy¢-È‹ˆYˆ
İ]\ÈOOH›Ù™›[™HŠHY\ÜØYÙK^ÛÛ[H¹aj9o`ùcëù.éyd#9.#yk®y.#¹ë+9.©:+­ù.+z+ç9iâù/g9cî9cèù.¡¹æ¡;ï#9lg»ï&¹.#y©oyn©¹ëby  yçéy.â¹ë+9.©9.bù.í¹l!¹/çyåfy.#y.+yo%{ï!¹ê#¹n®ºfíùâj{ï ˆÂˆJNÂˆ™Yœ™\Ú

NÂŸB‚™^Ü\Ş[˜È[˜İ[Ûˆ[İ[Ú]TÚ[
˜\ÙHHØİ[Y[˜›ÙK™]\Ù]œ›Ûİ‹‹ÈŠHÂˆÛÛœİÚ]T›ÛİH™]ÈT“
˜\ÙKØØ][Û‹š™YŠNÂˆÛÛœİXY\ˆHØİ[Y[œ]Y\TÙ[XİÜŠ‹›˜]Ü˜\ŠNÂˆÛÛœİ˜]ˆHXY\Ëœ]Y\TÙ[XİÜŠ‹›˜]˜˜\ˆŠNÂˆYˆ
[˜]ŠH™]\›ÂˆYİ[\ÊÚ]T›Ûİ
NÂˆ˜]‹˜Û\ÜÓ\İ˜Y
šİ‹[˜]˜˜\ˆŠNÂˆÛÛœİœ˜[™H˜]‹œ]Y\TÙ[XİÜŠ‹›X\šÈŠNÂˆÛÛœİÙX\˜ÚH˜]‹œ]Y\TÙ[XİÜŠˆÜÙX\˜Ú[Ü[ˆŠNÂˆÛÛœİ[Øš[HH˜]‹œ]Y\TÙ[XİÜŠˆÛ[Øš[K[Y[HŠNÂˆÛÛœİÛ[šÜÈH˜]‹œ]Y\TÙ[XİÜŠ‹›˜]›[šÜÈŠNÂˆÛÛœİ[šÜÈHÜ™X]J™]ˆ‹›˜]›[šÜÈİ‹[˜]›[šÜÈŠNÂˆ[šÜËšYHšİ‹\Ú]K[˜]šYØ][ÛˆÂˆ[šÜËœÙ]]šX]J˜\šXK[X™[‹¹aj9êæykï:"*¹b!¹c.ˆŠNÂˆ]ÜXÜÈH×NÂˆ]˜]šYØ][ÛˆHÂˆÜ›İ\ÎˆÂˆÈYˆšÛ›İÛYÙH‹X™[ˆ¹çéz+á¹/dùìîÈ‹]ˆšÛ›İÛYÙKÈ‹Xİ]™T]ÎˆÈšÛ›İÛYÙKÈ—HKˆÈYˆ™^\šY[˜ÙH‹X™[ˆ¹k§º-íy/dúj£‹]ˆÛÜšÜËÈ‹Xİ]™T]ÎˆÈÛÜšÜËÈ‹›X‹È‹™Ø[\KÈ‹œ^›\ËÈ—HKˆÈYˆ›X\›š[™È‹X™[ˆ¹ki¹.h9¢$:eoÈ‹]ˆœ›ÙÜ™\ÜËÈ‹Xİ]™T]ÎˆÈœ›ÙÜ™\ÜËÈ‹œ™]šY]ËÈ‹[Y[[™KÈ‹œ›İ™[˜[˜ÙKÈ—HKˆKˆNÂˆHÂˆÛÛœİÚÛ›İÛYÙT™\ÜÛœÙK˜]šYØ][Û”™\ÜÛœÙWHH]ØZ]›ÛZ\ÙK˜[
Âˆ™]Ú
™]ÈT“
˜ÛÛ[ÚÛ›İÛYÙKšœÛÛˆ‹Ú]T›Ûİ
JKˆ™]Ú
™]ÈT“
˜ÛÛ[Û˜]šYØ][Û‹šœÛÛˆ‹Ú]T›Ûİ
JKˆJNÂˆYˆ
ZÛ›İÛYÙT™\ÜÛœÙK›ÚÊH›İÈ™]È\œ›ÜŠšÛ›İÛYÙKšœÛÛˆˆ
ÈÛ›İÛYÙT™\ÜÛœÙKœİ]\ÊNÂˆYˆ
[˜]šYØ][Û”™\ÜÛœÙK›ÚÊH›İÈ™]È\œ›ÜŠ›˜]šYØ][Û‹šœÛÛˆˆ
È˜]šYØ][Û”™\ÜÛœÙKœİ]\ÊNÂˆÛÛœİÚÛ›İÛYÙSX[šY™\İ˜]šYØ][Û“X[šY™\İHH]ØZ]›ÛZ\ÙK˜[
ÂˆÛ›İÛYÙT™\ÜÛœÙKšœÛÛŠ
K˜]šYØ][Û”™\ÜÛœÙKšœÛÛŠ
KˆJNÂˆYˆ
\œ˜^Kš\Ğ\œ˜^JÛ›İÛYÙSX[šY™\İÜXÜÊJHÜXÜÈHÛ›İÛYÙSX[šY™\İÜXÜÎÂˆYˆ
\œ˜^Kš\Ğ\œ˜^J˜]šYØ][Û“X[šY™\İ™Ü›İ\ÊJH˜]šYØ][ÛˆH˜]šYØ][Û“X[šY™\İÂˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š–ÒÓ“ÕÕ‘T”ÑWH˜]šYØ][Ûˆ™YÚ\İH[˜]˜Z[X›Nˆ‹\œ›ÜŠNÂˆBˆ›Üˆ
ÛÛœİÜ›İ\ÙˆZ[Ü›İ\ÊÜXÜË˜]šYØ][Û‹Ú]T›Ûİ
JH[šÜË˜\[™
Ü™X]SY[QÜ›İ\
Ü›İ\Ú]T›Ûİ
JNÂˆÛ[šÜÏËœ™\XÙUÚ]
[šÜÊNÂˆYˆ
[Û[šÜÊH˜]‹š[œÙ\™Y›Ü™J[šÜËÙX\˜Ú[
NÂˆYˆ
œ˜[™
Hœ˜[™š™YˆHÚ]T›Ûİš™YÂˆYˆ
[Øš[JHÂˆ[Øš[K^ÛÛ[Hº#ç9ceHÂˆ[Øš[KœÙ]]šX]J˜\šXK[X™[‹¹leyo 9aj9êæykï:"*ˆŠNÂˆ[Øš[KœÙ]]šX]J˜\šXKXÛÛ›ÛÈ‹[šÜËšY
NÂˆ[Øš[KœÙ]]šX]J˜\šXKY^[™Y‹™˜[ÙHŠNÂˆYˆ
[[Øš[K™]\Ù]šİ›İ[™
HÂˆ[Øš[K™]\Ù]šİ›İ[™HYHÂˆ[Øš[K˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆ[Øš[KœÙ]]šX]J˜\šXKY^[™Y‹İš[™Ê[šÜË˜Û\ÜÓ\İ˜ÛÛZ[œÊ›Ü[ˆŠJJJNÂˆBˆBˆYˆ
ÙX\˜Ú
HÙX\˜ÚœÙ]]šX]J˜\šXK[X™[‹¹aj9êæy¤'9í(¹çéz+á¹.#¹/g9dàHŠNÂˆ[İ[XØÛİ[
Ú]T›Ûİ˜]ŠNÂˆØİ[Y[˜Y]™[\İ[™\Š˜ÛXÚÈ‹]™[OˆÂˆYˆ
]™[\™Ù]˜ÛÜÙ\İ
‹šİ‹[˜]‹YÜ›İ\ŠH]™[\™Ù]˜ÛÜÙ\İ
‹šİ‹YÛØ˜[XXØÛİ[ŠJH™]\›Âˆ[šÜËœ]Y\TÙ[XİÜ[
‹šİ‹[˜]‹YÜ›İ\ŠK™›Ü‘XXÚ
Ü›İ\OˆÂˆÜ›İ\˜Û\ÜÓ\İœ™[[İ™Jš\Ë[Ü[ˆŠNÂˆÜ›İ\œ]Y\TÙ[XİÜŠ‹šİ‹[˜]‹]ÙÙÛHŠOËœÙ]]šX]J˜\šXKY^[™Y‹™˜[ÙHŠNÂˆÛÛœİİX›Y[HHÜ›İ\œ]Y\TÙ[XİÜŠ‹šİ‹[˜]‹\İX›Y[HŠNÂˆYˆ
İX›Y[JHİX›Y[KšY[ˆHYNÂˆJNÂˆJNÂˆØİ[Y[˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹]™[OˆÂˆYˆ
]™[šÙ^HOOH‘\ØØ\HŠHÂˆ[šÜËœ]Y\TÙ[XİÜ[
‹šİ‹[˜]‹YÜ›İ\ŠK™›Ü‘XXÚ
Ü›İ\OˆÂˆÜ›İ\˜Û\ÜÓ\İœ™[[İ™Jš\Ë[Ü[ˆŠNÂˆÜ›İ\œ]Y\TÙ[XİÜŠ‹šİ‹[˜]‹]ÙÙÛHŠOËœÙ]]šX]J˜\šXKY^[™Y‹™˜[ÙHŠNÂˆÛÛœİİX›Y[HHÜ›İ\œ]Y\TÙ[XİÜŠ‹šİ‹[˜]‹\İX›Y[HŠNÂˆYˆ
İX›Y[JHİX›Y[KšY[ˆHYNÂˆJNÂˆ˜]‹œ]Y\TÙ[XİÜŠ‹šİ‹YÛØ˜[XXØÛİ[ŠOËœ™[[İ™P]šX]J›Ü[ˆŠNÂˆBˆJNÂŸB