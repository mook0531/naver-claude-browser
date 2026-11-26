#!/usr/bin/env node
// Claude 데스크톱 앱 ↔ 네이버 + Claude 브라우저 연결 다리.
// Claude 앱은 이 스크립트를 실행해 표준입출력(stdio)으로 MCP 메시지를 주고받고,
// 이 스크립트는 그 메시지를 브라우저 앱의 로컬 MCP 서버(127.0.0.1)로 전달한다.
// 브라우저 앱이 꺼져 있으면 자동으로 실행한다.
// stdout에는 MCP 메시지만 써야 하므로 안내 문구는 모두 stderr로 보낸다.
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

const APP_NAME = "naver-claude-browser";
const appDataDir =
  process.platform === "win32" ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
  : process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support")
  : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
const INFO_PATH = path.join(appDataDir, APP_NAME, "mcp.json");
const log = (...a) => console.error("[naver-browser]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 이 연결 다리 = Claude 대화 하나. 대화마다 브라우저에서 자기 작업 탭을 갖도록 식별자를 붙여 보낸다.
const SESSION_ID = require("crypto").randomUUID();

function readInfo() {
  try { return JSON.parse(fs.readFileSync(INFO_PATH, "utf8")); } catch { return null; }
}

async function alive(info) {
  if (!info) return false;
  try {
    // 토큰 없이 GET → 서버가 살아 있으면 401을 돌려준다
    const r = await fetch(`http://127.0.0.1:${info.port}/mcp`, { signal: AbortSignal.timeout(1500) });
    return r.status === 401 || r.status === 405;
  } catch { return false; }
}

let launching = null;
async function ensureApp() {
  let info = readInfo();
  if (await alive(info)) return info;
  if (!launching) {
    launching = (async () => {
      log("브라우저 앱을 실행합니다...");
      // 브라우저 앱 폴더: 이 파일 옆, 아니면 앱이 마지막으로 기록한 위치 (Claude 확장 프로그램으로 설치된 경우)
      const appDir = [__dirname, info && info.appDir].find((d) => d && fs.existsSync(path.join(d, "node_modules", "electron", "path.txt")));
      if (!appDir) throw new Error("네이버 + Claude 브라우저 앱을 찾지 못했습니다. 앱 폴더의 '실행(Windows).bat'으로 앱을 한 번 실행해 주세요.");
      const electron = require(path.join(appDir, "node_modules", "electron")); // electron 실행 파일 경로
      const child = spawn(electron, [appDir], { detached: true, stdio: "ignore", windowsHide: false });
      child.unref();
      for (let i = 0; i < 120; i++) { // 최대 60초 대기
        await sleep(500);
        info = readInfo();
        if (await alive(info)) return info;
      }
      throw new Error("브라우저 앱이 60초 안에 시작되지 않았습니다.");
    })().finally(() => { launching = null; });
  }
  return launching;
}

async function forward(message) {
  let info = await ensureApp();
  const send = () => fetch(`http://127.0.0.1:${info.port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${info.token}`,
      "X-Claude-Session": SESSION_ID,
    },
    body: JSON.stringify(message),
  });
  let res;
  try { res = await send(); }
  catch { info = await ensureApp(); res = await send(); } // 앱이 꺼졌으면 다시 띄워서 한 번 더

  if (res.status === 202 || res.status === 204) return []; // 알림(notification)은 응답 없음
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  if ((res.headers.get("content-type") || "").includes("text/event-stream")) {
    return text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)));
  }
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

const out = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

// 메시지를 받은 순서대로 하나씩 처리
let chain = Promise.resolve();
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { log("잘못된 메시지:", line.slice(0, 100)); return; }
  chain = chain.then(async () => {
    try {
      for (const reply of await forward(msg)) out(reply);
    } catch (e) {
      log(e.message);
      if (msg.id !== undefined) out({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: "네이버 + Claude 브라우저에 연결하지 못했습니다: " + e.message } });
    }
  });
});
