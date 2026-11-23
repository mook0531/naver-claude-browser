#!/bin/bash
# Claude 데스크톱 앱에 이 브라우저를 도구로 등록
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치하세요."
  open https://nodejs.org; read -p "Enter를 누르면 닫힙니다"; exit 1
fi
if [ ! -x node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ] || [ ! -f node_modules/@modelcontextprotocol/sdk/package.json ]; then
  echo "필요한 파일을 먼저 설치합니다..."
  npm install
fi
node setup-claude.js
read -p "Enter를 누르면 닫힙니다"
