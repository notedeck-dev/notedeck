// Rust から JNI で呼ぶ Kotlin のメソッドが release の R8 に消されないことを検査する (#330)。
//
// Kotlin から誰も呼ばないメソッドは、keep しないと release の R8 が消したり名前を
// 変えたりする。debug ビルドは縮小しないので手元では動き、release 版だけで静かに壊れる
// (v1.92.0〜v1.95.1 は OS 通知の描画・push の登録・ステータスバーの明暗が動いていなかった)。
// ここでは Rust 側の呼び先の名前を集め、keep 規則 (src-tauri/android/proguard-jni.pro) と
// Kotlin の宣言に揃っているかを見る。

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')
const KEEP = read('src-tauri/android/proguard-jni.pro')

const names = (source: string, pattern: RegExp) =>
  [...new Set([...source.matchAll(pattern)].map((m) => m[1] ?? ''))].sort()

// 静的メソッド (Kotlin の object の @JvmStatic) を呼ぶクラスと、その呼び出しの形
const STATIC_TARGETS = [
  {
    kotlin: 'NotificationRenderer',
    calls: names(
      read('src-tauri/src/android_notify.rs'),
      /(?:call_static\(\s*|renderer_class,\s*)"(\w+)"/g,
    ),
  },
  {
    kotlin: 'PushBridge',
    calls: names(
      read('src-tauri/src/android_push.rs'),
      /(?:with_push_class|call_string|call_string_arg|call_void_arg)\(\s*"(\w+)"/g,
    ),
  },
]

describe('Rust から JNI で呼ぶ Kotlin のメソッドは release で残る', () => {
  it.each(
    STATIC_TARGETS,
  )('$kotlin の静的メソッドを keep し、Kotlin 側も @JvmStatic で持つ', ({
    kotlin,
    calls,
  }) => {
    expect(calls.length).toBeGreaterThan(0)
    expect(KEEP).toContain(
      `-keep class com.notedeck.desktop.${kotlin} { public static *; }`,
    )
    const source = read(`src-tauri/android/${kotlin}.kt`)
    const missing = calls.filter(
      (name) => !new RegExp(`@JvmStatic\\s+fun ${name}\\(`).test(source),
    )
    expect(missing, `${kotlin}.kt に @JvmStatic で無い`).toEqual([])
  })

  it('MainActivity のインスタンスメソッドを 1 つずつ keep する', () => {
    const calls = names(
      read('src-tauri/src/commands/utility.rs'),
      /call_method\(\s*&activity,\s*"(\w+)"/g,
    )
    expect(calls.length).toBeGreaterThan(0)
    const missing = calls.filter(
      (name) => !KEEP.includes(`public void ${name}(`),
    )
    expect(missing, 'proguard-jni.pro の MainActivity に無い').toEqual([])
  })

  it('sync.sh が keep 規則を gen の app 直下に置く', () => {
    expect(read('src-tauri/android/sync.sh')).toContain(
      'cp "$SCRIPT_DIR/proguard-jni.pro" "$SCRIPT_DIR/../gen/android/app/proguard-jni.pro"',
    )
  })
})
