// 네이버 공식 검색 API (쇼핑): https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md
// 키(Client ID / Client Secret)는 사용자 데이터 폴더의 naver-api.json에 저장하고, Secret은 OS 키체인으로 암호화한다.
const fs = require("fs");
const path = require("path");
const { app, net, safeStorage } = require("electron");

const API_BASE = process.env.NAVER_API_BASE || "https://openapi.naver.com"; // (테스트용으로만 바꿈)
const keyPath = () => path.join(app.getPath("userData"), "naver-api.json");

function loadKeys() {
  try {
    const k = JSON.parse(fs.readFileSync(keyPath(), "utf8"));
    const secret = k.encrypted && safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(k.secret, "base64")) : k.secret;
    return k.id && secret ? { id: k.id, secret } : null;
  } catch {
    return null;
  }
}

function saveKeys(id, secret) {
  id = String(id || "").trim();
  secret = String(secret || "").trim();
  if (!id || !secret) throw new Error("Client ID와 Client Secret을 모두 입력하세요.");
  const encrypted = safeStorage.isEncryptionAvailable();
  fs.mkdirSync(path.dirname(keyPath()), { recursive: true });
  fs.writeFileSync(keyPath(), JSON.stringify({
    id, encrypted, secret: encrypted ? safeStorage.encryptString(secret).toString("base64") : secret,
  }), { mode: 0o600 });
}

// 직원 PC 배포용: 앱 폴더에 naver-api-key.json({ id, secret })이 있으면 가져와 암호화 저장하고 파일은 지운다
const SHARED_FILE = "naver-api-key.json";
function importSharedKeyFile(appDir) {
  const f = path.join(appDir, SHARED_FILE);
  if (!fs.existsSync(f)) return false;
  try {
    const k = JSON.parse(fs.readFileSync(f, "utf8"));
    saveKeys(k.id, k.secret);
    fs.rmSync(f, { force: true });
    return true;
  } catch (e) {
    console.error("네이버 API 키 파일을 읽지 못했습니다:", e.message);
    return false;
  }
}
function exportSharedKeyFile(file) {
  const k = loadKeys();
  if (!k) throw new Error("먼저 키를 저장하세요.");
  fs.writeFileSync(file, JSON.stringify({ id: k.id, secret: k.secret }, null, 2));
}

const keyStatus = () => { const k = loadKeys(); return { configured: !!k, id: k ? k.id : "" }; };

const strip = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const won = (n) => (n ? Number(n).toLocaleString("ko-KR") + "원" : "-");

// 쇼핑 검색. sort: sim(정확도) | date(최신) | asc(가격 낮은순) | dsc(가격 높은순)
async function shoppingSearch({ query, sort = "sim", display = 20, start = 1, excludeUsed = false } = {}) {
  const keys = loadKeys();
  if (!keys) {
    throw new Error("네이버 쇼핑 API 키가 설정되지 않았습니다. 브라우저에서 Alt → 파일 → '네이버 쇼핑 API 설정'에 Client ID와 Secret을 입력해 달라고 사용자에게 안내하세요.");
  }
  if (!query || !String(query).trim()) throw new Error("검색어가 필요합니다.");
  const params = new URLSearchParams({
    query: String(query).trim(),
    display: String(Math.min(Math.max(Number(display) || 20, 1), 100)),
    start: String(Math.min(Math.max(Number(start) || 1, 1), 1000)),
    sort: ["sim", "date", "asc", "dsc"].includes(sort) ? sort : "sim",
  });
  if (excludeUsed) params.set("exclude", "used:rental:cbshop"); // 중고·렌탈·해외직구 제외
  // Chromium 네트워크(net.fetch)를 써서 회사 프록시 설정도 그대로 따른다
  const res = await net.fetch(`${API_BASE}/v1/search/shop.json?${params}`, {
    headers: { "X-Naver-Client-Id": keys.id, "X-Naver-Client-Secret": keys.secret },
  });
  const body = await res.text();
  if (!res.ok) {
    let msg = body;
    try { const j = JSON.parse(body); msg = `${j.errorCode || ""} ${j.errorMessage || ""}`.trim(); } catch {}
    if (res.status === 401) throw new Error(`네이버 API 인증 실패(401): Client ID/Secret을 확인하세요. ${msg}`);
    if (res.status === 403) throw new Error(`네이버 API 권한 없음(403): 애플리케이션 설정에서 '검색' API를 추가했는지 확인하세요. ${msg}`);
    if (res.status === 429) throw new Error(`네이버 API 호출 한도 초과(429): 하루 호출 한도를 넘었습니다. ${msg}`);
    throw new Error(`네이버 API 오류 ${res.status}: ${msg}`);
  }
  const data = JSON.parse(body);
  return {
    total: data.total || 0,
    start: data.start || 1,
    items: (data.items || []).map((it) => ({
      title: strip(it.title),
      lprice: Number(it.lprice) || 0,
      hprice: Number(it.hprice) || 0,
      mall: strip(it.mallName),
      brand: strip(it.brand),
      maker: strip(it.maker),
      category: [it.category1, it.category2, it.category3, it.category4].filter(Boolean).join(" > "),
      link: it.link || "",
      productId: it.productId || "",
    })),
  };
}

// Claude가 읽기 좋은 표로
function formatShopping(query, r, sort) {
  const sortName = { sim: "정확도순", date: "최신순", asc: "가격 낮은순", dsc: "가격 높은순" }[sort] || "정확도순";
  if (!r.items.length) return `"${query}" 쇼핑 검색 결과가 없습니다.`;
  const rows = r.items.map((it, i) =>
    `| ${r.start + i} | ${it.title.replace(/\|/g, "/")} | ${won(it.lprice)}${it.hprice ? " ~ " + won(it.hprice) : ""} | ${it.mall || "-"} | ${it.brand || it.maker || "-"} | ${it.link} |`);
  return [
    `네이버 쇼핑 검색 "${query}" (${sortName}, 전체 ${r.total.toLocaleString("ko-KR")}건 중 ${r.start}~${r.start + r.items.length - 1}번째)`,
    "출처: 네이버 공식 검색 API. 가격은 조회 시점 기준이며 실제 판매가·배송비·쿠폰 적용가와 다를 수 있습니다.",
    "",
    "| # | 상품명 | 최저가 | 판매처 | 브랜드 | 링크 |",
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

module.exports = { loadKeys, saveKeys, keyStatus, shoppingSearch, formatShopping, importSharedKeyFile, exportSharedKeyFile, SHARED_FILE };
