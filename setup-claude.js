// Claude 앱에 이 브라우저를 플러그인(naver-browser)으로 설치한다.
//
// 새 Claude 앱(Code / Cowork)과 Claude Code CLI는 같은 플러그인 설정을 쓴다.
// 이 폴더를 '로컬 마켓플레이스'로 등록하고 그 안의 naver-browser 플러그인을 사용자 범위로 설치한다
// (설정 → 플러그인 목록에 '로컬 개발'로 보이는 방식). 설치는 공식 Claude Code CLI로 한다.
// 예전 방식으로 넣었던 항목(claude_desktop_config.json, ~/.claude.json, ~/.claude/skills)은 중복되지 않게 지운다.
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { execSync, spawnSync } = require("child_process");

const SERVER_NAME = "naver-browser";
const MARKETPLACE = "naver-claude-browser";
const CLI_VERSION = "2.1.330";
const home = os.homedir();
const pluginDir = path.join(__dirname, "claude-plugin");

function claudeRunning() {
  try {
    if (process.platform === "win32") return /claude\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq claude.exe" /NH', { encoding: "utf8" }));
    if (process.platform === "darwin") return execSync("pgrep -x Claude || true", { encoding: "utf8" }).trim() !== "";
  } catch {}
  return false;
}
const ask = (q) => new Promise((r) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, () => { rl.close(); r(); }); });

// Claude Code CLI 실행: 설치되어 있으면 그것을, 없으면 npx로 공식 패키지를 받아 실행
let cli = null;
function claude(args) {
  if (!cli) {
    const probe = spawnSync("claude", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
    cli = probe.status === 0 ? ["claude"] : ["npx", "-y", `@anthropic-ai/claude-code@${CLI_VERSION}`];
    if (cli[0] === "npx") console.log("  (Claude Code 도구를 내려받는 중입니다. 처음 한 번은 1~2분 걸릴 수 있습니다...)");
  }
  const quoted = [...cli, ...args].map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
  const r = spawnSync(quoted, { encoding: "utf8", shell: true });
  return { ok: r.status === 0, out: `${r.stdout || ""}${r.stderr || ""}`.trim() };
}

function editJson(file, mutate) {
  if (!fs.existsSync(file)) return false;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return false; }
  if (!mutate(data)) return false;
  fs.copyFileSync(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  return true;
}

function desktopConfigs() {
  const dirs = [];
  if (process.platform === "win32") {
    dirs.push(path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude"));
    const pkgs = path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Packages");
    try { for (const n of fs.readdirSync(pkgs)) { const d = path.join(pkgs, n, "LocalCache", "Roaming", "Claude"); if (/claude/i.test(n) && fs.existsSync(d)) dirs.push(d); } } catch {}
  } else if (process.platform === "darwin") dirs.push(path.join(home, "Library", "Application Support", "Claude"));
  else dirs.push(path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "Claude"));
  return dirs.map((d) => path.join(d, "claude_desktop_config.json"));
}

(async () => {
  while (claudeRunning()) {
    console.log("\nClaude 앱이 실행 중입니다. 먼저 Claude 앱을 완전히 종료해 주세요.");
    console.log("  작업 표시줄 오른쪽 아래 트레이의 Claude 아이콘 우클릭 → 종료");
    console.log("  (또는 Ctrl+Shift+Esc → 작업 관리자 → Claude → 작업 끝내기)");
    await ask("종료했으면 Enter를 누르세요...");
  }

  // 1) 플러그인 준비: 최신 연결 다리 + node 전체 경로 (Claude 앱이 PATH에서 node를 못 찾는 경우 대비)
  fs.copyFileSync(path.join(__dirname, "mcp-bridge.js"), path.join(pluginDir, "server", "index.js"));
  const mcpFile = path.join(pluginDir, ".mcp.json");
  const mcp = JSON.parse(fs.readFileSync(mcpFile, "utf8"));
  mcp.mcpServers[SERVER_NAME].command = process.execPath;
  fs.writeFileSync(mcpFile, JSON.stringify(mcp, null, 2) + "\n");

  // 2) 예전 방식의 등록 정리 (같은 도구가 두 번 보이지 않게)
  console.log("\n[이전 등록 정리]");
  fs.rmSync(path.join(home, ".claude", "skills", SERVER_NAME), { recursive: true, force: true });
  const drop = (d) => { if (d.mcpServers && d.mcpServers[SERVER_NAME]) { delete d.mcpServers[SERVER_NAME]; return true; } return false; };
  for (const f of [path.join(home, ".claude.json"), ...desktopConfigs()]) if (editJson(f, drop)) console.log(`  정리: ${f}`);

  // 3) 로컬 마켓플레이스 등록 + 설치
  console.log("\n[플러그인 설치]");
  let r = claude(["plugin", "marketplace", "add", __dirname]);
  if (!r.ok && !/already/i.test(r.out)) {
    r = claude(["plugin", "marketplace", "update", MARKETPLACE]);
  }
  console.log("  " + (r.out.split("\n").pop() || "마켓플레이스 등록"));
  r = claude(["plugin", "install", `${SERVER_NAME}@${MARKETPLACE}`, "--scope", "user"]);
  console.log("  " + (r.out.split("\n").pop() || ""));
  const list = claude(["plugin", "list"]);
  const installed = list.out.includes(`${SERVER_NAME}@${MARKETPLACE}`);
  if (!installed) {
    console.error("\n[오류] 플러그인을 설치하지 못했습니다. 이 창을 캡처해서 보내 주세요.\n" + list.out.slice(-800));
    process.exit(1);
  }

  console.log(`
==============================================================
 설치했습니다: ${SERVER_NAME}@${MARKETPLACE}

 1. Claude 앱을 실행하고 설정 → 플러그인 목록에
    'naver-browser (로컬 개발)'이 보이는지 확인하세요.
 2. Claude 앱의 Code(또는 Cowork) 화면에서 새 세션을 열고
    "네이버에서 오늘 날씨 검색해 줘" 라고 해 보세요.
    처음 한 번은 도구 사용 허락 창이 뜹니다.

 * 이 폴더(${__dirname})를 옮기거나 지우면 플러그인이 동작하지 않습니다.
   옮겼다면 이 파일을 다시 실행하세요.
==============================================================
`);
})();
