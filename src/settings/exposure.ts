/**
 * 面の帰属タグと露出判定 (#1034)。
 *
 * カラム・ウィンドウ・コマンド・設定セクションといった「ユーザーに見える面」は
 * それぞれ帰属タグを持ち、アクティブなタグ集合に含まれるものだけが露出する。
 * タグ未指定は 'general' 扱いなので、既存の面は宣言を足さない限り今までどおり出る。
 *
 * 対象者の軸 (開発者モード) を先に実装しているが、複雑さの軸 (#1024) が来たら
 * タグを 1 つ足して activeExposureTags を広げるだけで済む形にしてある。
 *
 * 隠すのは入口だけで、デッキに既に置かれたカラムやユーザーが開いたウィンドウの
 * 描画は止めない (決定録 3)。認可の境界でもない — 認可は permissions.json5 の仕事。
 */

import { useSettingsStore } from '@/stores/settings'

export type ExposureTag = 'general' | 'developer'

/** 今どのタグの面が露出しているか */
export function activeExposureTags(): ReadonlySet<ExposureTag> {
  const tags = new Set<ExposureTag>(['general'])
  if (useSettingsStore().get('ui.developerMode') === true) {
    tags.add('developer')
  }
  return tags
}

/** 面が今の露出モードで見えるか。タグ未指定は 'general' 扱い。 */
export function isExposed(tag: ExposureTag | undefined): boolean {
  return activeExposureTags().has(tag ?? 'general')
}
