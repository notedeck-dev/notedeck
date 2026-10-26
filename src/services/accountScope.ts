/**
 * per-account 紐付けに使う安定キー。内部 UUID (`Account.id`) はログインの
 * たびに再生成されるため永続データの紐付けには使えない (#771)。
 * host + サーバー側 userId は再ログインしても変わらない。
 */
export function accountScopeKey(account: {
  host: string
  userId: string
}): string {
  return `${account.host}:${account.userId}`
}
