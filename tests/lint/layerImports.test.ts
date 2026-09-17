// 「層の依存方向」を機械検査に落とす (#1098)。
//
// CLAUDE.md / DEVELOPMENT.md が定める向きは
//   components → composables → stores → services → adapters → bindings
// で、services は「純ロジックを store に書かず直接ユニットテストする」層 (#782)、
// adapters はフォーク差異を吸収する層。ところがこの向きは文書にしか無く、
// biome の import 制限もアーキテクチャテストも無かったため、監査時点で
//   - services が store や toast を runtime import する
//   - stores が composables を、adapters が stores を import する (向きの逆転)
//   - components が bindings / tauriInvoke / adapters/factory を直接叩く
// が積み上がっていた。設計が悪いのではなく、適用率を測る手段が無かった。
//
// 方針はラチェット。既存の違反は ALLOWED に理由つきで凍結し、新しい違反は
// 落とす。ALLOWED の項目が直ったら消す (消し忘れは下の「実在する違反だけを
// 挙げる」で落ちる)。`import type` は依存ではないので数えない。
//
// components の直接 IPC は「窓の中身は自分で取りに行く」設計が混在していて、
// 一括で composable に寄せる判断は別 issue。ここでは増やさないことだけ守る。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')

interface Rule {
  /** 検査対象ディレクトリ (src 相対) */
  from: string
  /** 禁止する import 先 (指定子の前方一致) */
  forbid: string[]
  /** 凍結した既存違反: "src 相対パス" → 理由 */
  allowed: Record<string, string>
}

/** 監査時点 (#1098) の違反をまとめて凍結する。個別の理由が要るものは直接書く。 */
function frozen(paths: string[], reason: string): Record<string, string> {
  return Object.fromEntries(paths.map((p) => [p, reason]))
}

const RULES: Record<string, Rule> = {
  'services は stores / composables / components / UI 通知 / vue / pinia を runtime import しない':
    {
      from: 'src/services',
      forbid: [
        '@/stores/',
        '@/composables/',
        '@/components/',
        '@/utils/toastNotify',
        'vue',
        'pinia',
      ],
      allowed: {
        'src/services/deckProfileFiles.ts':
          '凍結 (#1098): 読込失敗を toast で知らせる。警告は戻り値で返して呼び出し側 (store) が出すべき',
        'src/services/entityResolution.ts':
          '凍結 (#1098): accounts store を直接引く。アカウント一覧は引数で受けるべき',
      },
    },
  'stores は components を import しない': {
    from: 'src/stores',
    forbid: ['@/components/'],
    allowed: {},
  },
  'stores は composables を import しない (向きの逆転)': {
    from: 'src/stores',
    forbid: ['@/composables/'],
    allowed: frozen(
      [
        'src/stores/chatMessageStore.ts',
        'src/stores/deck.ts',
        'src/stores/notes.ts',
        'src/stores/performance.ts',
        'src/stores/windows.ts',
      ],
      '凍結 (#1098): frame scheduler / snapshot / adaptive quality / back button / PiP は composable ではなく core か services に置くべきもの',
    ),
  },
  'adapters は stores を import しない (向きの逆転)': {
    from: 'src/adapters',
    forbid: ['@/stores/'],
    allowed: {
      'src/adapters/factory.ts':
        '凍結 (#1098): 絵文字 / pinned reaction / server store を adapter 初期化時に引く。依存は呼び出し側から注入すべき',
    },
  },
  'columns のレジストリは components を import しない': {
    from: 'src/columns',
    forbid: ['@/components/'],
    allowed: {},
  },
  'windows のレジストリは components を import しない': {
    from: 'src/windows',
    forbid: ['@/components/'],
    allowed: {},
  },
  'capabilities は components を import しない': {
    from: 'src/capabilities',
    forbid: ['@/components/'],
    allowed: {},
  },
  'components は IPC / adapter factory を直接叩かない': {
    from: 'src/components',
    forbid: [
      '@/bindings',
      '@/utils/tauriInvoke',
      '@/adapters/factory',
      '@tauri-apps/api/core',
    ],
    allowed: frozen(
      [
        'src/components/common/MkChatMessage.vue',
        'src/components/common/MkDrivePicker.vue',
        'src/components/common/MkMediaLightbox.vue',
        'src/components/common/MkNote.vue',
        'src/components/common/MkNoteEmbed.vue',
        'src/components/common/MkReactionUsersPopup.vue',
        'src/components/common/MkUserPopup.vue',
        'src/components/common/NoteMoreMenu.vue',
        'src/components/common/NoteReactionUsersModal.vue',
        'src/components/common/RenoteMoreMenu.vue',
        'src/components/common/TitleBarMenu.vue',
        'src/components/deck/AddColumnDialog.vue',
        'src/components/deck/DeckAboutMisskeyColumn.vue',
        'src/components/deck/DeckAchievementsColumn.vue',
        'src/components/deck/DeckAiScriptColumn.vue',
        'src/components/deck/DeckAnnouncementsColumn.vue',
        'src/components/deck/DeckAntennaColumn.vue',
        'src/components/deck/DeckApiConsoleColumn.vue',
        'src/components/deck/DeckApiDocsColumn.vue',
        'src/components/deck/DeckChannelColumn.vue',
        'src/components/deck/DeckChartsColumn.vue',
        'src/components/deck/DeckChatColumn.vue',
        'src/components/deck/DeckClientSearchColumn.vue',
        'src/components/deck/DeckDriveColumn.vue',
        'src/components/deck/DeckEmojiColumn.vue',
        'src/components/deck/DeckExploreColumn.vue',
        'src/components/deck/DeckFederationColumn.vue',
        'src/components/deck/DeckFollowRequestsColumn.vue',
        'src/components/deck/DeckGalleryColumn.vue',
        'src/components/deck/DeckLayout.vue',
        'src/components/deck/DeckListColumn.vue',
        'src/components/deck/DeckLookupColumn.vue',
        'src/components/deck/DeckMentionsColumn.vue',
        'src/components/deck/DeckNavbar.vue',
        'src/components/deck/DeckNotificationColumn.vue',
        'src/components/deck/DeckPageColumn.vue',
        'src/components/deck/DeckPlayColumn.vue',
        'src/components/deck/DeckRoleColumn.vue',
        'src/components/deck/DeckSearchColumn.vue',
        'src/components/deck/DeckServerInfoColumn.vue',
        'src/components/deck/DeckTimelineColumn.vue',
        'src/components/deck/widgets/WidgetAiScript.vue',
        'src/components/window/AboutContent.vue',
        'src/components/window/BackupContent.vue',
        'src/components/window/CacheEditorContent.vue',
        'src/components/window/ClipDetailContent.vue',
        'src/components/window/DriveFileDetailContent.vue',
        'src/components/window/FollowListContent.vue',
        'src/components/window/GalleryDetailContent.vue',
        'src/components/window/InstanceProfileContent.vue',
        'src/components/window/ListDetailContent.vue',
        'src/components/window/LoginContent.vue',
        'src/components/window/NoteDetailContent.vue',
        'src/components/window/NoteInspectorContent.vue',
        'src/components/window/NotificationInspectorContent.vue',
        'src/components/window/PageDetailContent.vue',
        'src/components/window/PageEditContent.vue',
        'src/components/window/PermissionsContent.vue',
        'src/components/window/PlayDetailContent.vue',
        'src/components/window/PlayEditContent.vue',
        'src/components/window/UserActivityFollowingChart.vue',
        'src/components/window/UserActivityHeatmap.vue',
        'src/components/window/UserActivityNotesChart.vue',
        'src/components/window/UserActivityPvChart.vue',
        'src/components/window/UserProfileContent.vue',
        'src/components/window/WidgetEditContent.vue',
        'src/components/window/user-profile/UserProfileAchievementsPane.vue',
        'src/components/window/user-profile/UserProfileClipsPane.vue',
        'src/components/window/user-profile/UserProfileGalleryPane.vue',
        'src/components/window/user-profile/UserProfileListsPane.vue',
        'src/components/window/user-profile/UserProfilePagesPane.vue',
        'src/components/window/user-profile/UserProfilePlayPane.vue',
        'src/components/window/user-profile/UserProfileQrCode.vue',
      ],
      '凍結 (#1098): 監査時点の直接 IPC / adapter factory 呼び出し。composable か store に寄せる順番は #1098 のチェックリストで決める',
    ),
  },
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(ts|vue)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name))
      out.push(path)
  }
  return out
}

/** runtime 依存になる import 指定子を列挙する (`import type` と全指定子 `type` は除外)。 */
function runtimeImports(src: string): string[] {
  const out: string[] = []
  const stmt = /^(?:import|export)\s+([^'"]*?)\s*from\s*['"]([^'"]+)['"]/gm
  for (const m of src.matchAll(stmt)) {
    const clause = m[1].trim()
    if (clause.startsWith('type ')) continue
    const braces = clause.match(/^\{([\s\S]*)\}$/)
    if (braces) {
      const names = braces[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (names.length > 0 && names.every((n) => n.startsWith('type ')))
        continue
    }
    out.push(m[2])
  }
  for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g))
    out.push(m[1])
  return out
}

function violations(rule: Rule): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const file of sourceFiles(join(ROOT, rule.from))) {
    const hits = runtimeImports(readFileSync(file, 'utf-8')).filter((spec) =>
      rule.forbid.some((f) => spec === f || spec.startsWith(f)),
    )
    if (hits.length > 0) found.set(relative(ROOT, file), [...new Set(hits)])
  }
  return found
}

describe('層の依存方向', () => {
  for (const [name, rule] of Object.entries(RULES)) {
    describe(name, () => {
      const found = violations(rule)

      it('ALLOWED に無い違反が無い', () => {
        const fresh = [...found]
          .filter(([rel]) => !(rel in rule.allowed))
          .map(([rel, specs]) => `${rel} → ${specs.join(', ')}`)
        expect(fresh).toEqual([])
      })

      it('ALLOWED は実在する違反だけを挙げる (直したら消す)', () => {
        const stale = Object.keys(rule.allowed).filter((rel) => !found.has(rel))
        expect(stale).toEqual([])
      })
    })
  }
})
