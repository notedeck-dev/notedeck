/**
 * Identity ID (#491) の表記規則。`skill:<id>` プレフィックスが persona、
 * それ以外は Account.id。store を引く解決 (resolve / list) は utils/identity。
 */
const PERSONA_PREFIX = 'skill:'

/**
 * Identity ID を生成する小さなヘルパ。
 * - `personaIdentityId('aizu-9k2x')` → `'skill:aizu-9k2x'`
 * - Account は `account.id` をそのまま Identity ID にする
 */
export function personaIdentityId(skillId: string): string {
  return `${PERSONA_PREFIX}${skillId}`
}

export function isPersonaIdentityId(id: string): boolean {
  return id.startsWith(PERSONA_PREFIX)
}

/**
 * Identity ID から元の skill id を取り出す。persona でないなら null。
 */
export function extractSkillIdFromIdentity(id: string): string | null {
  if (!isPersonaIdentityId(id)) return null
  return id.slice(PERSONA_PREFIX.length) || null
}
