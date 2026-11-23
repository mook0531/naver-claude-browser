// 브라우저 조작 모듈: 앱 안의 webview(네이버 화면)를 코드로 움직인다.
// MCP 서버(mcp-server.js)가 이 함수들을 Claude의 도구로 노출한다.
const MAX_TEXT = 40000; // 한 번에 Claude에게 돌려줄 페이지 글자 수 상한

let wc = null;        // 지금 보고 있는 탭의 webContents
let activeId = null;  // 그 탭의 id (예: tab-2)
let tabsApi = null;   // main.js가 넣어 주는 탭 목록/열기/전환/닫기
const setActive = (id, contents) => { activeId = id; wc = contents; };
const setTabs = (api) => { tabsApi = api; };
const ready = () => {
  if (!wc || wc.isDestroyed()) throw new Error("브라우저 창이 열려 있지 않습니다. 네이버 + Claude 브라우저 앱을 실행하세요.");
  return wc;
};

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
  return `현재 페이지 [${activeId || "tab"}${n > 1 ? `, 탭 ${n}개 열림` : ""}]: ${ready().getTitle()} — ${ready().getURL()}`;
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
    const onFail = (_e, code, desc, failedUrl, isMainFrame) => { if (isMainFrame && code !== -3) failed = `${desc} (${failedUrl})`; };
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
async function click({ ref, x, y, button = "left", clickCount = 1 }) {
  const c = ready();
  if (ref) ({ x, y } = await call(`__cb.center(${JSON.stringify(ref)})`));
  if (typeof x !== "number" || typeof y !== "number") throw new Error("ref 또는 x,y 좌표가 필요합니다.");
  await guard("버튼 누르기", await call(`__cb.infoAt(${x}, ${y})`));
  c.sendInputEvent({ type: "mouseMove", x, y });
  for (let i = 1; i <= clickCount; i++) {
    c.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: i });
    c.sendInputEvent({ type: "mouseUp", x, y, button, clickCount: i });
  }
  await settle();
  return `클릭했습니다 (${x}, ${y}). ${where()}`;
}

async function typeText(text, ref) {
  if (ref) await call(`__cb.focus(${JSON.stringify(ref)})`);
  const f = await call("__cb.focused()");
  if (f && f.password) throw new Error("비밀번호 입력란에는 입력할 수 없습니다. 로그인은 사용자가 직접 해 주세요.");
  ready().insertText(text);
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
  for (let i = 0; i < Math.min(repeat, 100); i++) {
    for (const chord of text.trim().split(/\s+/)) {
      const parts = chord.split("+");
      const modifiers = parts.slice(0, -1).map((m) => MODS[m.toLowerCase()]).filter(Boolean);
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
const fmtTabs = (list) => list.map((t) => `${t.active ? "▶" : " "} ${t.tab_id}: ${t.title || "(제목 없음)"} — ${t.url}`).join("\n");
const listTabs = async () => `열린 탭 ${needTabs().list().length}개 (▶ = 지금 보고 있는 탭)\n${fmtTabs(needTabs().list())}`;
async function newTab(url) {
  if (url) { if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url; if (!/^https?:/i.test(url)) throw new Error("http/https 주소만 열 수 있습니다."); }
  const id = await needTabs().open(url);
  for (let i = 0; i < 50 && activeId !== id; i++) await sleep(100); // 새 탭으로 전환될 때까지
  await settle(30000);
  return `새 탭 ${id}을(를) 열었습니다. ${where()}`;
}
async function switchTab(id) {
  await needTabs().switchTo(id);
  for (let i = 0; i < 50 && activeId !== id; i++) await sleep(100);
  return `${id}(으)로 전환했습니다. ${where()}`;
}
async function closeTab(id) {
  await needTabs().close(id || activeId);
  await sleep(300);
  return `${id || "현재 탭"}을(를) 닫았습니다.\n${await listTabs()}`;
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
  setActive, setTabs, listTabs, newTab, switchTab, closeTab, navigate, naverSearch, getPageText, readPage, find, click,
  typeText, pressKey, scroll, scrollTo, formInput, screenshot, where, setConfirm,
};
