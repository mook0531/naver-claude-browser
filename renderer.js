// 화면 로직: 브라우저 조작 + 페이지 추출 + Claude 대화
const $ = (id) => document.getElementById(id);
const MAX_CHARS = 200000; // 한 번에 보낼 페이지 텍스트 상한
const HOME = "https://www.naver.com";
const params = new URLSearchParams(location.search);
const WIN_NO = params.get("win") || "1";
const BASE_TITLE = "네이버 + Claude 브라우저" + (WIN_NO !== "1" ? ` · 창 ${WIN_NO}` : "");
document.title = BASE_TITLE;

// ---------- 탭 ----------
const tabs = new Map(); // id -> { id, view, el }
let activeId = null;
const view = () => tabs.get(activeId).view; // 지금 보고 있는 탭의 webview

function createTab(url = HOME, activate = true, focus = "page") {
  const id = window.api.allocTabId(); // 모든 창을 통틀어 겹치지 않는 번호
  const wv = document.createElement("webview");
  wv.setAttribute("allowpopups", "");
  wv.src = "about:blank"; // 빈 페이지로 먼저 붙여 바로 등록한 뒤 실제 주소를 연다
  $("views").appendChild(wv);

  const el = document.createElement("div");
  el.className = "tab";
  el.innerHTML = '<span class="title">새 탭</span><button class="close" title="탭 닫기 (Ctrl+W)">×</button>';
  el.onclick = () => activateTab(id);
  el.onauxclick = (e) => { if (e.button === 1) closeTab(id); }; // 가운데 클릭으로 닫기
  el.querySelector(".close").onclick = (e) => { e.stopPropagation(); closeTab(id); };
  $("tabbar").insertBefore(el, $("new-tab"));

  const tab = { id, view: wv, el, registered: null };
  tab.registered = new Promise((resolve) => {
    // 느리거나 실패하는 페이지라도 탭은 바로 조작할 수 있게: 빈 페이지가 준비되면 등록 → 실제 주소 열기
    wv.addEventListener("dom-ready", () => {
      window.api.registerTab(id, wv.getWebContentsId());
      wv.loadURL(url).catch(() => {});
      resolve();
    }, { once: true });
  });
  const setTitle = (t) => { el.querySelector(".title").textContent = t || wv.getURL() || "새 탭"; el.title = t || ""; };
  wv.addEventListener("page-title-updated", (e) => setTitle(e.title));
  wv.addEventListener("did-navigate", (e) => { if (activeId === id && e.url !== "about:blank") $("url").value = e.url; });
  wv.addEventListener("did-navigate-in-page", (e) => { if (e.isMainFrame && activeId === id) $("url").value = e.url; });
  tabs.set(id, tab);
  if (activate || !activeId) activateTab(id, { focus });
  return tab;
}

function activateTab(id, { focus = "page" } = {}) {
  const tab = tabs.get(id);
  if (!tab) return;
  activeId = id;
  for (const t of tabs.values()) {
    t.view.classList.toggle("active", t.id === id);
    t.el.classList.toggle("active", t.id === id);
    if (t.id !== id) { try { t.view.blur(); } catch {} } // 숨겨진 탭이 키보드 입력(한/영 포함)을 잡고 있지 않게
  }
  let u = "";
  try { u = tab.view.getURL(); } catch {}
  $("url").value = u && u !== "about:blank" ? u : "";
  tab.el.scrollIntoView({ inline: "nearest" });
  // 키보드 입력이 보이는 탭으로 가게: 새 빈 탭이면 주소창, 아니면 페이지
  if (focus === "address") { $("url").focus(); $("url").select(); }
  else if (focus === "page") tab.view.focus();
  window.api.tabActivated(id);
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  const order = [...tabs.keys()];
  const i = order.indexOf(id);
  tab.view.remove();
  tab.el.remove();
  tabs.delete(id);
  window.api.tabClosed(id);
  if (!tabs.size) { window.api.closeWindow(); return; } // 마지막 탭을 닫으면 이 창을 닫는다
  else if (activeId === id) activateTab(order[i + 1] || order[i - 1]);
}

function cycleTab(step) {
  const order = [...tabs.keys()];
  activateTab(order[(order.indexOf(activeId) + step + order.length) % order.length]);
}

const newTabFromUser = () => createTab(HOME, true, "address"); // 사용자가 연 새 탭: 바로 주소를 칠 수 있게
$("new-tab").onclick = newTabFromUser;
$("new-window").onclick = () => window.api.newWindow();

// Claude 작업 확인 창 켜기/끄기 (모든 창에 같이 적용)
function showConfirm(on) { $("confirm-toggle").textContent = "확인 창: " + (on ? "켬" : "끔"); $("confirm-toggle").classList.toggle("on", on); }
window.api.getConfirm().then(showConfirm);
window.api.onConfirmChanged(showConfirm);
$("confirm-toggle").onclick = async () => showConfirm(await window.api.setConfirm(!$("confirm-toggle").classList.contains("on")));
window.api.onTabsOpen(({ url, activate }) => createTab(url, activate));
window.api.onTabsShortcut((key) => {
  if (key === "new") newTabFromUser();
  else if (key === "close") closeTab(activeId);
  else if (key === "next") cycleTab(1);
  else if (key === "prev") cycleTab(-1);
});
document.addEventListener("keydown", (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === "t") { e.preventDefault(); newTabFromUser(); }
  else if (k === "n") { e.preventDefault(); window.api.newWindow(); }
  else if (k === "w") { e.preventDefault(); closeTab(activeId); }
  else if (k === "tab") { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); }
});

// Claude(MCP)가 보내는 탭 명령: 새 탭 / 전환 / 닫기
window.api.onTabsCommand(async ({ reqId, op, args }) => {
  try {
    let result = null;
    if (op === "new") { const t = createTab(args.url || HOME, true); await t.registered; result = t.id; }
    else if (op === "switch") { if (!tabs.has(args.id)) throw new Error(args.id + " 탭이 없습니다."); activateTab(args.id); result = args.id; }
    else if (op === "close") {
      if (!tabs.has(args.id)) throw new Error(args.id + " 탭이 없습니다.");
      // 마지막 탭이면 창이 닫히므로 먼저 답하고 닫는다
      window.api.tabsCommandDone(reqId, { ok: true, result: tabs.size === 1 ? "window-closed" : activeId });
      closeTab(args.id);
      return;
    }
    window.api.tabsCommandDone(reqId, { ok: true, result });
  } catch (e) {
    window.api.tabsCommandDone(reqId, { ok: false, error: e.message });
  }
});

// ---------- 브라우저 ----------
$("back").onclick = () => view().canGoBack() && view().goBack();
$("forward").onclick = () => view().canGoForward() && view().goForward();
$("reload").onclick = () => view().reload();
$("home").onclick = () => view().loadURL(HOME);
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
  const v = $("url").value.trim();
  if (!v) return;
  const looksLikeUrl = /^https?:\/\//i.test(v) || /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v);
  view().loadURL(looksLikeUrl ? (/^https?:/i.test(v) ? v : "https://" + v)
    : "https://search.naver.com/search.naver?query=" + encodeURIComponent(v)).catch(() => {});
  view().focus(); // 이동 후에는 페이지에서 바로 입력·스크롤할 수 있게
}
onEnterAfterIme($("url"), goFromAddressBar);
createTab(params.get("url") || HOME); // 새 창이 주소를 받아 열렸으면 그 주소로

// 페이지에서 텍스트 추출 (블로그·카페처럼 iframe 안에 본문이 있는 경우도 포함)
const EXTRACT = `(() => {
  const sel = [];
  const parts = [];
  const walk = (win) => {
    try {
      const doc = win.document;
      const s = String(win.getSelection() || "").trim();
      if (s) sel.push(s);
      if (doc.body) parts.push(doc.body.innerText);
      for (const f of doc.querySelectorAll("iframe")) { try { if (f.contentWindow) walk(f.contentWindow); } catch {} }
    } catch {}
  };
  walk(window);
  return { title: document.title, url: location.href, selection: sel.join("\\n"), text: parts.join("\\n\\n") };
})()`;

async function getPage() {
  const p = await view().executeJavaScript(EXTRACT);
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
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); togglePanel(); }
});
window.api.onTabsShortcut((key) => { if (key === "panel") togglePanel(); });

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
