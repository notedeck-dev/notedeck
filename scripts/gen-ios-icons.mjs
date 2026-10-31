#!/usr/bin/env node
// `tauri icon` の iOS アイコンは icon.svg をそのまま白背景に敷くため、角丸の
// マスクで葉が欠ける。Android の adaptive icon と同じ見た目 (同じ背景色の上に、
// 108dp キャンバスの中央 72dp を切り出した foreground) で生成し直す。
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAMES = [
	'20x20@1x',
	'20x20@2x',
	'20x20@2x-1',
	'20x20@3x',
	'29x29@1x',
	'29x29@2x',
	'29x29@2x-1',
	'29x29@3x',
	'40x40@1x',
	'40x40@2x',
	'40x40@2x-1',
	'40x40@3x',
	'512@2x',
	'60x60@2x',
	'60x60@3x',
	'76x76@1x',
	'76x76@2x',
	'83.5x83.5@2x',
]

const iconsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'icons')
const background = readFileSync(join(iconsDir, 'android', 'values', 'ic_launcher_background.xml'), 'utf8').match(
	/>(#[0-9a-fA-F]+)</,
)[1]
const svg = readFileSync(join(iconsDir, 'ic_launcher_foreground.svg'), 'utf8')
	.replace('viewBox="0 0 108 108">', `viewBox="18 18 72 72">\n  <rect x="18" y="18" width="72" height="72" fill="${background}"/>`)

for (const name of NAMES) {
	const [, base, scale] = name.match(/^([\d.]+)(?:x[\d.]+)?@(\d)x/)
	const size = String(Math.round(Number(base) * Number(scale)))
	const out = join(iconsDir, 'ios', `AppIcon-${name}.png`)
	execFileSync('rsvg-convert', ['-w', size, '-h', size, '-o', out], { input: svg })
	console.log(`${name}: ${size}x${size} -> ${out}`)
}
