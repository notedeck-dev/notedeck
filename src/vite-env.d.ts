/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __BUILD_DATE__: string
declare const __GIT_COMMIT__: string

declare module '*.json5' {
  const value: unknown
  export default value
}

/** 言語ごとに合成した辞書 (scripts/gen-i18n.ts の i18nLocalePlugin, #135) */
declare module 'virtual:nd-locale/*' {
  const locale: import('@/i18n/locale.generated').Locale
  export default locale
}
