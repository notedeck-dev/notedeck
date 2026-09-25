import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

/**
 * Skill 系 capability — 「自己拡張する IDE」の中核 (memory:
 * project_self_extending_ide_roadmap.md)。AI / プラグインが skill の
 * 本文 (markdown body) を編集することで、persona が自分の知識・態度を
 * 育てられる。
 *
 * 設計判断:
 * - frontmatter (id / version / mode / builtIn / isPersona) は
 *   触らせない。本文 markdown のみ編集対象
 * - 全文置換は破壊的なので append / replaceSection を提供 (memory 推奨)
 * - 編集系は requiresConfirmation: true (= ユーザー承認後に書込)
 * - Phase 1 では「どの skill を編集できるか」は permission レベル管理
 *   (scope 制限 = persona の自分の skill だけ、は Phase 2)
 */

export const skillsListCapability = implementCore('skills.list')

export const skillsReadCapability = implementCore('skills.read')

/**
 * `skills.create` — 新規スキルの作成 (#726)。
 *
 * 設計判断:
 * - 冒頭コメントの「frontmatter は AI に触らせない」は維持する。raw
 *   frontmatter は受け取らず、ホワイトリスト化した構造化パラメータのみ
 *   受ける。builtIn / isPersona / storeId はパラメータに存在しない
 *   (= 物理的に付与不可能)
 * - 新規作成専用。id は内部生成 (generateSkillId) で AI に選ばせない
 *   (= 将来の built-in id の先取り占拠や既存スキルの上書きを構造的に排除)。
 *   self-edit は従来どおり append / replaceSection の領分
 * - mode=always / heartbeat は保存直後から AI の指示ストリームに自動合流
 *   するため warning 型 confirm にする
 * - mode=trigger で triggers 空は永久に発火しない死にスキルになるので拒否
 *   (ファイル読込側 metaFromFrontmatter が寛容なのはユーザー手書きファイルで
 *   起動を落とさないため。create は AI がエラーを読んでリトライできる)
 * - cheapCheckCapabilities は素通しで保存する。cheap=true でない id は
 *   HEARTBEAT runner 側が無視する既存フィルタに委ねる
 */
export const skillsCreateCapability = implementCore('skills.create')

export const skillsAppendCapability = implementCore('skills.append')

/**
 * markdown の `## <heading>` セクションを置換する。指定 heading が
 * 見つからない場合は本文末尾に新規セクションとして追加する (= idempotent)。
 *
 * セクションは `## <heading>` から次の同レベル以上の見出し (= `## ` / `# `)
 * までを 1 つの単位として扱う。
 */
export const skillsReplaceSectionCapability = implementCore(
  'skills.replaceSection',
)

export const skillsToggleCapability = implementCore('skills.toggle')

export const skillsHistoryCapability = implementCore('skills.history')

export const skillsRevertCapability = implementCore('skills.revert')

/**
 * `skills.install` — MisStore (store.notedeck.io) から既製 skill を取得して
 * skills store に追加する。AI が「翻訳がうまい persona ない？」のように
 * 推薦から install まで一気通貫で実行できるようにするためのラッパ。
 *
 * 設計判断 (memory: project_self_extending_ide_roadmap.md):
 * - これは **AI が他 persona / curator skill を取得する経路**であり、
 *   skill self-edit (= AI が自分の設計図を書き換える) とは別物。
 *   後者は鶏卵問題のため意図的に避けている。
 * - 内部実装は `useMisStoreStore.installSkill(entry)` (sha512 検証 +
 *   frontmatter parse + add/update まで完備) を呼ぶだけ。
 */
export const skillsInstallCapability = implementCore('skills.install')

/**
 * `skills.uninstall` — インストール済みスキルを完全削除する。
 *
 * 同梱 skill は廃止したので (#746)、削除できない skill は無い。不可逆操作の
 * 保護は確認ダイアログ (削除内容と「残りません」の明示) が担う。
 */
export const skillsUninstallCapability = implementCore('skills.uninstall')

export const SKILLS_BUILTIN_CAPABILITIES: readonly Command[] = [
  skillsListCapability,
  skillsReadCapability,
  skillsCreateCapability,
  skillsAppendCapability,
  skillsReplaceSectionCapability,
  skillsToggleCapability,
  skillsInstallCapability,
  skillsUninstallCapability,
  skillsHistoryCapability,
  skillsRevertCapability,
]
