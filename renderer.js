// 화면 로직: 브라우저 조작 + 페이지 추출 + Claude 대화
const $ = (id) => document.getElementById(id);
const MAX_CHARS = 200000; // 한 번에 보낼 페이지 텍스트 상한
const HOME = "https://www.naver.com";
const params = new URLSearchParams(location.search);
const WIN_NO = params.get("win") || "1";
const BASE_TITLE = "네이버 + Claude 브라우저" + (WIN_NO !== "1" ? ` · 창 ${WIN_NO}` : "");
document.title = BASE_TITLE;

// ---------- 탭 ----------
// 페이지는 main 프로세스가 탭마다 WebContentsView로 띄운다. 여기서는 탭 막대를 그리고, 페이지 자리의 위치를 알려준다.
let state = { tabs: [], activeId: null };
const activeTab = () => state.tabs.find((t) => t.id === state.activeId) || {};
const tabsApi = window.api.tabs;

function renderTabs() {
  const bar = $("tabbar");
  bar.querySelectorAll(".tab").forEach((e) => e.remove());
  for (const t of state.tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === state.activeId ? " active" : "");
    el.title = t.title || t.url || "";
    el.innerHTML = '<span class="title"></span><button class="close" title="탭 닫기 (Ctrl+W)">×</button>';
    el.querySelector(".title").textContent = (t.loading ? "⏳ " : "") + (t.title || t.url || "새 탭");
    el.onclick = () => tabsApi.activate(t.id);
    el.onauxclick = (e) => { if (e.button === 1) tabsApi.close(t.id); }; // 가운데 클릭으로 닫기
    el.querySelector(".close").onclick = (e) => { e.stopPropagation(); tabsApi.close(t.id); };
    bar.insertBefore(el, $("new-tab"));
    if (t.id === state.activeId) el.scrollIntoView({ inline: "nearest" });
  }
  const a = activeTab();
  if (document.activeElement !== $("url")) $("url").value = a.url && a.url !== "about:blank" ? a.url : "";
  $("back").disabled = !a.canGoBack;
  $("forward").disabled = !a.canGoForward;
  updateStar();
}
tabsApi.onState((s) => { state = s; renderTabs(); });
tabsApi.getState().then((s) => { state = s; renderTabs(); });
window.api.onFocusAddress(() => { $("url").focus(); $("url").select(); });

// 페이지 자리(#views)의 위치·크기를 main에 알려 페이지를 거기에 맞춘다 (대화창 접기, 창 크기 변경 등)
let boundsRaf = 0;
function reportBounds() {
  cancelAnimationFrame(boundsRaf);
  boundsRaf = requestAnimationFrame(() => {
    const r = $("views").getBoundingClientRect();
    tabsApi.setBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
  });
}
new ResizeObserver(reportBounds).observe($("views"));
new ResizeObserver(reportBounds).observe(document.body);
window.addEventListener("resize", reportBounds);
reportBounds();

const newTabFromUser = () => tabsApi.create(HOME, { activate: true, focus: "address" }); // 바로 주소를 칠 수 있게
$("new-tab").onclick = newTabFromUser;
$("new-window").onclick = () => window.api.newWindow();

// Claude 작업 확인 창 켜기/끄기 (모든 창에 같이 적용)
function showConfirm(on) { $("confirm-toggle").textContent = "확인 창: " + (on ? "켬" : "끔"); $("confirm-toggle").classList.toggle("on", on); }
window.api.getConfirm().then(showConfirm);
window.api.onConfirmChanged(showConfirm);
$("confirm-toggle").onclick = async () => showConfirm(await window.api.setConfirm(!$("confirm-toggle").classList.contains("on")));
window.api.onTabsShortcut((key) => {
  if (key === "bookmark") toggleBookmark();
  else if (key === "bookmarkbar") setBookmarkBar(document.body.classList.contains("bm-hidden"));
  else if (key === "panel") togglePanel();
});
// Ctrl+T / Ctrl+N / Ctrl+W / Ctrl+Tab / F5 는 앱 메뉴 단축키로 main에서 처리

// ---------- 브라우저 ----------
$("back").onclick = () => window.api.nav("back");
$("forward").onclick = () => window.api.nav("forward");
$("reload").onclick = () => window.api.nav("reload");
$("home").onclick = () => window.api.nav("home");
// 한글 입력 중(조합 중)에 Enter를 누르면 마지막 글자가 아직 확정되지 않았으므로, 확정된 뒤에 처리한다
function onEnterAfterIme(el, handler, needCtrl = false) {
  let pending = false, timer = null, last = 0;
  const fire = () => { clearTimeout(timer); timer = null; pending = false; if (Date.now() - last < 150) return; last = Date.now(); handler(); };
  el.addEventListener("keydown", (e) => {
    const isEnter = e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter";
    if (!isEnter) return;
    if (needCtrl && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (e.isComposing || e.keyCode === 229) { pending = true; return; } // 조합 중: 확정(compositionend)을 기다림
    fire(); // 일반 Enter, 또는 Windows에서 확정 직후 한 번 더 오는 Enter (한 번만 실행)
  });
  el.addEventListener("compositionend", () => {
    if (!pending) return;
    clearTimeout(timer);
    timer = setTimeout(fire, 30); // 확정된 글자가 값에 들어간 뒤 실행 (그 사이 Enter가 또 오면 그쪽에서 한 번만)
  });
}

function goFromAddressBar() {
  const pick = suggestPick();  // 추천 목록에서 고른 항목이 있으면 그것
  closeSuggest();
  if (pick) { window.api.nav("load", pick); return; }
  const v = $("url").value.trim();
  if (!v) return;
  // 주소처럼 보이면 열고(포트·localhost 포함), 아니면 네이버 검색
  const looksLikeUrl = /^https?:\/\//i.test(v) || /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/.*)?$/i.test(v);
  window.api.nav("load", looksLikeUrl ? (/^https?:/i.test(v) ? v : "https://" + v)
    : "https://search.naver.com/search.naver?query=" + encodeURIComponent(v)); // 이동 후 페이지로 커서
}
onEnterAfterIme($("url"), goFromAddressBar);

// ---------- 주소창 자동완성 (북마크 + 방문 기록) ----------
let sgItems = [], sgSel = -1, sgOpen = false, sgReq = 0, composing = false;
const urlBox = $("url");
const bareUrl = (u) => String(u).replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
const looksUrl = (v) => /^https?:\/\//i.test(v) || /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/.*)?$/i.test(v);

async function openSuggest() {
  if (sgOpen) return;
  sgOpen = true;
  const shot = await window.api.overlay(true); // 페이지를 그림으로 바꿔 목록이 가려지지 않게
  if (!sgOpen) { window.api.overlay(false); return; }
  $("views").style.backgroundImage = shot ? `url("${shot}")` : "";
  $("suggest").hidden = false;
}
function closeSuggest() {
  if (!sgOpen) return;
  sgOpen = false; sgItems = []; sgSel = -1;
  $("suggest").hidden = true;
  window.api.overlay(false).then(() => { $("views").style.backgroundImage = ""; });
}
function suggestPick() {
  if (!sgOpen || sgSel < 0 || !sgItems[sgSel]) return null;
  return sgItems[sgSel].url || null; // url 없는 항목(검색/열기)은 주소창 값으로 처리
}
function renderSuggest(typed) {
  const box = $("suggest");
  box.innerHTML = "";
  sgItems.forEach((it, i) => {
    const el = document.createElement("div");
    el.className = "sg" + (i === sgSel ? " sel" : "");
    const ic = document.createElement("span"); ic.className = "ic"; ic.textContent = it.icon;
    const t = document.createElement("span"); t.className = "t"; t.textContent = it.label;
    el.append(ic, t);
    if (it.url) { const u = document.createElement("span"); u.className = "u"; u.textContent = bareUrl(it.url); el.append(u); }
    el.onmousedown = (e) => { e.preventDefault(); sgSel = i; goFromAddressBar(); }; // blur보다 먼저
    box.appendChild(el);
  });
}
async function updateSuggest(inlineOk) {
  const typed = urlBox.value.slice(0, urlBox.selectionStart).trim();
  if (!typed) { closeSuggest(); return; }
  const req = ++sgReq;
  const found = await window.api.suggest(typed);
  if (req !== sgReq || document.activeElement !== urlBox) return; // 더 최근 입력이 있으면 버림
  sgItems = [
    looksUrl(typed) ? { icon: "↗", label: `${typed} 열기` } : { icon: "🔍", label: `네이버에서 "${typed}" 검색` },
    ...found.map((f) => ({ icon: f.type === "bookmark" ? "★" : "🕘", label: f.title, url: f.url })),
  ];
  sgSel = -1;
  // 크롬처럼 주소 앞부분이 맞으면 나머지를 미리 채움 (지우는 중이거나 한글 조합 중에는 하지 않음)
  const top = found.find((f) => f.prefix);
  if (inlineOk && top && !composing && urlBox.selectionStart === urlBox.value.length) {
    const full = bareUrl(top.url);
    if (full.toLowerCase().startsWith(typed.toLowerCase()) && full.length > typed.length) {
      urlBox.value = typed + full.slice(typed.length);
      urlBox.setSelectionRange(typed.length, full.length);
      sgSel = sgItems.findIndex((it) => it.url === top.url);
    }
  }
  renderSuggest(typed);
  openSuggest();
}
urlBox.addEventListener("compositionstart", () => { composing = true; });
urlBox.addEventListener("compositionend", () => { composing = false; updateSuggest(false); });
urlBox.addEventListener("input", (e) => {
  const inlineOk = e.inputType === "insertText" && !e.isComposing; // 글자를 더할 때만 미리 채움
  updateSuggest(inlineOk);
});
urlBox.addEventListener("keydown", (e) => {
  if (!sgOpen || e.isComposing) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = sgItems.length;
    sgSel = e.key === "ArrowDown" ? (sgSel + 1) % n : (sgSel - 1 + n) % n;
    const it = sgItems[sgSel];
    if (it && it.url) urlBox.value = bareUrl(it.url);
    renderSuggest();
  } else if (e.key === "Escape") {
    e.preventDefault(); closeSuggest();
    const a = activeTab(); urlBox.value = a.url || "";
  }
});
urlBox.addEventListener("blur", () => setTimeout(closeSuggest, 120));
urlBox.addEventListener("focus", () => urlBox.select());
// ---------- 북마크 (크롬처럼: 아이콘, 폴더 펼침 메뉴, » 넘침, 끌어서 옮기기) ----------
// bookmarks = 트리. 맨 위 배열 = 북마크 막대. "기타 북마크"·"모바일 북마크" 폴더는 크롬처럼 오른쪽 끝에.
let bookmarks = [];
let favMap = {};
const bmApi = window.api.bookmarks;
const RIGHT_FOLDERS = ["기타 북마크", "모바일 북마크"];
const normUrl = (u) => String(u || "").replace(/\/$/, "");
const currentUrl = () => activeTab().url || "";
const GLOBE = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="#5f6368" stroke-width="1.3"/><path d="M1.5 8h13M8 1.5c2 2 2 11 0 13M8 1.5c-2 2-2 11 0 13" fill="none" stroke="#5f6368" stroke-width="1.1"/></svg>');
const FOLDER_SVG = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.5h4.2l1.5 1.5h7.3v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="none" stroke="#5f6368" stroke-width="1.3" stroke-linejoin="round"/></svg>';

function findBookmarkByUrl(list, url) {
  for (const n of list) {
    if (n.type === "url" && normUrl(n.url) === normUrl(url)) return n;
    if (n.type === "folder") { const f = findBookmarkByUrl(n.children, url); if (f) return f; }
  }
  return null;
}
// 항목의 위치: { node, parentId(null=막대), index, list }
function locate(id, list = bookmarks, parentId = null) {
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    if (n.id === id) return { node: n, parentId, index: i, list };
    if (n.type === "folder") { const r = locate(id, n.children, n.id); if (r) return r; }
  }
  return null;
}
const countUrls = (n) => n.type === "url" ? 1 : n.children.reduce((s, c) => s + countUrls(c), 0);
function updateStar() {
  if (!state.activeId) return;
  const on = !!findBookmarkByUrl(bookmarks, currentUrl());
  const btn = $("bookmark");
  btn.classList.toggle("on", on);
  btn.textContent = on ? "★" : "☆";
  btn.title = on ? "북마크 수정·삭제 (Ctrl+D)" : "이 페이지 북마크 (Ctrl+D)";
}
const below = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.bottom + 2]; };
// 아이콘을 받아오지 못한 사이트는 다시 시도하지 않는다 (인증서가 맞지 않는 사이트 등에서 같은 오류가 반복되지 않게)
const failedIcons = new Set(JSON.parse((() => { try { return localStorage.getItem("failedIcons") || "[]"; } catch { return "[]"; } })()));
function iconFor(node) {
  if (node.type === "folder") { const s = document.createElement("span"); s.innerHTML = FOLDER_SVG; return s.firstChild; }
  const img = document.createElement("img");
  img.className = "ico";
  let origin = "";
  try { origin = new URL(node.url).origin; } catch {}
  // 방문해서 기록된 아이콘이 있으면 그것, 없으면 사이트의 기본 아이콘을 한 번만 시도
  const src = favMap[origin] || (origin && !failedIcons.has(origin) ? origin + "/favicon.ico" : "");
  img.src = src || GLOBE;
  img.onerror = () => {
    img.onerror = null;
    img.src = GLOBE;
    if (origin && !favMap[origin]) {
      failedIcons.add(origin);
      try { localStorage.setItem("failedIcons", JSON.stringify([...failedIcons].slice(-500))); } catch {}
    }
  };
  return img;
}
const modeOf = (e) => (e.ctrlKey || e.metaKey || e.button === 1 ? "background" : e.shiftKey ? "newwindow" : "here");

// ---- 페이지 위에 HTML을 띄울 때: 페이지를 그림으로 바꿔 보여줌 (여러 곳이 함께 써도 되게 횟수로 관리) ----
let overlayCount = 0;
async function overlayOn() {
  if (overlayCount++ > 0) return;
  const shot = await window.api.overlay(true);
  if (overlayCount > 0) $("views").style.backgroundImage = shot ? `url("${shot}")` : "";
}
function overlayOff() {
  if (overlayCount === 0 || --overlayCount > 0) return;
  window.api.overlay(false).then(() => { if (overlayCount === 0) $("views").style.backgroundImage = ""; });
}

// ---- 이름 입력 창 ----
function askName(title, value = "") {
  return new Promise(async (resolve) => {
    closeMenus();
    await overlayOn();
    const box = $("modal"), input = $("modal-input");
    $("modal-title").textContent = title;
    input.value = value;
    box.hidden = false;
    input.focus(); input.select();
    let done = false;
    const finish = (v) => { if (done) return; done = true; box.hidden = true; overlayOff(); resolve(v); };
    onEnterAfterIme(input, () => finish(input.value.trim() || null)); // 한글 이름도 끝 글자까지
    input.onkeydown = (e) => { if (e.key === "Escape") finish(null); };
    $("modal-ok").onclick = () => finish(input.value.trim() || null);
    $("modal-cancel").onclick = () => finish(null);
  });
}
async function handleBmAction(act) {
  if (!act) return;
  if (act.action === "rename") {
    const name = await askName("이름 바꾸기", act.title);
    if (name) await bmApi.rename(act.id, name);
  } else if (act.action === "newfolder") {
    const name = await askName("새 폴더 이름", "새 폴더");
    if (name) await bmApi.newFolder(name, act.parentId || null);
  } else if (act.action === "newfolder-move") {
    const name = await askName("새 폴더 이름 (이 북마크를 넣을 폴더)", "새 폴더");
    if (name) { const fid = await bmApi.newFolder(name, null); await bmApi.move(act.id, fid); }
  } else if (act.action === "hidebar") setBookmarkBar(false);
}
async function contextFor(id, e) {
  e.preventDefault(); e.stopPropagation();
  const act = await bmApi.menu(id);
  closeMenus();
  handleBmAction(act);
}

// ---- 끌어서 옮기기 ----
let dragId = null, hoverOpenTimer = null;
function clearDropMarks() { document.querySelectorAll(".drop-before,.drop-after,.drop-into").forEach((el) => el.classList.remove("drop-before", "drop-after", "drop-into")); }
// el: 대상 요소, node: 대상 항목, vertical: 메뉴 안(위·아래)이면 true, 막대(좌·우)면 false
function makeDraggable(el, node, vertical) {
  el.draggable = true;
  el.addEventListener("dragstart", (e) => { dragId = node.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", node.type === "url" ? node.url : node.title); el.classList.add("dragging"); });
  el.addEventListener("dragend", () => { dragId = null; el.classList.remove("dragging"); clearDropMarks(); clearTimeout(hoverOpenTimer); });
  el.addEventListener("dragover", (e) => {
    if (!dragId || dragId === node.id) return;
    e.preventDefault(); e.stopPropagation();
    const r = el.getBoundingClientRect();
    const t = vertical ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    const where = node.type === "folder" && t > 0.25 && t < 0.75 ? "into" : t < 0.5 ? "before" : "after";
    if (!el.classList.contains("drop-" + where)) {
      clearDropMarks(); el.classList.add("drop-" + where);
      clearTimeout(hoverOpenTimer);
      // 끌고 가다 폴더 위에 잠깐 있으면 펼침 (크롬처럼)
      if (where === "into") hoverOpenTimer = setTimeout(() => openFolderMenu(node.id, el, vertical ? "side" : "below", vertical ? menuLevelOf(el) + 1 : 0), 600);
    }
  });
  el.addEventListener("dragleave", () => { el.classList.remove("drop-before", "drop-after", "drop-into"); });
  el.addEventListener("drop", async (e) => {
    e.preventDefault(); e.stopPropagation();
    const id = dragId; dragId = null;
    const where = el.classList.contains("drop-into") ? "into" : el.classList.contains("drop-before") ? "before" : "after";
    clearDropMarks(); clearTimeout(hoverOpenTimer);
    if (!id) return;
    try {
      if (where === "into") await bmApi.move(id, node.id, null);
      else { const loc = locate(node.id); await bmApi.move(id, loc.parentId, loc.index + (where === "after" ? 1 : 0)); }
    } catch (err) { /* 폴더를 자기 안으로 옮기는 경우 등은 무시 */ }
  });
}

// ---- 폴더 펼침 메뉴 (HTML, 크롬처럼 아이콘·하위 폴더 옆으로 펼침) ----
const menus = []; // [{ el, key }]
const menuLevelOf = (el) => { const m = el.closest(".bm-menu"); return m ? Number(m.dataset.level) : -1; };
function closeMenus(fromLevel = 0) {
  while (menus.length > fromLevel) { menus.pop().el.remove(); }
  if (fromLevel === 0 && menuOverlay) { menuOverlay = false; overlayOff(); }
}
let menuOverlay = false;
// key: 폴더 id 또는 "overflow"(» 버튼). where: below(막대 아래) | side(옆으로)
async function openFolderMenu(key, anchor, where = "below", level = 0) {
  if (menus[level] && menus[level].key === key) return;
  closeMenus(level);
  if (!menuOverlay) { menuOverlay = true; overlayOn(); }
  const items = key === "overflow" ? overflowItems : (locate(key) || {}).node?.children || [];
  const m = document.createElement("div");
  m.className = "bm-menu";
  m.dataset.level = level;
  for (const n of items) {
    const row = document.createElement("div");
    row.className = "bm-row" + (n.type === "folder" ? " is-folder" : "");
    row.title = n.type === "url" ? `${n.title}\n${n.url}` : n.title;
    const label = document.createElement("span"); label.className = "t"; label.textContent = n.title;
    row.append(iconFor(n), label);
    if (n.type === "folder") {
      const arrow = document.createElement("span"); arrow.className = "arrow"; arrow.textContent = "›"; row.append(arrow);
      let t = null;
      row.addEventListener("mouseenter", () => { t = setTimeout(() => openFolderMenu(n.id, row, "side", level + 1), 180); });
      row.addEventListener("mouseleave", () => clearTimeout(t));
      row.addEventListener("click", () => openFolderMenu(n.id, row, "side", level + 1));
    } else {
      row.addEventListener("mouseenter", () => { if (menus.length > level + 1) closeMenus(level + 1); });
      row.addEventListener("click", (e) => { closeMenus(); bmApi.open(n.url, modeOf(e)); });
      row.addEventListener("auxclick", (e) => { if (e.button === 1) { closeMenus(); bmApi.open(n.url, "background"); } });
    }
    row.addEventListener("contextmenu", (e) => contextFor(n.id, e));
    makeDraggable(row, n, true);
    m.appendChild(row);
  }
  if (!items.length) { const empty = document.createElement("div"); empty.className = "bm-row empty"; empty.textContent = "(비어 있음)"; m.appendChild(empty); }
  // 빈 곳에 놓으면 이 폴더 맨 끝으로
  m.addEventListener("dragover", (e) => { if (dragId && key !== "overflow") e.preventDefault(); });
  m.addEventListener("drop", async (e) => { e.preventDefault(); const id = dragId; dragId = null; clearDropMarks(); if (id && key !== "overflow" && id !== key) { try { await bmApi.move(id, key, null); } catch {} } });
  const total = key === "overflow" ? items.filter((n) => n.type === "url").length : items.reduce((s, c) => s + countUrls(c), 0);
  if (total) {
    const sep = document.createElement("div"); sep.className = "bm-sep"; m.appendChild(sep);
    const all = document.createElement("div"); all.className = "bm-row"; all.textContent = `모두 새 탭으로 열기 (${total}개)`;
    all.addEventListener("click", () => {
      const urls = []; const walk = (l) => l.forEach((x) => (x.type === "url" ? urls.push(x.url) : walk(x.children)));
      walk(key === "overflow" ? items.filter((n) => n.type === "url") : items);
      closeMenus();
      urls.slice(0, 30).forEach((u, i) => bmApi.open(u, i === 0 ? "newtab" : "background"));
    });
    m.appendChild(all);
  }
  document.body.appendChild(m);
  // 위치: 막대 아래 또는 옆. 창 밖으로 나가면 반대쪽으로.
  const a = anchor.getBoundingClientRect(), mw = m.offsetWidth, vw = window.innerWidth, vh = window.innerHeight;
  let left = where === "below" ? a.left : a.right - 4, top = where === "below" ? a.bottom + 2 : a.top - 6;
  if (left + mw > vw - 8) left = where === "below" ? Math.max(8, vw - mw - 8) : Math.max(8, a.left - mw + 4);
  m.style.left = left + "px";
  m.style.top = top + "px";
  m.style.maxHeight = Math.max(120, vh - top - 12) + "px";
  menus[level] = { el: m, key };
}
document.addEventListener("mousedown", (e) => { if (menus.length && !e.target.closest(".bm-menu") && !e.target.closest("#bookmarks")) closeMenus(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menus.length) closeMenus(); });

// ---- 북마크 막대 ----
let overflowItems = [];
function barButton(n) {
  const btn = document.createElement("button");
  btn.className = "bm" + (n.type === "folder" ? " bm-folder" : "");
  const label = document.createElement("span"); label.className = "t"; label.textContent = n.title;
  btn.append(iconFor(n), label);
  if (n.type === "folder") {
    btn.title = n.title;
    btn.onclick = () => (menus[0] && menus[0].key === n.id ? closeMenus() : openFolderMenu(n.id, btn, "below", 0));
    // 메뉴가 열린 상태에서 다른 폴더로 마우스를 옮기면 그 폴더가 열림 (크롬처럼)
    btn.onmouseenter = () => { if (menus.length && menus[0].key !== n.id && !dragId) openFolderMenu(n.id, btn, "below", 0); };
  } else {
    btn.title = `${n.title}\n${n.url}`;
    btn.onclick = (e) => bmApi.open(n.url, modeOf(e));
    btn.onauxclick = (e) => { if (e.button === 1) bmApi.open(n.url, "background"); };
  }
  btn.oncontextmenu = (e) => contextFor(n.id, e);
  makeDraggable(btn, n, false);
  return btn;
}
function renderBookmarks() {
  const bar = $("bookmarks");
  bar.innerHTML = "";
  const main = document.createElement("div"); main.id = "bm-items";
  const chev = document.createElement("button"); chev.id = "bm-chevron"; chev.className = "bm"; chev.textContent = "»"; chev.title = "다른 북마크"; chev.hidden = true;
  chev.onclick = () => (menus[0] && menus[0].key === "overflow" ? closeMenus() : openFolderMenu("overflow", chev, "below", 0));
  const right = document.createElement("div"); right.id = "bm-right";
  const barItems = bookmarks.filter((n) => !(n.type === "folder" && RIGHT_FOLDERS.includes(n.title)));
  for (const n of barItems) main.appendChild(barButton(n));
  for (const n of bookmarks.filter((n) => n.type === "folder" && RIGHT_FOLDERS.includes(n.title))) right.appendChild(barButton(n));
  if (!bookmarks.length) { const hint = document.createElement("span"); hint.className = "bm-hint"; hint.textContent = "북마크를 추가하려면 ☆(Ctrl+D)을 누르세요"; main.appendChild(hint); }
  bar.append(main, chev, right);
  // 빈 곳에 놓으면 막대 맨 끝으로
  main.addEventListener("dragover", (e) => { if (dragId) e.preventDefault(); });
  main.addEventListener("drop", async (e) => { if (e.target !== main) return; e.preventDefault(); const id = dragId; dragId = null; clearDropMarks(); if (id) { try { await bmApi.move(id, null, null); } catch {} } });
  layoutBar();
}
// 다 들어가지 않는 북마크는 숨기고 » 메뉴로 (크롬처럼)
function layoutBar() {
  const main = $("bm-items"), chev = $("bm-chevron");
  if (!main) return;
  const btns = [...main.querySelectorAll(":scope > .bm")];
  btns.forEach((b) => (b.hidden = false));
  chev.hidden = true;
  overflowItems = [];
  const barItems = bookmarks.filter((n) => !(n.type === "folder" && RIGHT_FOLDERS.includes(n.title)));
  const limit = main.clientWidth;
  let cut = btns.findIndex((b) => b.offsetLeft + b.offsetWidth > limit);
  if (cut === -1) return;
  chev.hidden = false;
  const limit2 = main.clientWidth; // » 가 자리를 차지한 뒤 다시 계산
  cut = btns.findIndex((b) => b.offsetLeft + b.offsetWidth > limit2);
  if (cut === -1) cut = btns.length;
  btns.slice(cut).forEach((b) => (b.hidden = true));
  overflowItems = barItems.slice(cut);
}
new ResizeObserver(() => layoutBar()).observe($("bookmarks"));

// 막대 빈 곳 우클릭: 새 폴더, 크롬에서 가져오기, 막대 숨기기
$("bookmarks").addEventListener("contextmenu", async (e) => {
  if (e.target.closest(".bm")) return;
  e.preventDefault();
  handleBmAction(await bmApi.barMenu());
});
// Ctrl+Shift+B: 북마크 막대 보이기/숨기기 (크롬처럼)
function setBookmarkBar(show) {
  document.body.classList.toggle("bm-hidden", !show);
  try { localStorage.setItem("bookmarkBar", show ? "1" : "0"); } catch {}
}
try { setBookmarkBar(localStorage.getItem("bookmarkBar") !== "0"); } catch { setBookmarkBar(true); }

async function toggleBookmark() {
  const url = currentUrl();
  if (!/^https?:/i.test(url)) return;
  const existing = findBookmarkByUrl(bookmarks, url);
  // 크롬처럼: 없으면 추가하고 폴더 고르기, 이미 있으면 같은 메뉴로 폴더·이름 바꾸기·삭제
  const id = existing ? existing.id : await bmApi.add(activeTab().title || url, url, null);
  handleBmAction(await bmApi.chooseFolder(id, ...below($("bookmark"))));
}
$("bookmark").onclick = toggleBookmark;
bmApi.onChanged((tree) => { bookmarks = tree; closeMenus(); renderBookmarks(); updateStar(); });
bmApi.onFavicons((f) => { favMap = f; renderBookmarks(); });
Promise.all([bmApi.list(), bmApi.favicons()]).then(([tree, f]) => { bookmarks = tree; favMap = f || {}; renderBookmarks(); updateStar(); });


async function getPage() {
  const p = await tabsApi.extract(); // main이 현재 탭에서 글을 뽑아 준다
  const usingSelection = Boolean(p.selection);
  let body = (usingSelection ? p.selection : p.text).replace(/\n{3,}/g, "\n\n").trim();
  const truncated = body.length > MAX_CHARS;
  if (truncated) body = body.slice(0, MAX_CHARS);
  return { ...p, body, usingSelection, truncated };
}

// ---------- Claude 앱(MCP)이 조작 중일 때 표시 ----------
let mcpTimer = null;
window.api.onMcpActivity((label) => {
  clearTimeout(mcpTimer);
  if (label) { $("mcp-activity").textContent = "🤖 Claude가 조작 중 · " + label; $("mcp-activity").hidden = false; document.title = "🤖 " + label; }
  else mcpTimer = setTimeout(() => { $("mcp-activity").hidden = true; document.title = BASE_TITLE; }, 1500);
});

// ---------- 앱 안의 Claude 패널 접기/펴기 (창이 좁으면 기본으로 접힘) ----------
function setPanel(show) {
  document.body.classList.toggle("panel-hidden", !show);
  $("toggle-panel").classList.toggle("on", show);
  try { localStorage.setItem("panel", show ? "1" : "0"); } catch {}
}
{
  let saved = null;
  try { saved = localStorage.getItem("panel"); } catch {}
  setPanel(saved === null ? window.innerWidth >= 1100 : saved === "1");
}
const togglePanel = () => setPanel(document.body.classList.contains("panel-hidden"));
$("toggle-panel").onclick = togglePanel;
$("collapse-panel").onclick = () => setPanel(false);

// ---------- 설정 ----------
// 고른 모델은 다음 실행 때도 기억
try { const m = localStorage.getItem("model"); if (m) $("model").value = m; } catch {}
if (!$("model").value) $("model").value = "claude-haiku-5-5";
$("model").onchange = () => { try { localStorage.setItem("model", $("model").value); } catch {} };
$("settings").onclick = () => { $("key-box").hidden = !$("key-box").hidden; };
$("save-key").onclick = async () => {
  if (!$("key").value.trim()) return;
  await window.api.saveKey($("key").value);
  $("key").value = "";
  $("key-box").hidden = true;
  setStatus("API 키를 저장했습니다.");
};
window.api.hasKey().then((has) => { if (!has) { $("key-box").hidden = false; setStatus("먼저 API 키를 입력하세요."); } });

// ---------- 대화 ----------
let history = [];        // Claude API로 보내는 messages
let current = null;      // { requestId, el }

function addMsg(cls, text, meta) {
  const el = document.createElement("div");
  el.className = "msg " + cls;
  el.textContent = text;
  if (meta) { const m = document.createElement("div"); m.className = "meta"; m.textContent = meta; el.appendChild(m); }
  $("chat").appendChild(el);
  $("chat").scrollTop = $("chat").scrollHeight;
  return el;
}
function setStatus(t) { $("status").textContent = t; }
function busy(on) { $("send").disabled = on; $("stop").hidden = !on; }

window.api.onDelta(({ requestId, text }) => {
  if (current && current.requestId === requestId) {
    current.el.textContent += text;
    $("chat").scrollTop = $("chat").scrollHeight;
  }
});

async function send(question) {
  question = question.trim();
  if (!question || current) return;

  let content = question;
  let meta = "";
  if ($("attach").checked) {
    try {
      const p = await getPage();
      content =
        `<page title="${p.title.replace(/"/g, "'")}" url="${p.url}">\n${p.body}\n</page>\n\n` +
        `${p.usingSelection ? "(위 내용은 사용자가 선택한 부분입니다)\n" : ""}질문: ${question}`;
      meta = `📎 ${p.usingSelection ? "선택한 텍스트" : "페이지"} 첨부: ${p.title} (${p.body.length.toLocaleString()}자` +
        `${p.truncated ? `, ${MAX_CHARS.toLocaleString()}자에서 잘림` : ""})`;
    } catch (e) {
      addMsg("error", "페이지 내용을 읽지 못했습니다: " + e.message);
      return;
    }
  }

  addMsg("user", question, meta);
  history.push({ role: "user", content });
  $("question").value = "";

  const requestId = crypto.randomUUID();
  current = { requestId, el: addMsg("assistant", "") };
  busy(true);
  setStatus("Claude가 생각 중...");

  const res = await window.api.ask(requestId, history, $("model").value);
  if (res.ok) {
    current.el.textContent = res.text;
    history.push({ role: "assistant", content: res.text });
    setStatus(`완료 (${$("model").selectedOptions[0].text.split(" ·")[0]}) · 입력 ${res.usage.input_tokens.toLocaleString()} / 출력 ${res.usage.output_tokens.toLocaleString()} 토큰`);
  } else {
    if (!current.el.textContent) current.el.remove();
    addMsg("error", res.error);
    history.pop(); // 실패한 질문은 대화 기록에서 제거
    setStatus("");
  }
  current = null;
  busy(false);
}

$("send").onclick = () => send($("question").value);
onEnterAfterIme($("question"), () => send($("question").value), true);
document.querySelectorAll("#quick button").forEach((b) => (b.onclick = () => send(b.dataset.q)));
$("stop").onclick = () => current && window.api.abort(current.requestId);
$("clear").onclick = () => { if (current) return; history = []; $("chat").innerHTML = ""; setStatus("새 대화를 시작합니다."); };
