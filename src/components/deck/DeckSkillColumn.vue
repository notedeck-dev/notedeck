<script setup lang="ts">
import { computed, ref } from 'vue'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useTabSlide } from '@/composables/useTabSlide'
import { useConfirm } from '@/stores/confirm'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import {
  getSkillDetailUrl,
  type StoreSkillEntry,
  skillCategoryLabel,
  useMisStoreStore,
} from '@/stores/misstore'
import {
  generateSkillId,
  type SkillMeta,
  useSkillsStore,
} from '@/stores/skills'
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'
import { openSafeUrl } from '@/utils/url'
import ColumnSection from './ColumnSection.vue'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckColumn from './DeckColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const skillsStore = useSkillsStore()
const misStore = useMisStoreStore()
const windowsStore = useWindowsStore()
const { columnThemeVars } = useColumnTheme(() => props.column)

skillsStore.ensureLoaded()

type ViewTab = 'installed' | 'store'
const viewTabs: ViewTab[] = ['installed', 'store']
const viewTab = ref<ViewTab>('installed')
const columnContentRef = ref<HTMLElement | null>(null)

const tabDefs = computed<ColumnTabDef[]>(() => [
  {
    value: 'installed',
    label: `インストール済み ${skillsStore.skills.length}`,
  },
  { value: 'store', label: 'ストア' },
])

function switchTab(tab: string) {
  viewTab.value = tab as ViewTab
  if (tab === 'store') misStore.fetchSkills()
}

const tabIndex = computed(() => viewTabs.indexOf(viewTab.value))
useTabSlide(tabIndex, columnContentRef)

const searchQuery = ref('')

const visibleSkills = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const list = [...skillsStore.skills].sort((a, b) => {
    if (a.mode !== b.mode) {
      // always → heartbeat → trigger → manual の順で並べる
      const order: Record<string, number> = {
        always: 0,
        heartbeat: 1,
        trigger: 2,
        manual: 3,
      }
      return (order[a.mode] ?? 9) - (order[b.mode] ?? 9)
    }
    return a.name.localeCompare(b.name)
  })
  if (!q) return list
  return list.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      (s.description?.toLowerCase().includes(q) ?? false),
  )
})

interface SkillSection {
  key: 'builtin' | 'sideload' | 'store'
  label: string
  items: SkillMeta[]
}

/**
 * インストール済みタブのセクション分け (プラグインと同形 / 出自 3 分類):
 *   ビルドイン: アプリ同梱 (builtIn フラグ)
 *   サイドロード: ユーザー手書き・AI 生成 (storeId 無し、同梱以外)
 *   ストア配布: storeId 持ち。MisStore に上流がある複製 (改造しても残留)
 * 0 件のセクションは表示しない。
 */
const installedSections = computed<SkillSection[]>(() => {
  const builtin = visibleSkills.value.filter((s) => !s.storeId && s.builtIn)
  const sideloaded = visibleSkills.value.filter((s) => !s.storeId && !s.builtIn)
  const store = visibleSkills.value.filter((s) => !!s.storeId)
  const sections: SkillSection[] = [
    { key: 'builtin', label: 'ビルドイン', items: builtin },
    { key: 'sideload', label: 'サイドロード', items: sideloaded },
    { key: 'store', label: 'ストア配布', items: store },
  ]
  return sections.filter((s) => s.items.length > 0)
})

function isToggleable(skill: SkillMeta): boolean {
  return skill.mode !== 'always'
}

function isActive(skill: SkillMeta): boolean {
  return skillsStore.isActive(skill.id) || skill.mode === 'always'
}

function toggleActive(skill: SkillMeta) {
  if (!isToggleable(skill)) return
  skillsStore.setActive(skill.id, !skillsStore.isActive(skill.id))
}

/** HEARTBEAT (#411): skill を定期実行対象にするか toggle (mode を切り替え)。 */
function toggleHeartbeat(skill: SkillMeta) {
  skillsStore.setHeartbeat(skill.id, skill.mode !== 'heartbeat')
}

function openInEditor(skill: SkillMeta) {
  windowsStore.open('skill-edit', { skillId: skill.id })
}

function createNewSkill() {
  const id = generateSkillId('skill')
  const skill = skillsStore.add({
    id,
    name: '新規スキル',
    version: '0.1.0',
    description: '',
    mode: 'manual',
    triggers: [],
    scope: 'global',
    body: '指示文をここに記述します。\n',
    cheapCheckCapabilities: [],
  })
  windowsStore.open('skill-edit', { skillId: skill.id })
}

const { confirm } = useConfirm()

async function uninstall(skill: SkillMeta) {
  if (skill.builtIn) return
  const ok = await confirm({
    title: 'スキルを削除',
    message: `「${skill.name}」を削除しますか？スキルの本文も消えます。`,
    okLabel: '削除',
    type: 'danger',
  })
  if (!ok) return
  const undo = skillsStore.remove(skill.id)
  if (undo) {
    useToast().show('スキルを削除しました', 'info', {
      action: { label: '元に戻す', onClick: undo },
    })
  }
}

const modeLabel: Record<string, string> = {
  always: '常時',
  manual: '手動',
  trigger: '自動',
  heartbeat: 'HEARTBEAT',
}

// --- Store tab ---
const storeQuery = ref('')
const installError = ref<string | null>(null)

const filteredStoreSkills = computed(() => {
  const q = storeQuery.value.trim().toLowerCase()
  if (!q) return misStore.skills
  return misStore.skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.author.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q)),
  )
})

async function handleStoreInstall(entry: StoreSkillEntry) {
  installError.value = null
  try {
    await misStore.installSkill(entry)
  } catch (e) {
    installError.value = e instanceof Error ? e.message : 'インストール失敗'
  }
}

function handleOpenStoreDetail(entry: StoreSkillEntry) {
  openSafeUrl(getSkillDetailUrl(entry.id))
}
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? 'スキル'"
    :theme-vars="columnThemeVars"
  >
    <template #header-icon>
      <i class="ti ti-sparkles" :class="$style.headerIcon" />
    </template>

    <template #header-meta>
      <button
        v-if="viewTab === 'installed'"
        class="_button"
        :class="$style.headerBtn"
        title="新規スキルを作成"
        @click.stop="createNewSkill"
      >
        <i class="ti ti-plus" />
      </button>
    </template>

    <div ref="columnContentRef" :class="$style.wrapper">
      <ColumnTabs
        :tabs="tabDefs"
        :model-value="viewTab"
        :swipe-target="columnContentRef"
        @update:model-value="switchTab"
      />

      <div :class="$style.searchWrap">
        <input
          v-if="viewTab === 'installed'"
          v-model="searchQuery"
          :class="$style.searchInput"
          type="text"
          placeholder="スキルを探す"
        />
        <input
          v-else
          v-model="storeQuery"
          :class="$style.searchInput"
          type="text"
          placeholder="ストアを探す"
        />
      </div>

      <!-- ===== Installed tab ===== -->
      <template v-if="viewTab === 'installed'">
        <div :class="$style.list">
          <ColumnSection
            v-for="section in installedSections"
            :key="section.key"
            :label="section.label"
            :count="section.items.length"
          >
            <div
              v-for="skill in section.items"
              :key="skill.id"
              :class="[$style.card, !isActive(skill) && $style.cardDisabled]"
              @click="openInEditor(skill)"
            >
              <div :class="$style.accentBar" />
              <div :class="$style.icon">
                <span
                  v-if="skill.iconUrl"
                  :class="$style.iconImg"
                  :style="{ '--icon-url': `url('${skill.iconUrl}')` }"
                  aria-hidden="true"
                />
                <i v-else class="ti ti-sparkles" />
              </div>
              <div :class="$style.body">
                <div :class="$style.row1">
                  <span :class="$style.name">{{ skill.name }}</span>
                  <span :class="$style.modeBadge" :data-mode="skill.mode">
                    <i v-if="skill.mode === 'heartbeat'" class="ti ti-activity-heartbeat" />
                    {{ modeLabel[skill.mode] }}
                  </span>
                  <span v-if="!isActive(skill)" :class="$style.disabledBadge">無効</span>
                  <span :class="$style.spacer" />
                  <span :class="$style.version">v{{ skill.version }}</span>
                </div>
                <div :class="$style.row2">
                  {{ skill.description || 'No description' }}
                </div>
                <div :class="$style.row3">
                  <span v-if="skill.author" :class="$style.author">{{ skill.author }}</span>
                  <span v-if="skill.builtIn" :class="$style.category">内蔵</span>
                  <span :class="$style.spacer" />
                  <div :class="$style.actions">
                    <button
                      class="_button"
                      :class="[$style.iconBtn, skill.mode === 'heartbeat' && $style.heartbeatActive]"
                      :title="skill.mode === 'heartbeat' ? 'HEARTBEAT 対象から外す' : 'HEARTBEAT で定期実行する'"
                      @click.stop="toggleHeartbeat(skill)"
                    >
                      <i class="ti ti-activity-heartbeat" />
                    </button>
                    <button
                      v-if="!skill.builtIn"
                      class="_button"
                      :class="$style.iconBtn"
                      title="アンインストール"
                      @click.stop="uninstall(skill)"
                    >
                      <i class="ti ti-trash" />
                    </button>
                    <button
                      class="_button"
                      :class="$style.iconBtn"
                      title="編集"
                      @click.stop="openInEditor(skill)"
                    >
                      <i class="ti ti-edit" />
                    </button>
                    <button
                      class="_button"
                      :class="[
                        $style.primaryBtn,
                        isActive(skill) ? $style.secondaryBtn : '',
                        !isToggleable(skill) && $style.btnLocked,
                      ]"
                      :disabled="!isToggleable(skill)"
                      :title="isToggleable(skill) ? (isActive(skill) ? '無効化' : '有効化') : 'mode=always は常時有効'"
                      @click.stop="toggleActive(skill)"
                    >
                      {{ isActive(skill) ? '無効にする' : '有効にする' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </ColumnSection>

          <div v-if="visibleSkills.length === 0" :class="$style.empty">
            <i class="ti ti-sparkles" :class="$style.emptyIcon" />
            <span v-if="searchQuery">一致するスキルがありません</span>
            <span v-else>スキルがインストールされていません</span>
          </div>
        </div>
      </template>

      <!-- ===== Store tab ===== -->
      <template v-else>
        <div v-if="installError" :class="$style.storeError">
          <i class="ti ti-alert-circle" />
          {{ installError }}
          <button
            class="_button"
            :class="$style.storeErrorClose"
            @click="installError = null"
          >
            <i class="ti ti-x" />
          </button>
        </div>

        <div v-if="misStore.skillsLoading" :class="$style.empty">
          <i class="ti ti-loader-2 nd-spin" />
          読み込み中...
        </div>

        <div v-else-if="misStore.skillsError" :class="$style.empty">
          <i class="ti ti-cloud-off" :class="$style.emptyIcon" />
          <span>ストアに接続できません</span>
          <button
            class="_button"
            :class="$style.emptyLink"
            @click="misStore.refreshSkills()"
          >
            再試行
          </button>
        </div>

        <div v-else :class="$style.list">
          <div
            v-for="entry in filteredStoreSkills"
            :key="entry.id"
            :class="$style.card"
          >
            <div :class="$style.accentBar" />
            <div :class="$style.icon">
              <span
                v-if="entry.iconUrl"
                :class="$style.iconImg"
                :style="{ '--icon-url': `url('${entry.iconUrl}')` }"
                aria-hidden="true"
              />
              <i v-else class="ti ti-sparkles" />
            </div>
            <div :class="$style.body">
              <div :class="$style.row1">
                <span :class="$style.name">{{ entry.name }}</span>
                <i
                  v-if="misStore.isSkillInstalled(entry)"
                  class="ti ti-circle-check-filled"
                  :class="$style.installedMark"
                  title="インストール済"
                />
                <span :class="$style.spacer" />
                <span :class="$style.version">v{{ entry.version }}</span>
              </div>
              <div :class="$style.row2">
                {{ entry.description || 'No description' }}
              </div>
              <div :class="$style.row3">
                <span v-if="entry.author" :class="$style.author">{{ entry.author }}</span>
                <span :class="$style.category">{{ skillCategoryLabel(entry.category) }}</span>
                <span :class="$style.spacer" />
                <div :class="$style.actions">
                  <button
                    class="_button"
                    :class="$style.iconBtn"
                    title="MisStore で詳細を開く"
                    @click.stop="handleOpenStoreDetail(entry)"
                  >
                    <i class="ti ti-external-link" />
                  </button>
                  <button
                    v-if="misStore.isSkillInstalled(entry)"
                    class="_button"
                    :class="$style.installedBadge"
                    disabled
                  >
                    インストール済み
                  </button>
                  <button
                    v-else
                    class="_button"
                    :class="$style.primaryBtn"
                    :disabled="misStore.installingSkill === entry.id"
                    @click.stop="handleStoreInstall(entry)"
                  >
                    <i v-if="misStore.installingSkill === entry.id" class="ti ti-loader-2 nd-spin" />
                    <i v-else class="ti ti-download" />
                    {{ misStore.installingSkill === entry.id ? '...' : 'インストール' }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="filteredStoreSkills.length === 0" :class="$style.empty">
            <i class="ti ti-sparkles" :class="$style.emptyIcon" />
            <span v-if="storeQuery">一致するスキルがありません</span>
            <span v-else>ストアに登録済みのスキルはありません</span>
          </div>
        </div>
      </template>
    </div>
  </DeckColumn>
</template>

<style module lang="scss">
@use './column-common.module.scss';

.headerIcon {
  font-size: 1em;
}

.headerBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.6;
  transition: background 0.1s, opacity 0.1s;

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}

.wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.searchWrap {
  display: flex;
  padding: 6px 10px 4px;
}

.searchInput {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--nd-divider);
  border-radius: 2px;
  background: var(--nd-inputBg, var(--nd-bg));
  color: var(--nd-fg);
  font-size: 12px;

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.4;
  }

  &:focus {
    outline: none;
    border-color: var(--nd-accent);
  }
}

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.card {
  position: relative;
  display: flex;
  gap: 12px;
  padding: 12px 14px 12px 16px;
  cursor: pointer;
  transition: background 0.1s;

  &:hover {
    background: var(--nd-buttonHoverBg);

    .accentBar {
      opacity: 1;
    }
  }

  & + & {
    border-top: 1px solid color-mix(in srgb, var(--nd-divider) 50%, transparent);
  }
}

.cardDisabled {
  opacity: 0.6;
}

.accentBar {
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 0;
  width: 2px;
  background: var(--nd-accent);
  border-radius: 0 2px 2px 0;
  opacity: 0;
  transition: opacity 0.1s;
}

.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  color: var(--nd-accent);
  font-size: 32px;
}

.iconImg {
  width: 1em;
  height: 1em;
  background-color: currentColor;
  -webkit-mask: var(--icon-url) center / contain no-repeat;
  mask: var(--icon-url) center / contain no-repeat;
}

.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row1 {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.name {
  font-size: 13px;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex-shrink: 1;
}

.modeBadge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  font-size: 9px;
  padding: 0 5px;
  line-height: 14px;
  height: 14px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--nd-fg) 12%, transparent);
  color: var(--nd-fg);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.7;

  i {
    font-size: 10px;
  }

  &[data-mode='always'] {
    background: color-mix(in srgb, var(--nd-accent) 22%, transparent);
    color: var(--nd-accent);
    opacity: 1;
  }

  // HEARTBEAT mode は accent (heartbeat pink) で強調
  &[data-mode='heartbeat'] {
    background: color-mix(in srgb, var(--nd-accent, #f06292) 22%, transparent);
    color: var(--nd-accent, #f06292);
    opacity: 1;
  }
}

.disabledBadge {
  flex-shrink: 0;
  padding: 0 5px;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  height: 14px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--nd-fg) 15%, transparent);
  color: var(--nd-fg);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.75;
}

.installedMark {
  flex-shrink: 0;
  color: var(--nd-accent);
  font-size: 14px;
}

.version {
  font-size: 11px;
  color: var(--nd-fg);
  opacity: 0.45;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.row2 {
  font-size: 12px;
  color: var(--nd-fg);
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.4;
  margin-top: 1px;
}

.row3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  min-width: 0;
  min-height: 20px;
}

.author {
  font-size: 11px;
  color: var(--nd-fg);
  opacity: 0.55;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
  min-width: 0;
}

.category {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--nd-fg) 8%, transparent);
  color: var(--nd-fg);
  opacity: 0.6;
  flex-shrink: 0;
  line-height: 1.3;
}

.spacer {
  flex: 1;
  min-width: 4px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;

  .card:hover & {
    opacity: 1;
  }

  @media (hover: none) {
    opacity: 1;
  }
}

.iconBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 3px;
  color: var(--nd-fg);
  font-size: 13px;
  opacity: 0.7;
  transition: background 0.1s, opacity 0.1s;

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

// HEARTBEAT 対象として toggle ON のとき、iconBtn を accent カラーで強調。
// 非ホバー時も常時表示する (= hover で消える .actions の opacity を打ち消し)
.heartbeatActive {
  color: var(--nd-accent, #f06292);
  opacity: 1 !important;
  background: color-mix(in srgb, var(--nd-accent, #f06292) 12%, transparent);
}

.primaryBtn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  height: 22px;
  font-size: 11px;
  font-weight: 600;
  border-radius: var(--nd-radius-full);
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent);
  transition: filter 0.1s, opacity 0.1s;

  &:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  &:disabled {
    opacity: 0.5;
  }
}

.secondaryBtn {
  background: transparent;
  border: 1px solid var(--nd-divider);
  color: var(--nd-fg);

  &:hover:not(:disabled) {
    filter: none;
    background: var(--nd-buttonHoverBg);
  }
}

.btnLocked {
  opacity: 0.5;
  cursor: default;
}

.installedBadge {
  flex-shrink: 0;
  padding: 2px 8px;
  height: 22px;
  display: flex;
  align-items: center;
  font-size: 10px;
  border-radius: 2px;
  border: 1px solid var(--nd-divider);
  color: var(--nd-fg);
  opacity: 0.6;
  cursor: default;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 40px 20px;
  color: var(--nd-fg);
  opacity: 0.5;
  font-size: 13px;
  text-align: center;
}

.emptyIcon {
  font-size: 36px;
  opacity: 0.3;
}

.emptyHint {
  font-size: 11px;
  opacity: 0.7;
}

.emptyLink {
  color: var(--nd-accent);
  font-size: 12px;
  margin-top: 4px;
  opacity: 0.8;

  &:hover {
    opacity: 1;
    text-decoration: underline;
  }
}

.storeError {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin: 6px 10px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--nd-love) 10%, transparent);
  color: var(--nd-love);
  font-size: 12px;
  flex-shrink: 0;
}

.storeErrorClose {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  opacity: 0.6;
  font-size: 12px;

  &:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--nd-love) 15%, transparent);
  }
}
</style>
