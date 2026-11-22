// 화면 로직: 브라우저 조작 + 페이지 추출 + Claude 대화
const $ = (id) => document.getElementById(id);
const view = $("view");
const MAX_CHARS = 200000; // 한 번에 보낼 페이지 텍스트 상한

// ---------- 브라우저 ----------
$("back").onclick = () => view.canGoBack() && view.goBack();
$("forward").onclick = () => view.canGoForward() && view.goForward();
$("reload").onclick = () => view.reload();
$("home").onclick = () => view.loadURL("https://www.naver.com");
$("url").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const v = $("url").value.trim();
  if (!v) return;
  const looksLikeUrl = /^https?:\/\//i.test(v) || /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v);
  view.loadURL(looksLikeUrl ? (/^https?:/i.test(v) ? v : "https://" + v)
    : "https://search.naver.com/search.naver?query=" + encodeURIComponent(v));
});
const syncUrl = (e) => { $("url").value = e.url; };
view.addEventListener("did-navigate", syncUrl);
view.addEventListener("did-navigate-in-page", (e) => e.isMainFrame && syncUrl(e));

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
  const p = await view.executeJavaScript(EXTRACT);
  const usingSelection = Boolean(p.selection);
  let body = (usingSelection ? p.selection : p.text).replace(/\n{3,}/g, "\n\n").trim();
  const truncated = body.length > MAX_CHARS;
  if (truncated) body = body.slice(0, MAX_CHARS);
  return { ...p, body, usingSelection, truncated };
}

// ---------- 설정 ----------
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

  const res = await window.api.ask(requestId, history);
  if (res.ok) {
    current.el.textContent = res.text;
    history.push({ role: "assistant", content: res.text });
    setStatus(`완료 · 입력 ${res.usage.input_tokens.toLocaleString()} / 출력 ${res.usage.output_tokens.toLocaleString()} 토큰`);
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
$("question").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send($("question").value); });
document.querySelectorAll("#quick button").forEach((b) => (b.onclick = () => send(b.dataset.q)));
$("stop").onclick = () => current && window.api.abort(current.requestId);
$("clear").onclick = () => { if (current) return; history = []; $("chat").innerHTML = ""; setStatus("새 대화를 시작합니다."); };
