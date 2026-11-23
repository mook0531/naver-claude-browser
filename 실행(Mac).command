#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
  open https://nodejs.org
  read -p "Enter를 누르면 닫힙니다"
  exit 1
fi
if [ ! -x node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ]; then
  echo "처음 실행이라 필요한 파일을 설치합니다. 몇 분 걸릴 수 있습니다..."
  npm install
fi
npm start
