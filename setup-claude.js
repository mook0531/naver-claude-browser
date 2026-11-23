// Claude 데스크톱 앱 설정(claude_desktop_config.json)에 이 브라우저를 MCP 서버로 등록한다.
// 기존 설정은 그대로 두고 "naver-browser" 항목만 추가/갱신하며, 바꾸기 전에 백업 파일을 만든다.
const fs = require("fs");
const os = require("os");
const path = require("path");

const SERVER_NAME = "naver-browser";
const bridge = path.join(__dirname, "mcp-bridge.js");
const entry = { command: process.execPath, args: [bridge] };

function configDirs() {
  const dirs = [];
  if (process.platform === "win32") {
    dirs.push(path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude"));
    // Microsoft Store에서 설치한 Claude는 설정 위치가 다르다
    const pkgs = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Packages");
    try {
      for (const name of fs.readdirSync(pkgs)) {
        const d = path.join(pkgs, name, "LocalCache", "Roaming", "Claude");
        if (/claude/i.test(name) && fs.existsSync(d)) dirs.push(d);
      }
    } catch {}
  } else if (process.platform === "darwin") {
    dirs.push(path.join(os.homedir(), "Library", "Application Support", "Claude"));
  } else {
    dirs.push(path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Claude"));
  }
  return dirs;
}

let ok = 0;
for (const dir of configDirs()) {
  const file = path.join(dir, "claude_desktop_config.json");
  let config = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8");
    try {
      config = raw.trim() ? JSON.parse(raw) : {};
    } catch (e) {
      console.error(`\n[오류] ${file} 파일 형식이 잘못되어 수정하지 않았습니다: ${e.message}`);
      continue;
    }
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(file, backup);
    console.log(`기존 설정 백업: ${backup}`);
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }
  config.mcpServers = config.mcpServers || {};
  config.mcpServers[SERVER_NAME] = entry;
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", "utf8");
  console.log(`등록 완료: ${file}`);
  ok++;
}

if (!ok) {
  console.error("\nClaude 데스크톱 앱 설정에 등록하지 못했습니다.");
  process.exit(1);
}

console.log(`
==============================================================
 Claude 데스크톱 앱에 '네이버 + Claude 브라우저'를 연결했습니다.

 1. Claude 앱을 완전히 종료했다가 다시 실행하세요.
    (창만 닫으면 안 됩니다. 작업 표시줄 오른쪽 아래 트레이의
     Claude 아이콘을 우클릭해 '종료'(Quit)를 누르세요.)
 2. Claude 앱에서 "네이버에서 오늘 날씨 검색해 줘" 라고 해 보세요.
    처음 한 번은 도구 사용 허락 창이 뜹니다. '항상 허용'을 누르세요.
 3. 브라우저가 꺼져 있으면 Claude가 자동으로 실행합니다.

 (Claude Code를 쓴다면 터미널에서 아래 명령으로도 연결됩니다)
   claude mcp add ${SERVER_NAME} -- "${process.execPath}" "${bridge}"
==============================================================
`);
