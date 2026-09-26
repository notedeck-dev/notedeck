/**
 * 表示言語の決定と切り替え (#135)。
 *
 * 起動時に locale.json5 を読んで言語を決め、その 1 言語分の辞書を読む
 * (main.ts の起動待ちに相乗り)。切り替えはリロードで反映する (辞書を
 * リアクティブにしない)。サブデッキ / PiP も同じ辞書を持つ必要があるので、
 * 全ウィンドウに変更を知らせてリロードさせる。
 */

import { computed, readonly, ref } from 'vue'
import { useDeveloperMode } from '@/composables/useDeveloperMode'
import { LANGUAGES, loadLocale } from '@/i18n'
import {
  initialLocaleSetting,
  type LocalePreference,
  type LocaleSetting,
  parseLocaleSetting,
  resolveLanguage,
  serializeLocaleSetting,
} from '@/services/localeSetting'
import {
  isMainDeckWindow,
  isTauri,
  readLocaleSettingFile,
  writeLocaleSettingFile,
} from '@/utils/settingsFs'
import { emitTauri, listenTauri } from '@/utils/tauriEvents'
import { commands, unwrap } from '@/utils/tauriInvoke'

const WINDOW_SOURCE_ID = crypto.randomUUID()
const preference = ref<LocalePreference>('auto')

function systemLanguages(): readonly string[] {
  return navigator.languages?.length
    ? navigator.languages
    : [navigator.language]
}

async function readSetting(): Promise<LocaleSetting> {
  const existing = parseLocaleSetting(await readLocaleSettingFile())
  if (existing) return existing

  // locale.json5 が無い = このバージョンを初めて起動した。settings.json5 が
  // あれば i18n 導入前から使っているインストール (開発者モードの初期値判定
  // #1034 はアカウントのロードを待つが、言語は mount 前に要るので使えない)
  const hasSettings = unwrap(await commands.readNotedeckJson()).trim() !== ''
  const initial = initialLocaleSetting(hasSettings)
  // サブウィンドウはメインが書いた後に開くので、書くのはメインだけ
  if (isMainDeckWindow())
    await writeLocaleSettingFile(serializeLocaleSetting(initial))
  return initial
}

/** 表示言語を決めて辞書を読む。mount 前に await する */
export async function initLocale(): Promise<void> {
  let setting: LocaleSetting = { locale: 'auto' }
  if (isTauri) {
    try {
      setting = await readSetting()
    } catch (e) {
      console.warn('[i18n] locale.json5 unavailable, using auto:', e)
    }
    void listenTauri('nd:locale-changed', ({ sourceId }) => {
      if (sourceId !== WINDOW_SOURCE_ID) location.reload()
    })
  }
  preference.value = setting.locale
  await loadLocale(
    resolveLanguage(setting.locale, systemLanguages(), LANGUAGES),
  )
}

export function useLocale() {
  const developerMode = useDeveloperMode()

  /** 言語選択に出す言語。未公開の言語は開発者モードでだけ選べる */
  const choices = computed(() =>
    LANGUAGES.filter(
      (l) =>
        l.published ||
        developerMode.enabled.value ||
        l.code === preference.value,
    ),
  )

  async function setPreference(value: LocalePreference): Promise<void> {
    // web ビルドには設定ファイルが無い
    if (!isTauri || value === preference.value) return
    // 自分で選んだので、移行由来の印 (migrated) は外す
    await writeLocaleSettingFile(serializeLocaleSetting({ locale: value }))
    await emitTauri('nd:locale-changed', { sourceId: WINDOW_SOURCE_ID })
    location.reload()
  }

  return { preference: readonly(preference), choices, setPreference }
}
