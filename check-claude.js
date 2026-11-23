// 연결 점검: Claude 앱 설정 등록 여부, Claude 앱이 남긴 연결 기록, 브라우저 연결 실제 동작을 확인한다.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const SERVER_NAME = "naver-browser";
const line = () => console.log("-".repeat(60));

function claudeDirs() {
  const dirs = [];
  if (process.platform === "win32") {
    dirs.push(path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude"));
    const pkgs = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Packages");
    try {
      for (const n of fs.readdirSync(pkgs)) {
        const d = path.join(pkgs, n, "LocalCache", "Roaming", "Claude");
        if (/claude/i.test(n) && fs.existsSync(d)) dirs.push(d);
      }
    } catch {}
  } else if (process.platform === "darwin") {
    dirs.push(path.join(os.homedir(), "Library", "Application Support", "Claude"));
    dirs.push(path.join(os.homedir(), "Library", "Logs", "Claude"));
  } else {
    dirs.push(path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Claude"));
  }
  return dirs;
}

const tail = (file, n) => fs.readFileSync(file, "utf8").trim().split(/\r?\n/).slice(-n).map((l) => l.slice(0, 160));

// 1) 설정 등록 여부
console.log("\n[1] Claude 앱 설정 등록");
line();
for (const dir of claudeDirs()) {
  const cfg = path.join(dir, "claude_desktop_config.json");
  if (!fs.existsSync(cfg)) continue;
  try {
    const entry = JSON.parse(fs.readFileSync(cfg, "utf8")).mcpServers?.[SERVER_NAME];
    const bridgeOk = entry && entry.args && fs.existsSync(entry.args[0]);
    console.log(`${entry ? (bridgeOk ? "OK " : "경로 없음") : "미등록"} : ${cfg}`);
  } catch (e) {
    console.log(`설정 파일 오류: ${cfg} (${e.message})`);
  }
}

// 2) Claude 앱이 이 도구를 실행한 기록
console.log("\n[2] Claude 앱의 연결 기록 (최근)");
line();
let foundLog = false;
for (const dir of claudeDirs()) {
  for (const logDir of [path.join(dir, "logs"), dir]) {
    const f = path.join(logDir, `mcp-server-${SERVER_NAME}.log`);
    if (fs.existsSync(f)) {
      foundLog = true;
      console.log(`기록 파일: ${f}\n수정 시각: ${fs.statSync(f).mtime.toLocaleString()}`);
      for (const l of tail(f, 12)) console.log("  " + l);
    }
  }
}
if (!foundLog) {
  console.log("기록 없음 → Claude 앱이 아직 이 도구를 한 번도 실행하지 않았습니다.");
  console.log("           Claude 앱을 '완전히 종료'한 뒤 다시 켰는지 확인하세요.");
}

// 3) 브라우저 연결 실제 동작 (Claude 앱과 같은 방식으로 연결해 본다)
console.log("\n[3] 브라우저 연결 테스트 (브라우저가 꺼져 있으면 켜집니다)");
line();
const child = spawn(process.execPath, [path.join(__dirname, "mcp-bridge.js")], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
const timer = setTimeout(() => { console.log("실패: 90초 안에 응답이 없습니다."); child.kill(); process.exit(1); }, 90000);
child.stdout.on("data", (d) => {
  buf += d;
  for (const l of buf.split("\n").slice(0, -1)) {
    const m = JSON.parse(l);
    if (m.id === 1) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    }
    if (m.id === 2) {
      clearTimeout(timer);
      if (m.error) console.log("실패: " + m.error.message);
      else console.log(`OK: 브라우저 연결 정상, 도구 ${m.result.tools.length}개 (${m.result.tools.map((t) => t.name).join(", ")})`);
      child.kill();
      process.exit(0);
    }
  }
  buf = buf.slice(buf.lastIndexOf("\n") + 1);
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check", version: "1" } } }) + "\n");
