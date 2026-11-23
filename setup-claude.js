// Claude 앱에 이 브라우저를 로컬 MCP 서버(naver-browser)로 등록한다.
// - 새 Claude 앱은 Claude Code와 같은 사용자 설정(~/.claude.json)의 mcpServers를 "로컬 MCP 서버"로 불러온다.
// - 예전 Claude 데스크톱 앱은 claude_desktop_config.json을 읽는다.
// 두 곳 모두에 등록하고, 바꾸기 전에 백업을 만든다. 다른 항목은 건드리지 않는다.
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { execSync } = require("child_process");

const SERVER_NAME = "naver-browser";
const bridge = path.join(__dirname, "mcp-bridge.js");
const home = os.homedir();

function desktopConfigs() {
  const dirs = [];
  if (process.platform === "win32") {
    dirs.push(path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude"));
    const pkgs = path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Packages");
    try {
      for (const n of fs.readdirSync(pkgs)) {
        const d = path.join(pkgs, n, "LocalCache", "Roaming", "Claude");
        if (/claude/i.test(n) && fs.existsSync(d)) dirs.push(d);
      }
    } catch {}
  } else if (process.platform === "darwin") {
    dirs.push(path.join(home, "Library", "Application Support", "Claude"));
  } else {
    dirs.push(path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "Claude"));
  }
  return dirs.map((d) => path.join(d, "claude_desktop_config.json"));
}

// Claude 앱이 켜져 있으면 종료 시 설정을 덮어쓸 수 있으므로 먼저 종료하게 한다
function claudeRunning() {
  try {
    if (process.platform === "win32") return /claude\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq claude.exe" /NH', { encoding: "utf8" }));
    if (process.platform === "darwin") return execSync("pgrep -x Claude || true", { encoding: "utf8" }).trim() !== "";
  } catch {}
  return false;
}
const ask = (q) => new Promise((r) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, () => { rl.close(); r(); }); });

function update(file, mutate, { create }) {
  let data = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8");
    try { data = raw.trim() ? JSON.parse(raw) : {}; }
    catch (e) { console.error(`[오류] ${file} 형식이 잘못되어 수정하지 않았습니다: ${e.message}`); return false; }
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(file, backup);
  } else if (!create) {
    return false;
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  mutate(data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  return true;
}

(async () => {
  while (claudeRunning()) {
    console.log("\nClaude 앱이 실행 중입니다. 설정을 바꾸려면 Claude 앱을 완전히 종료해야 합니다.");
    console.log("  작업 표시줄 오른쪽 아래 트레이의 Claude 아이콘 우클릭 → 종료");
    console.log("  (또는 Ctrl+Shift+Esc → 작업 관리자 → Claude → 작업 끝내기)");
    await ask("종료했으면 Enter를 누르세요...");
  }

  // 기존 로컬 MCP 서버가 어디에 등록되어 있는지 보여준다 (예: gemini)
  const userConfig = path.join(home, ".claude.json");
  console.log("\n[기존 로컬 MCP 서버]");
  for (const f of [userConfig, ...desktopConfigs()]) {
    try {
      const names = Object.keys(JSON.parse(fs.readFileSync(f, "utf8")).mcpServers || {}).filter((n) => n !== SERVER_NAME);
      console.log(`  ${f}: ${names.length ? names.join(", ") : "(없음)"}`);
    } catch {}
  }

  console.log("\n[등록]");
  let ok = 0;
  // 1) 새 Claude 앱 / Claude Code: 사용자 설정의 mcpServers
  if (update(userConfig, (d) => {
    d.mcpServers = d.mcpServers || {};
    d.mcpServers[SERVER_NAME] = { type: "stdio", command: process.execPath, args: [bridge], env: {} };
  }, { create: true })) { console.log(`  등록 완료: ${userConfig}`); ok++; }
  // 2) 예전 Claude 데스크톱 앱
  for (const f of desktopConfigs()) {
    if (update(f, (d) => {
      d.mcpServers = d.mcpServers || {};
      d.mcpServers[SERVER_NAME] = { command: process.execPath, args: [bridge] };
    }, { create: false })) { console.log(`  등록 완료: ${f}`); ok++; }
  }
  if (!ok) { console.error("\n등록하지 못했습니다."); process.exit(1); }

  console.log(`
==============================================================
 등록했습니다. 이제 Claude 앱을 다시 실행하세요.

 1. Claude 앱 설정 → 플러그인 목록에 'naver-browser (로컬 MCP 서버)'가
    보이면 성공입니다.
 2. 새 대화에서 "naver-browser로 네이버에서 오늘 날씨 검색해 줘" 라고
    해 보세요. 처음 한 번은 도구 사용 허락 창이 뜹니다.
==============================================================
`);
})();
