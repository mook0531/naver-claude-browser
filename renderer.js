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
// ---------- 북마크 (크롬처럼 폴더) ----------
// bookmarks = 트리. 맨 위 배열 = 북마크 막대. 폴더 펼침·우클릭 메뉴는 main이 크롬처럼 띄운다.
let bookmarks = [];
const bmApi = window.api.bookmarks;
const normUrl = (u) => String(u || "").replace(/\/$/, "");
const currentUrl = () => activeTab().url || "";
function findBookmarkByUrl(list, url) {
  for (const n of list) {
    if (n.type === "url" && normUrl(n.url) === normUrl(url)) return n;
    if (n.type === "folder") { const f = findBookmarkByUrl(n.children, url); if (f) return f; }
  }
  return null;
}
function updateStar() {
  if (!state.activeId) return;
  const on = !!findBookmarkByUrl(bookmarks, currentUrl());
  const btn = $("bookmark");
  btn.classList.toggle("on", on);
  btn.textContent = on ? "★" : "☆";
  btn.title = on ? "북마크 수정·삭제 (Ctrl+D)" : "이 페이지 북마크 (Ctrl+D)";
}
const below = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.bottom + 2]; };

// 이름 입력 창 (페이지가 위에 덮여 있어서, 열린 동안 페이지를 그림으로 바꿔 보여준다)
function askName(title, value = "") {
  return new Promise(async (resolve) => {
    const shot = await window.api.overlay(true);
    $("views").style.backgroundImage = shot ? `url("${shot}")` : "";
    const box = $("modal"), input = $("modal-input");
    $("modal-title").textContent = title;
    input.value = value;
    box.hidden = false;
    input.focus(); input.select();
    let done = false;
    const finish = (v) => {
      if (done) return; done = true;
      box.hidden = true;
      window.api.overlay(false).then(() => { $("views").style.backgroundImage = ""; });
      resolve(v);
    };
    onEnterAfterIme(input, () => finish(input.value.trim() || null)); // 한글 이름도 끝 글자까지
    input.onkeydown = (e) => { if (e.key === "Escape") finish(null); };
    $("modal-ok").onclick = () => finish(input.value.trim() || null);
    $("modal-cancel").onclick = () => finish(null);
  });
}
// main이 돌려준 "이름이 필요한 동작" 처리
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
  }
}

function renderBookmarks() {
  const bar = $("bookmarks");
  bar.innerHTML = "";
  for (const b of bookmarks) {
    const btn = document.createElement("button");
    btn.className = "bm" + (b.type === "folder" ? " bm-folder" : "");
    if (b.type === "folder") {
      btn.textContent = "📁 " + b.title;
      btn.title = `${b.title} (클릭: 펼치기 · 우클릭: 이름 바꾸기·이동·삭제)`;
      btn.onclick = () => bmApi.folderPopup(b.id, ...below(btn));
    } else {
      btn.textContent = b.title;
      btn.title = `${b.title}\n${b.url}\n(Ctrl+클릭: 새 탭 · 우클릭: 이름 바꾸기·폴더로 이동·삭제)`;
      btn.onclick = (e) => bmApi.open(b.url, e.ctrlKey || e.metaKey ? "background" : e.shiftKey ? "newwindow" : "here");
      btn.onauxclick = (e) => { if (e.button === 1) bmApi.open(b.url, "background"); };
    }
    btn.oncontextmenu = async (e) => { e.preventDefault(); e.stopPropagation(); handleBmAction(await bmApi.menu(b.id)); };
    bar.appendChild(btn);
  }
  const imp = document.createElement("button"); // 맨 끝: 크롬에서 가져오기
  imp.className = "bm bm-import";
  imp.textContent = "⤓ 크롬에서 가져오기";
  imp.title = "크롬의 북마크(폴더 구조 그대로)와 방문 기록을 가져옵니다 (이미 있는 것은 건너뜀). 방문 기록은 주소창 자동완성에 쓰입니다.";
  imp.onclick = () => bmApi.importChrome();
  bar.appendChild(imp);
}
// 막대의 빈 곳 우클릭: 새 폴더, 크롬에서 가져오기
$("bookmarks").addEventListener("contextmenu", async (e) => {
  if (e.target !== $("bookmarks")) return;
  e.preventDefault();
  handleBmAction(await bmApi.barMenu());
});
async function toggleBookmark() {
  const url = currentUrl();
  if (!/^https?:/i.test(url)) return;
  const existing = findBookmarkByUrl(bookmarks, url);
  // 크롬처럼: 없으면 추가하고 폴더 고르기, 이미 있으면 같은 메뉴로 폴더·이름 바꾸기·삭제
  const id = existing ? existing.id : await bmApi.add(activeTab().title || url, url, null);
  handleBmAction(await bmApi.chooseFolder(id, ...below($("bookmark"))));
}
$("bookmark").onclick = toggleBookmark;
bmApi.onChanged((tree) => { bookmarks = tree; renderBookmarks(); updateStar(); });
bmApi.list().then((tree) => { bookmarks = tree; renderBookmarks(); updateStar(); });


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
