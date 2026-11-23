// 바탕화면(과 시작 메뉴)에 '네이버 Claude 브라우저' 바로가기를 만든다.
// Windows: PowerShell의 WScript.Shell로 .lnk 생성 (OneDrive 바탕화면도 자동으로 찾음)
// macOS:   바탕화면에 실행용 .command 파일 생성
// Linux:   ~/.local/share/applications 와 바탕화면에 .desktop 파일 생성
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const NAME = "네이버 Claude 브라우저";
const appDir = __dirname;
let electronExe;
try {
  electronExe = require(path.join(appDir, "node_modules", "electron")); // electron 실행 파일 경로
} catch {}
if (!electronExe || !fs.existsSync(electronExe)) {
  console.error("[오류] 브라우저가 아직 설치되지 않았습니다. 먼저 '실행(Windows).bat'을 한 번 실행하세요.");
  process.exit(1);
}

if (process.platform === "win32") {
  const icon = path.join(appDir, "assets", "icon.ico");
  const q = (s) => "'" + s.replace(/'/g, "''") + "'"; // PowerShell 문자열
  const ps = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$targets = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) ''))
foreach ($dir in $targets) {
  if (-not (Test-Path $dir)) { continue }
  $lnk = $shell.CreateShortcut((Join-Path $dir ${q(NAME + ".lnk")}))
  $lnk.TargetPath = ${q(electronExe)}
  $lnk.Arguments = ${q('"' + appDir + '"')}
  $lnk.WorkingDirectory = ${q(appDir)}
  $lnk.IconLocation = ${q(icon + ",0")}
  $lnk.Description = ${q("네이버를 보면서 Claude와 함께 쓰는 브라우저")}
  $lnk.Save()
  Write-Output ("OK " + $lnk.FullName)
}`;
  // 한글이 깨지지 않도록 UTF-16 Base64로 전달
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")], { encoding: "utf8" });
  const made = (r.stdout || "").split(/\r?\n/).filter((l) => l.startsWith("OK ")).map((l) => l.slice(3));
  if (r.status !== 0 || !made.length) {
    console.error("[오류] 바로가기를 만들지 못했습니다.\n" + (r.stderr || r.stdout || "").slice(-600));
    process.exit(1);
  }
  for (const f of made) console.log("바로가기 생성: " + f);
} else if (process.platform === "darwin") {
  const file = path.join(os.homedir(), "Desktop", NAME + ".command");
  fs.writeFileSync(file, `#!/bin/bash\nopen -a ${JSON.stringify(path.join(path.dirname(path.dirname(path.dirname(electronExe)))))} --args ${JSON.stringify(appDir)}\n`);
  fs.chmodSync(file, 0o755);
  console.log("바로가기 생성: " + file);
} else {
  const entry = `[Desktop Entry]\nType=Application\nName=${NAME}\nExec="${electronExe}" "${appDir}"\nIcon=${path.join(appDir, "assets", "icon.png")}\nTerminal=false\nCategories=Network;WebBrowser;\n`;
  const targets = [path.join(os.homedir(), ".local", "share", "applications"), path.join(os.homedir(), "Desktop")];
  for (const dir of targets) {
    if (!fs.existsSync(dir)) continue;
    const file = path.join(dir, "naver-claude-browser.desktop");
    fs.writeFileSync(file, entry);
    fs.chmodSync(file, 0o755);
    console.log("바로가기 생성: " + file);
  }
}

console.log(`
바탕화면의 '${NAME}' 아이콘을 더블클릭하면 브라우저가 열립니다.
(이 폴더 ${appDir} 를 옮기면 바로가기가 동작하지 않으니, 옮긴 뒤 이 파일을 다시 실행하세요.)`);
