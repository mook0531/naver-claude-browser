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
for (const cfg of [path.join(os.homedir(), ".claude.json"), ...claudeDirs().map((d) => path.join(d, "claude_desktop_config.json"))]) {
  if (!fs.existsSync(cfg)) continue;
  try {
    const entry = JSON.parse(fs.readFileSync(cfg, "utf8")).mcpServers?.[SERVER_NAME];
    const bridgeOk = entry && entry.args && fs.existsSync(entry.args[0]);
    const others = Object.keys(JSON.parse(fs.readFileSync(cfg, "utf8")).mcpServers || {}).filter((n) => n !== SERVER_NAME);
    console.log(`${entry ? (bridgeOk ? "OK " : "경로 없음") : "미등록"} : ${cfg}${others.length ? "  (다른 서버: " + others.join(", ") + ")" : ""}`);
  } catch (e) {
    console.log(`설정 파일 오류: ${cfg} (${e.message})`);
  }
}

{
  const pd = path.join(os.homedir(), ".claude", "skills", SERVER_NAME);
  const ok = fs.existsSync(path.join(pd, ".claude-plugin", "plugin.json")) && fs.existsSync(path.join(pd, ".mcp.json"));
  console.log(`${ok ? "OK " : "없음"} : 플러그인 ${pd}`);
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

// 2-1) Claude 데스크톱 앱 자체의 기록: 앱이 설치·실행된 적이 있는지, MCP 설정을 읽었는지
console.log("\n[2-1] Claude 데스크톱 앱 기록");
line();
let anyAppLog = false;
for (const dir of claudeDirs()) {
  const logDir = path.join(dir, "logs");
  if (!fs.existsSync(logDir)) continue;
  const files = fs.readdirSync(logDir).filter((f) => f.endsWith(".log"))
    .map((f) => ({ f, t: fs.statSync(path.join(logDir, f)).mtime }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) continue;
  anyAppLog = true;
  console.log(`기록 폴더: ${logDir}`);
  console.log("  최근 파일: " + files.slice(0, 6).map((x) => `${x.f}(${x.t.toLocaleString()})`).join(", "));
  for (const name of ["mcp.log", "main.log"]) {
    const f = path.join(logDir, name);
    if (!fs.existsSync(f)) continue;
    const hits = fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => /mcp|naver-browser|config|polic/i.test(l)).slice(-8);
    if (hits.length) { console.log(`  ${name} (MCP 관련 최근 줄):`); for (const l of hits) console.log("    " + l.slice(0, 160)); }
  }
}
if (!anyAppLog) {
  console.log("Claude 데스크톱 앱 기록이 전혀 없습니다.");
  console.log("→ 이 PC에서 Claude '데스크톱 앱'이 실행된 적이 없는 것 같습니다.");
  console.log("  웹사이트(claude.ai)에서는 이 연결을 쓸 수 없습니다. https://claude.ai/download 에서 데스크톱 앱을 설치하세요.");
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
