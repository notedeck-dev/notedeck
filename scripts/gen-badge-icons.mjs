#!/usr/bin/env node
// Windows タスクバーの未読バッジ (オーバーレイアイコン) の元画像を生成する。
// Rust 側 (commands/utility.rs の overlay_badge) が埋め込み、表示倍率に合わせた
// 実寸 (16px × 倍率) に縮小して使うため、大きめの解像度で描いておく。
// 数字は Noto Sans Bold (fontconfig で引ける必要がある)。
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 128
// 円は枠いっぱいにせず、ひと回り小さく描く
const RADIUS = 54
// commands/utility.rs の BADGE_RED と揃える
const RED = '#ED4245'
// Noto Sans の数字の高さは 0.714em。ベースラインをその半分だけ下げると縦中央に来る
const DIGIT_HEIGHT = 0.714

const LABELS = { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', '9plus': '9+' }

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'icons', 'badge')

for (const [name, label] of Object.entries(LABELS)) {
	const fontSize = label.length === 1 ? 80 : 64
	const baseline = SIZE / 2 + (fontSize * DIGIT_HEIGHT) / 2
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${RADIUS}" fill="${RED}"/>
  <text x="${SIZE / 2}" y="${baseline}" text-anchor="middle" font-family="Noto Sans" font-weight="700" font-size="${fontSize}" fill="#fff">${label}</text>
</svg>`
	const out = join(outDir, `badge-${name}.png`)
	execFileSync('rsvg-convert', ['-o', out], { input: svg })
	console.log(`${label} -> ${out}`)
}
