#!/bin/bash
# 스튜디오 에이전트 실행 (Mac) — 더블클릭하세요.
cd "$(dirname "$0")" || exit 1
# Finder에서 열면 PATH가 짧아서 Homebrew 등으로 설치한 node를 못 찾을 수 있습니다.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js가 설치되어 있지 않습니다."
  echo "  https://nodejs.org 에서 LTS 버전을 설치한 뒤 이 파일을 다시 실행하세요."
  echo ""
  open "https://nodejs.org"
  read -r -p "Enter 키를 누르면 닫힙니다."
  exit 1
fi
node launcher.mjs
