// 오류 기록: 사용자 데이터 폴더의 logs/app.log 에 남긴다 (1MB가 넘으면 app.old.log 로 넘김)
// 비밀 값(토큰, API 키, 비밀번호)으로 보이는 것은 가려서 쓴다.
const fs = require("fs");
const path = require("path");
const os = require("os");

let dir = null;
function setLogDir(d) { dir = d; }
const file = () => (dir ? path.join(dir, "app.log") : null);

const mask = (s) => String(s)
  .replace(/sk-ant-[\w-]{6,}/g, "sk-ant-***")
  .replace(/(Bearer\s+)[\w.-]{8,}/gi, "$1***")
  .replace(/("?(?:token|secret|password|apiKey|api_key|Client-Secret)"?\s*[:=]\s*"?)[^"\s,}]{4,}/gi, "$1***");

function log(level, ...args) {
  const f = file();
  if (!f) return;
  const text = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "object" ? safeJson(a) : String(a))).join(" ");
  const line = `${new Date().toISOString()} [${level}] ${mask(text)}\n`;
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    try { if (fs.statSync(f).size > 1024 * 1024) fs.renameSync(f, path.join(path.dirname(f), "app.old.log")); } catch {}
    fs.appendFileSync(f, line);
  } catch {}
}
const safeJson = (o) => { try { return JSON.stringify(o); } catch { return String(o); } };

// 오류 보고서: 최근 기록 + 환경 정보를 한 파일로
function buildReport({ appVersion, extra = {} } = {}) {
  const read = (p, n) => { try { return fs.readFileSync(p, "utf8").split(/\r?\n/).slice(-n).join("\n"); } catch { return "(없음)"; } };
  const lines = [
    "네이버 Claude 브라우저 오류 보고서",
    `만든 시각: ${new Date().toLocaleString("ko-KR")}`,
    `앱 버전: ${appVersion || "?"} | OS: ${os.type()} ${os.release()} (${os.arch()}) | Node ${process.versions.node} | Electron ${process.versions.electron || "-"}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${mask(typeof v === "string" ? v : safeJson(v))}`),
    "",
    "===== 최근 앱 기록 (app.log) =====",
    read(file() || "", 400),
    "",
    "===== 연결 다리 기록 (bridge.log) =====",
    read(dir ? path.join(dir, "bridge.log") : "", 200),
  ];
  return mask(lines.join("\n"));
}

module.exports = { setLogDir, log, buildReport, mask };
