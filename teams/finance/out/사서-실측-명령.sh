#!/bin/sh
# 사서 실측 — 하네스가 저장소 뿌리에서 그대로 돌린다. 출력은 서고 밖(teams/finance/out/library/실측/)에 쌓인다 —
# out/ 에 두면 그 출력이 다음 build 에 문서로 잡혀 find 를 오염시킨다(3판에서 실제로 그랬다: 결과 .txt 가 209번째 문서가 됐다).
# 1) 빌드·점검  2) 물음 다섯을 find 로 — 이 출력이 out/사서-물음-다섯.md 의 '고친 답' 과 얼마나 겹치는지가 라) 의 진짜 셈이다.
set -e
cd "$(dirname "$0")/../../.."
mkdir -p teams/finance/out/library/실측
OUT="teams/finance/out/library/실측/$(date +%Y-%m-%d-%H%M).txt"
{
  node tools/library.mjs build
  node tools/library.mjs check
  echo '=== 물음 1 · 마크 M2 인형 판정'
  node tools/library.mjs find 인형 열여섯 열다섯 colormap 실루엣 렌더 --limit=20
  echo '=== 물음 2 · 테라 계약 탭 절(대시보드·보고서·알림)'
  node tools/library.mjs find 관제탑 탭 알림 보고서 대시보드 막힌 --limit=20
  echo '=== 물음 3 · 하영 분석 탭 낱말·직책'
  node tools/library.mjs find 분석 낱말 직책 사전 문장 --limit=20
  echo '=== 물음 4 · 톰 gemini 임시 외부감사 결정'
  node tools/library.mjs find gemini codex 한도 외부감사 제리 --limit=20
  echo '=== 물음 5 · 라운드 닫는 규칙'
  node tools/library.mjs find 라운드 닫는 pass 반박 착수 마일스톤 --limit=20
} 2>&1 | tee "$OUT"
echo "→ $OUT"
