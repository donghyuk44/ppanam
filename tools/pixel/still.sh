#!/bin/bash
# ChatGPT 가 준 64px 정지 그림(자홍 배경, 8배 512px 또는 '저장' 1254px)을 마을용으로 정리한다.
#   tools/pixel/still.sh <name> <downloaded.png>     name = <팀>-<자리> 또는 boss
# 결과: teams/design/out/gpt64/<name>-src.png (원본), teams/design/out/sprites64/<name>.png (자홍 제거·여백 자름·팔레트 스냅)
# 다음: node tools/pixel/pad.mjs (PixelLab 참고용) · node tools/pixel/cast-manifest.mjs (마을 반영)
set -e
cd "$(dirname "$0")/../.."
name=$1; src=$2
[ -n "$name" ] && [ -f "$src" ] || { echo "사용: still.sh <name> <png>"; exit 2; }
mkdir -p teams/design/out/gpt64 teams/design/out/sprites64
cp "$src" teams/design/out/gpt64/$name-src.png
w=$(node --input-type=module -e 'import {decodePNG} from "./tools/pixel/png.mjs"; import fs from "fs"; console.log(decodePNG(fs.readFileSync(process.argv[1])).width)' "$src")
if [ "$w" = "512" ]; then opt="--block 8"; else opt="--grid 64"; fi
node tools/pixel/fix.mjs teams/design/out/gpt64/$name-src.png teams/design/out/sprites64/$name.png $opt --key ff00ff --trim --palette teams/design/out/palette.json --despeckle 40
node tools/pixel/check.mjs teams/design/out/sprites64/$name.png --palette teams/design/out/palette.json --max-colors 32 || true
