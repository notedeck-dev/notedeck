import { AppError } from '@/utils/errors'
import { unwrap } from '@/utils/tauriInvoke'

/**
 * ドメイン別ファクトリ (notes.ts / users.ts / ...) に渡す共有コンテキスト。
 * 旧 MisskeyApi クラスのフィールド + requireAuth() に相当する。
 */
export interface MisskeyApiContext {
  accountId: string
  hasToken: boolean
  /** 認証必須 API の入口ガード。ゲスト/ログアウト時は AppError('AUTH_NO_TOKEN') を投げる */
  requireAuth(): void
}

export function createContext(
  accountId: string,
  hasToken: boolean,
): MisskeyApiContext {
  return {
    accountId,
    hasToken,
    requireAuth() {
      if (!hasToken) throw new AppError('AUTH_NO_TOKEN', 'ログインが必要です')
    },
  }
}

/**
 * bindings.ts と adapters/types.ts で同名の型が別定義されているため、
 * unwrap() の戻り値を any にキャストして型不一致を回避する。
 * 以前の invoke() が any を返していたのと同等の安全性。
 */
export function unwrapAny(
  result: { status: string; data?: unknown; error?: unknown },
  // biome-ignore lint/suspicious/noExplicitAny: bridge between bindings and adapter types
): any {
  return unwrap(result as Parameters<typeof unwrap>[0])
}
