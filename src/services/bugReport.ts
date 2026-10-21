/**
 * 非開発者向けの不具合・要望の受け口 (#1019)。GitHub アカウントを持たない人が
 * Misskey アカウントだけで報告できるよう、公式アカウント宛てのノートの下書きを組む。
 * 診断ログは載せない (公開ノートになるため)。足すのは版と環境の 1 行だけ。
 */
export const OFFICIAL_MISSKEY_ACCOUNT = 'notedeck@misskey.io'

export function buildMisskeyReportText(env: {
  version: string
  os: string
  webView: string
}): string {
  const mention = `@${OFFICIAL_MISSKEY_ACCOUNT}`
  const footer = `NoteDeck v${env.version} / ${env.os} / ${env.webView}`
  return `${mention} \n\n\n${footer}`
}
