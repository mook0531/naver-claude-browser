// Electron 본체 설치.
// 1) Electron 기본 설치 스크립트를 먼저 시도하고,
// 2) 실패하면(예: Windows 보안 정책이 압축 해제용 네이티브 모듈을 차단 - electron/electron#52481)
//    같은 파일을 받아 OS 기본 도구(Windows: tar, macOS/Linux: unzip)로 압축을 푼다.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const electronDir = path.dirname(require.resolve("electron/package.json"));
const { version } = require("electron/package.json");
const platformPath = { win32: "electron.exe", darwin: "Electron.app/Contents/MacOS/Electron" }[process.platform] || "electron";
const distDir = path.join(electronDir, "dist");

function installed() {
  try {
    return fs.readFileSync(path.join(electronDir, "path.txt"), "utf8") === platformPath &&
      fs.existsSync(path.join(distDir, platformPath));
  } catch {
    return false;
  }
}

async function fallback() {
  console.log("Electron 기본 설치가 실패해 다른 방법으로 압축을 풉니다...");
  const { downloadArtifact } = require("@electron/get");
  const zipPath = await downloadArtifact({
    version,
    artifactName: "electron",
    platform: process.platform,
    arch: process.arch,
    checksums: require("electron/checksums.json"),
  });
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  const [cmd, args] = process.platform === "win32"
    ? [path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-xf", zipPath, "-C", distDir]]
    : process.platform === "darwin"
      ? ["ditto", ["-x", "-k", zipPath, distDir]]
      : ["unzip", ["-oq", zipPath, "-d", distDir]];
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`압축 해제 실패: ${cmd} (${r.error ? r.error.message : "exit " + r.status})`);
  const dts = path.join(distDir, "electron.d.ts");
  if (fs.existsSync(dts)) fs.renameSync(dts, path.join(electronDir, "electron.d.ts"));
  fs.writeFileSync(path.join(electronDir, "path.txt"), platformPath);
}

(async () => {
  if (installed()) return;
  if (!process.env.SKIP_ELECTRON_DEFAULT_INSTALL) {
    spawnSync(process.execPath, [path.join(electronDir, "install.js")], { stdio: "inherit" });
    if (installed()) return;
  }
  await fallback();
  if (!installed()) throw new Error("Electron 설치 후에도 실행 파일을 찾지 못했습니다.");
  console.log("Electron 설치 완료.");
})().catch((e) => {
  console.error("\n[ERROR] Electron 설치 실패:", e.message);
  process.exit(1);
});
