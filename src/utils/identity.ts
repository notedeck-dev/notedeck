/**
 * Identity 抽象 (#491) — 「誰か」を表す論理概念。
 *
 * NoteDeck では行動主体 (Account: Misskey/guest) と人格 (Persona: skill
 * with isPersona=true) は別概念。両者を unify せず、Identity という flat
 * な参照層を作って memo の author 等で使う。
 *
 * - Account = サーバー接続を持つ行動主体 (notes.create 等の capability で
 *   実 user として振る舞う)
 * - Persona = ローカルの人格 (memo の著者として振る舞う、Misskey に投稿
 *   主としては現れない)
 *
 * 直交設計のため、Account 型は god-type 化しない (= kind discriminator を
 * 既存 Account に追加しない)。Identity は別レイヤーとして並走する。
 */

import { type Account, useAccountsStore } from '@/stores/accounts'
import { type SkillMeta, useSkillsStore } from '@/stores/skills'

export type IdentityKind = 'account' | 'persona'

/**
 * Identity = 「誰か」を表す flat 構造。
 *
 * `kind` は 2-way (account / persona) のみ。Account 内の guest 区別は
 * Identity 層では扱わず、必要なら呼出元が Account 層の `isGuestAccount`
 * で判定する (= 行動主体としての差は account 層の関心、Identity 層は
 * 表示や著者参照の関心)。
 */
export interface Identity {
  /** Identity ID — `skill:<...>` プレフィックスは persona、それ以外は Account.id。 */
  id: string
  kind: IdentityKind
  displayName: string
  avatarUrl?: string
  bio?: string
}

const PERSONA_PREFIX = 'skill:'

/**
 * Identity ID を生成する小さなヘルパ。
 * - `personaIdentityId('aizu-9k2x')` → `'skill:aizu-9k2x'`
 * - `accountIdentityId('acc-1234')` → `'acc-1234'` (= そのまま)
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

function fromAccount(account: Account): Identity {
  return {
    id: account.id,
    kind: 'account',
    displayName: account.displayName || account.username,
    avatarUrl: account.avatarUrl ?? undefined,
  }
}

function fromPersonaSkill(skill: SkillMeta): Identity {
  return {
    id: personaIdentityId(skill.id),
    kind: 'persona',
    displayName: skill.name,
    avatarUrl: skill.iconUrl,
    bio: skill.description,
  }
}

/**
 * Identity ID から Identity を解決する。
 * 都度 store を引くので skill / account の rename / icon 変更が即反映される
 * (= cache せず live 解決)。見つからなければ null (= dangling)。
 *
 * persona 候補は `isPersona === true` の skill のみ受理する。フラグなしの
 * skill を identity として返さないことで、persona セレクタの整合性を担保する。
 */
export function resolveIdentity(id: string): Identity | null {
  if (!id) return null
  if (isPersonaIdentityId(id)) {
    const skillId = extractSkillIdFromIdentity(id)
    if (!skillId) return null
    const skill = useSkillsStore().get(skillId)
    if (!skill || !skill.isPersona) return null
    return fromPersonaSkill(skill)
  }
  const account = useAccountsStore().accounts.find((a) => a.id === id)
  if (!account) return null
  return fromAccount(account)
}

/** persona-eligible な skill 一覧 (UI セレクタ候補)。 */
export function listPersonaIdentities(): Identity[] {
  const skills = useSkillsStore().skills
  return skills.filter((s) => s.isPersona).map(fromPersonaSkill)
}

/** Identity から表示用 avatar URL を取り出す (なければ generic placeholder)。 */
export function getIdentityAvatarUrl(identity: Identity): string {
  return identity.avatarUrl || '/avatar-default.svg'
}

/** Identity から表示用ラベル (= displayName)。 */
export function getIdentityLabel(identity: Identity): string {
  return identity.displayName
}
