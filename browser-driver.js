// 브라우저 조작 모듈: 탭의 페이지(WebContentsView)를 코드로 움직인다.
// MCP 서버(mcp-server.js)가 이 함수들을 Claude의 도구로 노출한다.
const MAX_TEXT = 40000; // 한 번에 Claude에게 돌려줄 페이지 글자 수 상한

const { AsyncLocalStorage } = require("async_hooks");

// 사용자가 지금 보고 있는 탭 (대화 정보가 없는 호출과 첫 연결에 쓰임)
let wc = null;
let activeId = null;
let tabsApi = null;   // main.js가 넣어 주는 탭 목록/열기/전환/닫기
const setActive = (id, contents) => { activeId = id; wc = contents; };
const setTabs = (api) => { tabsApi = api; };
let bmApi = null;     // main.js가 넣어 주는 북마크 목록/추가
const setBookmarks = (api) => { bmApi = api; };

// ---------- Claude 대화(세션)별 작업 탭 ----------
// Claude 대화마다 자기 탭을 하나 갖는다. 도구 호출은 그 대화의 탭에서만 동작하므로 여러 대화가 동시에 써도 서로 섞이지 않는다.
// 호출마다 AsyncLocalStorage에 { sid, id, wc }를 두고, 아래 함수들은 그 탭을 쓴다.
const als = new AsyncLocalStorage();
const sessions = new Map(); // sid -> { tabId, lastUsed }
const IDLE_MS = 30 * 60 * 1000; // 30분 쓰지 않은 대화의 탭은 다른 대화가 써도 됨
const ctx = () => als.getStore();
const curId = () => (ctx() ? ctx().id : activeId);
const currentTabId = curId;
const otherSessionOn = (tabId, sid) => {
  for (const [s, v] of sessions) if (s !== sid && v.tabId === tabId && Date.now() - v.lastUsed < IDLE_MS) return true;
  return false;
};
function bindSession(id) {
  const c = ctx();
  if (!c || !c.sid) return;
  const t = needTabs().get(id);
  sessions.set(c.sid, { tabId: id, lastUsed: Date.now() });
  c.id = id;
  if (t) c.wc = t.wc;
}
// 대화의 탭 정하기: 이미 있으면 그대로, 처음이면 사용자가 보고 있는 탭, 그 탭을 다른 대화가 쓰고 있으면 새 창
async function resolveSession(sid) {
  if (!sid || !tabsApi) return null;
  const s = sessions.get(sid);
  if (s && tabsApi.get(s.tabId)) { s.lastUsed = Date.now(); return s.tabId; }
  let id = tabsApi.current();
  if (!id || !tabsApi.get(id) || otherSessionOn(id, sid)) id = await tabsApi.openWindow();
  sessions.set(sid, { tabId: id, lastUsed: Date.now() });
  return id;
}
function inSession(sid, tabId, fn) {
  const t = tabId && tabsApi && tabsApi.get(tabId);
  if (!sid || !t) return fn();
  return als.run({ sid, id: tabId, wc: t.wc }, fn);
}

const ready = () => {
  const c = ctx();
  const w = c ? c.wc : wc;
  if (!w || w.isDestroyed()) throw new Error(c ? "이 대화의 작업 탭이 닫혔습니다. 다시 요청하면 새 탭에서 이어서 합니다." : "브라우저 창이 열려 있지 않습니다. 네이버 + Claude 브라우저 앱을 실행하세요.");
  return w;
};
// 앱이 막 켜졌을 때는 첫 탭이 준비될 때까지 잠깐 기다린다 (최대 15초)
async function waitReady() {
  for (let i = 0; i < 150 && (!wc || wc.isDestroyed()); i++) await sleep(100);
  return ready();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 페이지 로딩이 끝날 때까지 기다림 (최대 timeoutMs)
async function settle(timeoutMs = 15000) {
  const c = ready();
  await sleep(400);
  if (!c.isLoading()) return;
  await Promise.race([
    new Promise((r) => c.once("did-stop-loading", r)),
    sleep(timeoutMs),
  ]);
  await sleep(300);
}

function cap(text, label = "페이지") {
  if (text.length <= MAX_TEXT) return text;
  return text.slice(0, MAX_TEXT) + `\n\n…(${label}가 길어 ${MAX_TEXT.toLocaleString()}자에서 잘렸습니다. 필요한 부분이 더 있으면 스크롤하거나 범위를 좁혀 다시 읽으세요.)`;
}

const where = () => {
  const n = tabsApi ? tabsApi.list().length : 1;
  const w = tabsApi ? tabsApi.windowCount() : 1;
  const winTag = w > 1 && tabsApi ? ` · 창 ${tabsApi.windowNoOf(curId())}` : "";
  return `현재 페이지 [${curId() || "tab"}${winTag}${n > 1 ? `, 탭 ${n}개${w > 1 ? `·창 ${w}개` : ""} 열림` : ""}]: ${ready().getTitle()} — ${ready().getURL()}`;
};

// ---------- 페이지 안에서 실행되는 도우미 ----------
// 요소마다 ref_N 번호를 붙여 기억한다(같은 요소는 같은 번호). iframe(같은 도메인) 안도 포함.
const PAGE_HELPER = `(() => {
  if (window.__cb) return;
  const map = new Map(), rev = new WeakMap(); let n = 0;
  const refOf = (el) => { let r = rev.get(el); if (!r) { r = "ref_" + (++n); rev.set(el, r); map.set(r, new WeakRef(el)); } return r; };
  const frameOffset = (el) => { let x = 0, y = 0, w = el.ownerDocument.defaultView;
    while (w && w !== window) { const f = w.frameElement; if (!f) break; const r = f.getBoundingClientRect(); x += r.left + f.clientLeft; y += r.top + f.clientTop; w = w.parent; }
    return { x, y }; };
  const rectOf = (el) => { const r = el.getBoundingClientRect(), o = frameOffset(el); return { x: r.left + o.x, y: r.top + o.y, w: r.width, h: r.height }; };
  const visible = (el) => { const s = el.ownerDocument.defaultView.getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const inView = (el) => { const r = rectOf(el); return r.y + r.h > 0 && r.x + r.w > 0 && r.y < innerHeight && r.x < innerWidth; };
  const clean = (t, max = 100) => { t = (t || "").replace(/\\s+/g, " ").trim(); return t.length > max ? t.slice(0, max) + "…" : t; };
  const role = (el) => {
    const ar = el.getAttribute("role"); if (ar) return ar;
    const t = el.tagName.toLowerCase(), ty = (el.getAttribute("type") || "").toLowerCase();
    if (t === "a" && el.hasAttribute("href")) return "link";
    if (t === "button" || (t === "input" && ["button","submit","reset","image"].includes(ty))) return "button";
    if (t === "input" && ty === "checkbox") return "checkbox";
    if (t === "input" && ty === "radio") return "radio";
    if (t === "input" && ty !== "hidden") return ty === "search" ? "searchbox" : "textbox";
    if (t === "textarea") return "textbox";
    if (t === "select") return "combobox";
    if (/^h[1-6]$/.test(t)) return "heading";
    if (t === "img" && el.alt) return "img";
    if (el.onclick || el.getAttribute("tabindex") === "0") return "clickable";
    return null; };
  const INTERACTIVE = new Set(["link","button","checkbox","radio","textbox","searchbox","combobox","clickable","tab","menuitem","option","switch"]);
  const nameOf = (el) => clean(el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") ||
    (el.labels && el.labels[0] && el.labels[0].innerText) || (el.tagName === "SELECT" ? "" : el.innerText) || el.getAttribute("placeholder") || (el.tagName === "SELECT" ? "" : el.value) || "");
  const describe = (el, r) => {
    let line = r + (nameOf(el) ? ' "' + nameOf(el) + '"' : "");
    if (el.tagName === "SELECT") { const o = el.options[el.selectedIndex]; if (o) line += " selected=" + JSON.stringify(clean(o.text, 40));
      line += " options=" + JSON.stringify([...el.options].slice(0, 15).map((x) => clean(x.text, 20)).join(" | ")); }
    else if (r === "textbox" || r === "searchbox" || r === "combobox") { if (el.value) line += " value=" + JSON.stringify(clean(el.value, 60)); if (el.placeholder) line += " placeholder=" + JSON.stringify(clean(el.placeholder, 60)); }
    if (r === "checkbox" || r === "radio") line += el.checked ? " (checked)" : " (unchecked)";
    return line + " [" + refOf(el) + "]"; };
  // 화면 전체 순회 (같은 도메인 iframe 포함)
  const each = (fn) => { const walk = (doc) => { for (const el of doc.querySelectorAll("*")) { fn(el);
      if (el.tagName === "IFRAME") { try { if (el.contentDocument) walk(el.contentDocument); } catch {} } } };
    walk(document); };
  window.__cb = {
    readPage(filter, rootRef, maxDepth) {
      const out = []; const all = filter === "all", onlyInteractive = filter === "interactive";
      const root = rootRef ? this.el(rootRef) : document.body;
      const visit = (node, depth) => {
        if (!node || out.length > 600 || depth > maxDepth) return;
        for (const el of node.children) {
          if (["SCRIPT","STYLE","NOSCRIPT","SVG","TEMPLATE"].includes(el.tagName)) continue;
          let next = depth;
          if (visible(el) && (all || inView(el))) {
            const r = role(el);
            if (r && (!onlyInteractive || INTERACTIVE.has(r))) { out.push("  ".repeat(depth) + describe(el, r)); next = depth + 1; }
            else if (!onlyInteractive && !r) {
              const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(" ");
              if (clean(own)) { out.push("  ".repeat(depth) + 'text "' + clean(own, 150) + '" [' + refOf(el) + "]"); }
            }
          }
          if (el.tagName === "IFRAME") { try { if (el.contentDocument) visit(el.contentDocument.body, next); } catch {} }
          else if (!(role(el) && ["link","button"].includes(role(el)))) visit(el, next);
        }
      };
      visit(root, 0);
      if (out.length > 600) out.push("…(요소가 많아 일부만 표시했습니다. filter=interactive 또는 ref로 범위를 좁히세요)");
      return out.join("\\n") || "(표시할 요소가 없습니다. 페이지를 스크롤하거나 filter=all 로 다시 읽어 보세요)";
    },
    find(query) {
      const words = query.toLowerCase().split(/\\s+/).filter(Boolean); const hits = [];
      each((el) => { if (["SCRIPT","STYLE","NOSCRIPT"].includes(el.tagName) || !visible(el)) return;
        let r = role(el), name;
        if (!r) { const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(" ");
          if (!clean(own)) return; r = "text"; name = clean(own, 150); } else name = nameOf(el);
        const hay = (r + " " + name + " " + (el.placeholder || "") + " " + (el.name || "") + " " + (el.id || "")).toLowerCase();
        const score = words.filter((w) => hay.includes(w)).length + (INTERACTIVE.has(r) ? 0.5 : 0);
        if (score >= 1) hits.push([score, el, r, name]); });
      hits.sort((a, b) => b[0] - a[0]);
      return hits.slice(0, 20).map(([, el, r, name]) => r === "text" ? 'text "' + name + '" [' + refOf(el) + "]" : describe(el, r)).join("\\n") || "(일치하는 요소가 없습니다)";
    },
    el(ref) { const w = map.get(ref); const el = w && w.deref();
      if (!el || !el.isConnected) throw new Error(ref + " 요소를 찾을 수 없습니다(페이지가 바뀌었을 수 있음). read_page로 다시 읽어 새 번호를 받으세요.");
      return el; },
    center(ref) { const el = this.el(ref); el.scrollIntoView({ block: "center", inline: "center" }); const r = rectOf(el);
      return { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) }; },
    focus(ref) { const el = this.el(ref); el.scrollIntoView({ block: "center" }); el.focus(); },
    scrollTo(ref) { this.el(ref).scrollIntoView({ block: "center" }); },
    setValue(ref, value) { const el = this.el(ref);
      if (el.type === "checkbox" || el.type === "radio") { if (el.checked !== !!value) el.click(); return; }
      if (el.tagName === "SELECT") { const opt = [...el.options].find((o) => o.value == value || o.text.trim() == String(value).trim());
        if (!opt) throw new Error("선택지에 " + value + " 이(가) 없습니다: " + [...el.options].map((o) => o.text.trim()).join(", "));
        el.value = opt.value; }
      else { const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value)); }
      el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); },
    scroll(x, y, dx, dy) {
      let el = document.elementFromPoint(x, y);
      while (el && el !== document.body && el !== document.documentElement) {
        const s = getComputedStyle(el);
        const canY = dy && /(auto|scroll|overlay)/.test(s.overflowY) && el.scrollHeight > el.clientHeight;
        const canX = dx && /(auto|scroll|overlay)/.test(s.overflowX) && el.scrollWidth > el.clientWidth;
        if (canY || canX) { el.scrollBy(dx, dy); return; }
        el = el.parentElement; }
      window.scrollBy(dx, dy); },
    text() {
      const parts = []; const walk = (doc) => { if (doc.body) parts.push(doc.body.innerText);
        for (const f of doc.querySelectorAll("iframe")) { try { if (f.contentDocument) walk(f.contentDocument); } catch {} } };
      walk(document); return parts.join("\\n\\n").replace(/\\n{3,}/g, "\\n\\n").trim(); },
    viewport() { return { w: innerWidth, h: innerHeight }; },
    // 클릭 대상 설명 (안전 확인용): 가장 가까운 누를 수 있는 요소의 글자·종류
    describeEl(el) {
      if (!el) return null;
      let t = el; while (t && t !== document.body && !role(t)) t = t.parentElement;
      t = t && role(t) ? t : el;
      const r = role(t) || t.tagName.toLowerCase();
      return { role: r, text: clean(nameOf(t) || t.innerText || "", 60), type: (t.type || "").toLowerCase(),
        password: (t.type || "").toLowerCase() === "password", toggle: ["checkbox","radio","switch"].includes(r) };
    },
    info(ref) { return this.describeEl(this.el(ref)); },
    infoAt(x, y) {
      let el = document.elementFromPoint(x, y), ox = 0, oy = 0;
      while (el && el.tagName === "IFRAME") { try { const r = el.getBoundingClientRect(); ox += r.left; oy += r.top;
        const inner = el.contentDocument.elementFromPoint(x - ox, y - oy); if (!inner) break; el = inner; } catch { break; } }
      return this.describeEl(el);
    },
    focused() { let el = document.activeElement;
      while (el && el.tagName === "IFRAME") { try { el = el.contentDocument.activeElement; } catch { break; } }
      return el && el !== document.body ? { ...this.describeEl(el), inForm: !!(el.form || el.closest && el.closest("form")) } : null; },
  };
})();`;

async function page(expr) {
  const c = ready();
  await c.executeJavaScript(PAGE_HELPER);
  try {
    return await c.executeJavaScript(expr);
  } catch (e) {
    // executeJavaScript는 페이지 쪽 오류 메시지를 잃어버리므로 다시 꺼내 본다
    throw new Error(String(e.message || e).replace(/^Script failed to execute.*?:\s*/i, "") || "페이지 스크립트 실행 실패");
  }
}

// 페이지 쪽 오류 메시지를 보존해 돌려주는 래퍼
const call = (js) => page(`(() => { try { return { ok: true, v: ${js} }; } catch (e) { return { ok: false, e: e.message }; } })()`)
  .then((r) => { if (!r.ok) throw new Error(r.e); return r.v; });

// ---------- 도구들 ----------
async function navigate(url) {
  const c = ready();
  if (url === "back") { if (c.canGoBack()) c.goBack(); }
  else if (url === "forward") { if (c.canGoForward()) c.goForward(); }
  else if (url === "reload") c.reload();
  else {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url;
    if (!/^https?:/i.test(url)) throw new Error("http/https 주소만 열 수 있습니다.");
    let failed = null;
    // 이번에 연 주소의 실패만 센다 (탭에서 이전에 로딩 중이던 다른 페이지의 실패는 무시)
    const norm = (u) => String(u).replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase();
    const onFail = (_e, code, desc, failedUrl, isMainFrame) => {
      if (isMainFrame && code !== -3 && norm(failedUrl) === norm(url)) failed = `${desc} (${failedUrl})`;
    };
    c.on("did-fail-load", onFail);
    c.loadURL(url).catch(() => {}); // 리다이렉트 등으로 생기는 중단(-3)은 무시하고 아래에서 결과 확인
    await settle(30000);
    c.removeListener("did-fail-load", onFail);
    if (failed) throw new Error("페이지를 열지 못했습니다: " + failed);
    return where();
  }
  await settle(30000);
  return where();
}

async function naverSearch(query, kind = "all") {
  const where_ = { all: "nexearch", news: "news", blog: "blog", cafe: "article", image: "image", kin: "kin" }[kind] || "nexearch";
  await navigate(`https://search.naver.com/search.naver?where=${where_}&query=${encodeURIComponent(query)}`);
  return `${where()}\n\n${cap(await call("__cb.text()"))}`;
}

const getPageText = async () => `${where()}\n\n${cap(await call("__cb.text()"))}`;

async function readPage(filter, ref, depth = 15) {
  const tree = await call(`__cb.readPage(${JSON.stringify(filter || null)}, ${JSON.stringify(ref || null)}, ${Number(depth) || 15})`);
  return `${where()}\n\n${cap(tree, "목록")}`;
}

// ---------- 안전 확인 ----------
// 저장·삭제·결제 같은 버튼, 네이버 광고의 켜기/끄기, 광고 화면의 Enter 제출은 앱이 직접 사용자에게 묻는다.
const SENSITIVE = /저장|등록|적용|완료|삭제|제거|결제|충전|구매|신청|게재|발행|전송|제출|변경|수정|해제|중지|중단|시작|켜기|끄기|입찰|확인|동의|\b(on|off|save|submit|delete|remove|apply|confirm|pay|buy|publish)\b/i;
const AD_HOST = /(^|\.)(searchad\.naver\.com|ads\.naver\.com|gfa\.naver\.com)$/i;
let confirmFn = async () => false; // main.js가 실제 확인 창으로 바꿔 끼운다
const setConfirm = (fn) => { confirmFn = fn; };
const onAdSite = () => { try { return AD_HOST.test(new URL(ready().getURL()).hostname); } catch { return false; } };

// what: "버튼 누르기" / "켜기" / "끄기"
async function guard(what, info) {
  if (!info) return;
  if (info.password) throw new Error("비밀번호 입력란은 조작할 수 없습니다. 로그인은 사용자가 직접 해 주세요.");
  const sensitive = SENSITIVE.test(info.text) || (onAdSite() && info.toggle);
  if (!sensitive) return;
  const label = `"${info.text || info.role}" ${what}`;
  const ok = await confirmFn(`Claude가 ${label}을(를) 하려고 합니다.`, `페이지: ${ready().getTitle()}\n${ready().getURL()}\n\n허용하면 실제로 실행됩니다.`);
  if (!ok) throw new Error(`사용자가 ${label}을(를) 허용하지 않았습니다. 다시 시도하지 말고 사용자에게 이유를 물어보세요.`);
}

const find = async (query) => `${where()}\n\n${await call(`__cb.find(${JSON.stringify(query)})`)}`;

// 마우스 이벤트를 실제 사용자 클릭처럼 보낸다
// ---------- 입력 보내기: 크롬 개발자 도구 프로토콜(CDP) ----------
// Claude가 쓰는 창은 사용자의 작업을 방해하지 않도록 포커스 없이 떠 있는 경우가 많다.
// 일반 키보드 이벤트는 포커스 없는 창에 전달되지 않으므로, CDP로 페이지에 직접 입력을 보낸다(포커스 필요 없음).
async function cdp(c) {
  const d = c.debugger;
  if (!d.isAttached()) {
    try {
      d.attach("1.3");
      // 페이지가 '포커스 없음'으로 판단해 입력을 무시하지 않도록 포커스가 있는 것처럼 동작시킨다
      await d.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    } catch { return null; } // 개발자 도구가 열려 있는 등으로 붙지 못하면 예전 방식으로
  }
  return d;
}
const KEYDEF = { // key 이름 → [code, keyCode]
  Enter: ["Enter", 13], Tab: ["Tab", 9], Backspace: ["Backspace", 8], Escape: ["Escape", 27], Delete: ["Delete", 46], Space: ["Space", 32],
  ArrowUp: ["ArrowUp", 38], ArrowDown: ["ArrowDown", 40], ArrowLeft: ["ArrowLeft", 37], ArrowRight: ["ArrowRight", 39],
  Home: ["Home", 36], End: ["End", 35], PageUp: ["PageUp", 33], PageDown: ["PageDown", 34],
};
const CDP_KEY_ALIASES = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", esc: "Escape", return: "Enter", del: "Delete", pgdn: "PageDown", pgup: "PageUp", space: "Space" };
function cdpKey(name) {
  const k = CDP_KEY_ALIASES[name.toLowerCase()] || Object.keys(KEYDEF).find((x) => x.toLowerCase() === name.toLowerCase()) || name;
  if (KEYDEF[k]) return { key: k === "Space" ? " " : k, code: KEYDEF[k][0], keyCode: KEYDEF[k][1], text: k === "Enter" ? "\r" : k === "Space" ? " " : "" };
  if (/^f\d{1,2}$/i.test(k)) { const n = Number(k.slice(1)); return { key: "F" + n, code: "F" + n, keyCode: 111 + n, text: "" }; }
  if (k.length === 1) {
    const up = k.toUpperCase();
    const code = /[a-z]/i.test(k) ? "Key" + up : /\d/.test(k) ? "Digit" + k : "";
    return { key: k, code, keyCode: up.charCodeAt(0), text: k };
  }
  return { key: k, code: k, keyCode: 0, text: "" };
}
const MOD_BITS = { alt: 1, control: 2, meta: 4, shift: 8 };

async function click({ ref, x, y, button = "left", clickCount = 1 }) {
  const c = ready();
  if (ref) ({ x, y } = await call(`__cb.center(${JSON.stringify(ref)})`));
  if (typeof x !== "number" || typeof y !== "number") throw new Error("ref 또는 x,y 좌표가 필요합니다.");
  await guard("버튼 누르기", await call(`__cb.infoAt(${x}, ${y})`));
  const d = await cdp(c);
  if (d) {
    await d.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    for (let i = 1; i <= clickCount; i++) {
      await d.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: i });
      await d.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: i });
    }
  } else {
    c.sendInputEvent({ type: "mouseMove", x, y });
    for (let i = 1; i <= clickCount; i++) {
      c.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: i });
      c.sendInputEvent({ type: "mouseUp", x, y, button, clickCount: i });
    }
  }
  await settle();
  return `클릭했습니다 (${x}, ${y}). ${where()}`;
}

async function typeText(text, ref) {
  if (ref) await call(`__cb.focus(${JSON.stringify(ref)})`);
  const f = await call("__cb.focused()");
  if (f && f.password) throw new Error("비밀번호 입력란에는 입력할 수 없습니다. 로그인은 사용자가 직접 해 주세요.");
  const d = await cdp(ready());
  if (d) await d.sendCommand("Input.insertText", { text }); // 창에 포커스가 없어도 들어감
  else ready().insertText(text);
  await sleep(200);
  return "입력했습니다.";
}

const KEY_ALIASES = { arrowup: "Up", arrowdown: "Down", arrowleft: "Left", arrowright: "Right", esc: "Escape", return: "Enter", del: "Delete", pgdn: "PageDown", pgup: "PageUp", space: "Space" };
const MODS = { ctrl: "control", control: "control", shift: "shift", alt: "alt", cmd: "meta", meta: "meta", command: "meta", option: "alt" };

async function pressKey(text, repeat = 1) {
  const c = ready();
  if (/enter|return/i.test(text) && onAdSite()) {
    const f = await call("__cb.focused()");
    if (f && f.inForm) {
      const ok = await confirmFn("Claude가 네이버 광고 입력 양식에서 Enter(제출)를 누르려고 합니다.", `페이지: ${c.getTitle()}\n${c.getURL()}\n\n허용하면 실제로 제출될 수 있습니다.`);
      if (!ok) throw new Error("사용자가 Enter(제출)를 허용하지 않았습니다.");
    }
  }
  const d = await cdp(c);
  for (let i = 0; i < Math.min(repeat, 100); i++) {
    for (const chord of text.trim().split(/\s+/)) {
      const parts = chord.split("+");
      const modifiers = parts.slice(0, -1).map((m) => MODS[m.toLowerCase()]).filter(Boolean);
      if (d) { // CDP: 포커스 없는 창에도 전달
        const k = cdpKey(parts[parts.length - 1]);
        const mods = modifiers.reduce((s, m) => s | (MOD_BITS[m] || 0), 0);
        const withText = k.text && !modifiers.some((m) => m !== "shift");
        const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers: mods };
        await d.sendCommand("Input.dispatchKeyEvent", { ...base, type: withText ? "keyDown" : "rawKeyDown", ...(withText ? { text: k.text, unmodifiedText: k.text } : {}) });
        await d.sendCommand("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
        continue;
      }
      let keyCode = parts[parts.length - 1];
      keyCode = KEY_ALIASES[keyCode.toLowerCase()] || keyCode;
      c.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      if (keyCode === "Enter") c.sendInputEvent({ type: "char", keyCode: "\r", modifiers });
      else if (keyCode.length === 1 && !modifiers.some((m) => m !== "shift")) c.sendInputEvent({ type: "char", keyCode, modifiers });
      c.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    }
  }
  await settle();
  return `${text} 키를 눌렀습니다. ${where()}`;
}

async function scroll(direction = "down", amount = 3, x, y) {
  const vp = await call("__cb.viewport()");
  x = x ?? Math.round(vp.w / 2); y = y ?? Math.round(vp.h / 2);
  const px = Math.min(Math.max(amount, 1), 10) * 120;
  const [dx, dy] = { up: [0, -px], down: [0, px], left: [-px, 0], right: [px, 0] }[direction] || [0, px];
  await call(`__cb.scroll(${x}, ${y}, ${dx}, ${dy})`);
  await sleep(600); // 무한 스크롤 목록이 더 불러올 시간
  return `${direction} 방향으로 스크롤했습니다.`;
}

const scrollTo = async (ref) => { await call(`__cb.scrollTo(${JSON.stringify(ref)})`); return `${ref}이(가) 보이도록 스크롤했습니다.`; };
async function formInput(ref, value) {
  const info = await call(`__cb.info(${JSON.stringify(ref)})`);
  if (info.password) throw new Error("비밀번호 입력란은 조작할 수 없습니다. 로그인은 사용자가 직접 해 주세요.");
  if (info.toggle && onAdSite()) await guard(value ? "켜기" : "끄기", { ...info, text: info.text || "스위치" });
  await call(`__cb.setValue(${JSON.stringify(ref)}, ${JSON.stringify(value)})`);
  await settle();
  return `${ref} 값을 설정했습니다.`;
}

// ---------- 탭 ----------
const needTabs = () => { if (!tabsApi) throw new Error("탭 기능을 쓸 수 없습니다."); return tabsApi; };
function fmtTabs(list) {
  const sid = ctx() && ctx().sid, mine = curId(), seen = tabsApi.current();
  const mark = (t) => t.tab_id === mine ? "▶" : sid && otherSessionOn(t.tab_id, sid) ? "🤖" : t.tab_id === seen ? "👁" : " ";
  const byWin = new Map();
  for (const t of list) { if (!byWin.has(t.window)) byWin.set(t.window, []); byWin.get(t.window).push(t); }
  const many = byWin.size > 1;
  return [...byWin.entries()].sort((a, b) => a[0] - b[0]).map(([w, ts]) =>
    (many ? `[창 ${w}]\n` : "") + ts.map((t) => `${mark(t)} ${t.tab_id}: ${t.title || "(제목 없음)"} — ${t.url}`).join("\n")
  ).join("\n");
}
const listTabs = async () => {
  const list = needTabs().list(), w = needTabs().windowCount();
  return `열린 탭 ${list.length}개${w > 1 ? ` (창 ${w}개)` : ""} — ▶ = 이 대화의 작업 탭, 👁 = 사용자가 지금 보고 있는 탭, 🤖 = 다른 Claude 대화가 쓰는 탭\n${fmtTabs(list)}`;
};
const checkUrl = (url) => {
  if (!url) return url;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url;
  if (!/^https?:/i.test(url)) throw new Error("http/https 주소만 열 수 있습니다.");
  return url;
};
const setGlobalIfNoSession = (id) => { if (!ctx()) { const t = needTabs().get(id); if (t) setActive(id, t.wc); } };
async function newWindow(url) {
  const id = await needTabs().openWindow(checkUrl(url));
  bindSession(id); setGlobalIfNoSession(id);
  await settle(30000);
  return `새 창을 열었습니다 (${id}). ${where()}`;
}
async function newTab(url) {
  const id = await needTabs().open(checkUrl(url), curId()); // 이 대화의 탭이 있는 창에 연다
  bindSession(id); setGlobalIfNoSession(id);
  await settle(30000);
  return `새 탭 ${id}을(를) 열었습니다. ${where()}`;
}
async function switchTab(id) {
  await needTabs().switchTo(id);
  const shared = ctx() && otherSessionOn(id, ctx().sid);
  bindSession(id); setGlobalIfNoSession(id);
  return `${id}(으)로 전환했습니다.${shared ? " (주의: 다른 Claude 대화도 이 탭을 쓰고 있습니다)" : ""} ${where()}`;
}
async function closeTab(id) {
  const target = id || curId();
  const winNo = needTabs().windowNoOf(target);
  await needTabs().close(target);
  await sleep(300);
  if (target === curId()) {
    const next = needTabs().activeOfWindowNo(winNo) || needTabs().current(); // 같은 창의 다음 탭으로
    if (next) { bindSession(next); setGlobalIfNoSession(next); }
  }
  return `${target}을(를) 닫았습니다.\n${await listTabs()}`;
}
// 사용자가 "지금 보고 있는 이 화면"을 가리킬 때: 이 대화의 작업 탭을 사용자가 보고 있는 탭으로 바꾼다
async function useCurrentTab() {
  const id = needTabs().current();
  if (!id) throw new Error("사용자가 보고 있는 탭을 찾지 못했습니다.");
  const shared = ctx() && otherSessionOn(id, ctx().sid);
  bindSession(id);
  return `사용자가 보고 있는 탭(${id})으로 작업 대상을 바꿨습니다.${shared ? " (주의: 다른 Claude 대화도 이 탭을 쓰고 있습니다)" : ""} ${where()}`;
}

// ---------- 북마크 ----------
const listBookmarks = async () => {
  const list = bmApi ? bmApi.list() : []; // [{ title, url, folder: "업무/광고" }]
  if (!list.length) return "북마크가 없습니다.";
  const byFolder = new Map();
  for (const b of list) { const f = b.folder || ""; if (!byFolder.has(f)) byFolder.set(f, []); byFolder.get(f).push(b); }
  const lines = [`북마크 ${list.length}개 (폴더 ${bmApi.folders().length}개)`];
  for (const [f, items] of byFolder) {
    lines.push(f ? `📁 ${f}` : "북마크 막대");
    for (const b of items) lines.push(`  - ${b.title} — ${b.url}`);
  }
  return lines.join("\n");
};
async function addBookmark(title, url, folder) {
  if (!bmApi) throw new Error("북마크 기능을 쓸 수 없습니다.");
  url = url || ready().getURL();
  title = title || (url === ready().getURL() ? ready().getTitle() : url);
  bmApi.add(title, url, folder || null);
  return `북마크했습니다: ${title} — ${url}${folder ? ` (📁 ${folder})` : " (북마크 막대)"}`;
}

// 화면 캡처: 좌표가 클릭 좌표(CSS 픽셀)와 같도록 크기를 맞춘다
async function screenshot(region) {
  const c = ready();
  const vp = await call("__cb.viewport()");
  if (region) {
    const [x0, y0, x1, y1] = region.map(Math.round);
    const img = await c.capturePage({ x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) });
    const w = Math.min(1200, (x1 - x0) * 2);
    return img.resize({ width: w }).toPNG().toString("base64");
  }
  const img = await c.capturePage();
  return img.resize({ width: vp.w, height: vp.h }).toPNG().toString("base64");
}

module.exports = {
  setActive, setTabs, setBookmarks, resolveSession, inSession, currentTabId, useCurrentTab, listBookmarks, addBookmark, waitReady, listTabs, newTab, newWindow, switchTab, closeTab, navigate, naverSearch, getPageText, readPage, find, click,
  typeText, pressKey, scroll, scrollTo, formInput, screenshot, where, setConfirm,
};
