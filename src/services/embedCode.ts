/**
 * Misskey の埋め込みコード生成。yamisskey の get-embed-code.ts に揃えた形式。
 * iframe ID は `v1_<UUID>` で発番する。
 */
export function generateUserEmbedCode(host: string, userId: string): string {
  const baseUrl = `https://${host}`
  const iframeId = `v1_${crypto.randomUUID()}`
  return [
    `<iframe src="${baseUrl}/embed/user-timeline/${userId}" data-misskey-embed-id="${iframeId}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" style="border: none; width: 100%; max-width: 500px; height: 300px; color-scheme: light dark;"></iframe>`,
    `<script defer src="${baseUrl}/embed.js"></script>`,
  ].join('\n')
}
