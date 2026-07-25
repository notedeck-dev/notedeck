#!/usr/bin/env node
// `tauri icon` は Android adaptive icon の foreground を ic_launcher と同じ
// サイズ・同じ絵柄で出力してしまう。foreground レイヤーは 108dp キャンバスに
// 引き伸ばされ中央 72dp だけが表示されるため、ロゴが約 1.5 倍にズームして
// 見切れる。セーフゾーンを織り込んだ ic_launcher_foreground.svg から
// 正しい 108dp 相当のサイズで生成し直す。
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 108dp キャンバス × 各密度のスケール
const DENSITIES = {
	mdpi: 108,
	hdpi: 162,
	xhdpi: 216,
	xxhdpi: 324,
	xxxhdpi: 432,
}

const iconsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'icons')
const src = join(iconsDir, 'ic_launcher_foreground.svg')

for (const [density, size] of Object.entries(DENSITIES)) {
	const out = join(iconsDir, 'android', `mipmap-${density}`, 'ic_launcher_foreground.png')
	execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', out, src])
	console.log(`${density}: ${size}x${size} -> ${out}`)
}
