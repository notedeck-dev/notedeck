<script setup lang="ts">
import { computed, ref } from 'vue'
import type { WorkspaceFile } from '@/bindings'
import ChoiceCard from '@/components/common/ChoiceCard.vue'
import ChoiceCardGrid from '@/components/common/ChoiceCardGrid.vue'
import { useAiConfig } from '@/composables/useAiConfig'
import { useAiWorkspace } from '@/composables/useAiWorkspace'
import { i18n } from '@/i18n'
import type { EditableWorkspaceKind } from '@/services/aiWorkspaceEdit'
import { useConfirm } from '@/stores/confirm'
import { useSkillsStore } from '@/stores/skills'
import { useToast } from '@/stores/toast'
import { extractErrorMessage } from '@/utils/errors'
import { isProxiable, proxyCssUrl } from '@/utils/mediaProxy'
import AiSettingsSection from './AiSettingsSection.vue'
import AiSwitchRow from './AiSwitchRow.vue'

// 人格と記憶 (#1162): ファイルは SOUL / USER / MEMORY の 3 つだが、面は
// 「人格」(SOUL + キャラクター) / 「あなたについて」(USER) / 「覚え書き」(MEMORY)。
// ファイル名は UI に出さない。正本と書込は notemaid で、ここは写しの編集だけ。

const { config } = useAiConfig()
const workspace = useAiWorkspace()
const { confirm } = useConfirm()

const soul = computed(() => workspace.fileOf('soul'))
const user = computed(() => workspace.fileOf('user'))
const memory = computed(() => workspace.fileOf('memory'))

function failed(e: unknown): void {
  useToast().show(
    i18n.tsx._aiPersonalitySection.saveFailed({
      message: extractErrorMessage(e),
    }),
    'error',
  )
}

// --- 人格 (SOUL): ここでは編まない (#1186) ---
// markdown を設定画面の textarea で直接触らせると見出しの構造を壊しやすいので、
// 本文の編集は開発者モードの SOUL.md タブ (生ファイルのコード編集) か外部エディタ。
// ここは状態 (いっぱい / 外で変更) の表示だけ

// --- キャラクター (persona skill) ---

const skillsStore = useSkillsStore()
skillsStore.ensureLoaded()
const personaCandidates = computed(() =>
  skillsStore.skills.filter((s) => s.isPersona),
)
const currentPersonaSkill = computed(() => {
  const id = config.value.personaSkillId
  if (!id) return null
  const s = skillsStore.get(id)
  return s?.isPersona ? s : null
})

// --- 項目の行 (USER / MEMORY): クリックで inline 編集、Enter / blur で保存 ---

const editing = ref<{ kind: EditableWorkspaceKind; text: string } | null>(null)
const editDraft = ref('')
let focusedInput: Element | null = null

function isEditing(kind: EditableWorkspaceKind, text: string): boolean {
  return editing.value?.kind === kind && editing.value.text === text
}

function startEdit(kind: EditableWorkspaceKind, text: string): void {
  editing.value = { kind, text }
  editDraft.value = text
}

/** v-for の中の input は 1 つだけ現れるので、現れたときに focus する */
function focusOnMount(el: unknown): void {
  if (!(el instanceof HTMLInputElement) || el === focusedInput) return
  focusedInput = el
  el.focus()
  el.select()
}

function cancelEdit(): void {
  editing.value = null
}

async function commitEdit(): Promise<void> {
  const cur = editing.value
  if (!cur) return
  editing.value = null
  const next = editDraft.value.trim()
  if (next === cur.text) return
  try {
    await workspace.replaceEntry(cur.kind, cur.text, next)
  } catch (e) {
    failed(e)
  }
}

async function removeEntry(
  kind: EditableWorkspaceKind,
  text: string,
): Promise<void> {
  try {
    await workspace.removeEntry(kind, text)
  } catch (e) {
    failed(e)
  }
}

async function forgetAll(kind: EditableWorkspaceKind): Promise<void> {
  const ok = await confirm({
    title: i18n.ts._aiPersonalitySection.forgetAll,
    message:
      kind === 'user'
        ? i18n.ts._aiPersonalitySection.forgetAllUserConfirm
        : i18n.ts._aiPersonalitySection.forgetAllMemoryConfirm,
    okLabel: i18n.ts._aiPersonalitySection.forgetAll,
    type: 'danger',
  })
  if (!ok) return
  try {
    await workspace.forgetAll(kind)
  } catch (e) {
    failed(e)
  }
}

// --- あなたのことを覚える ---

async function toggleUserMemory(): Promise<void> {
  try {
    await workspace.setUserMemory(!config.value.userMemory)
  } catch (e) {
    failed(e)
  }
}

// 使用率バーは出さず、上限に近いときだけ 1 行 (設計 v4)
const FULL_RATIO = 0.9
function isFull(f: WorkspaceFile | undefined): boolean {
  return !!f && f.usage.limit > 0 && f.usage.chars / f.usage.limit >= FULL_RATIO
}
</script>

<template>
  <AiSettingsSection
    icon="ti-heart"
    :title="i18n.ts._aiPersonalitySection.title"
    :badge="currentPersonaSkill ? currentPersonaSkill.name : i18n.ts._aiPersonalitySection.characterNone"
  >
    <!-- 人格: SOUL の状態 + キャラクター -->
    <div :class="$style.card">
      <div :class="$style.cardHeader">
        <span :class="$style.cardTitle">{{ i18n.ts._aiPersonalitySection.soul }}</span>
      </div>
      <p :class="$style.hint">
        <i class="ti ti-info-circle" />
        {{ i18n.ts._aiPersonalitySection.soulHint }}
      </p>
      <p v-if="isFull(soul)" :class="$style.note">{{ i18n.ts._aiPersonalitySection.full }}</p>
      <p v-if="soul?.externallyChanged" :class="$style.note">{{ i18n.ts._aiPersonalitySection.externallyChanged }}</p>

      <div :class="$style.characterRow">
        <span :class="$style.fieldLabel">{{ i18n.ts._aiPersonalitySection.character }}</span>
        <ChoiceCardGrid>
          <ChoiceCard
            icon="user-off"
            :label="i18n.ts._aiPersonalitySection.characterNone"
            :active="!config.personaSkillId"
            @click="config.personaSkillId = ''"
          />
          <ChoiceCard
            v-for="s in personaCandidates"
            :key="s.id"
            :label="s.name"
            :active="config.personaSkillId === s.id"
            :title="s.description || s.name"
            :icon-mask-css="isProxiable(s.iconUrl) ? proxyCssUrl(s.iconUrl, 48) : null"
            icon="user-circle"
            @click="config.personaSkillId = s.id"
          />
        </ChoiceCardGrid>
      </div>
      <p :class="$style.hint">
        <i class="ti ti-info-circle" />
        {{ personaCandidates.length === 0 ? i18n.ts._aiPersonalitySection.noCharacters : i18n.ts._aiPersonalitySection.characterHint }}
      </p>
    </div>

  </AiSettingsSection>

  <AiSettingsSection icon="ti-brain" :title="i18n.ts._aiPersonalitySection.memorySectionTitle">
    <!-- あなたについて覚えていること (USER) -->
    <div :class="$style.card">
      <div :class="$style.cardHeader">
        <span :class="$style.cardTitle">{{ i18n.ts._aiPersonalitySection.userTitle }}</span>
      </div>
      <AiSwitchRow
        :label="i18n.ts._aiPersonalitySection.userToggle"
        :on="config.userMemory"
        @toggle="toggleUserMemory"
      />
      <!-- 手元の CLI (ACP) にも渡すか (既定は渡す、#1162)。記憶そのものが OFF なら意味が無いので無効 -->
      <AiSwitchRow
        :label="i18n.ts._aiPersonalitySection.harnessUserMemory"
        :on="config.userMemory && config.harnessUserMemory"
        :disabled="!config.userMemory"
        @toggle="config.harnessUserMemory = !config.harnessUserMemory"
      />
      <ul v-if="user && user.entries.length > 0" :class="[$style.entries, { [$style.entriesDimmed]: !config.userMemory }]">
        <li v-for="entry in user.entries" :key="entry" :class="$style.entry">
          <input
            v-if="isEditing('user', entry)"
            :ref="focusOnMount"
            v-model="editDraft"
            :class="$style.entryInput"
            type="text"
            @keydown.enter.prevent="commitEdit"
            @keydown.esc.prevent="cancelEdit"
            @blur="commitEdit"
          >
          <template v-else>
            <button class="_button" :class="$style.entryText" :title="i18n.ts._common.edit" @click="startEdit('user', entry)">{{ entry }}</button>
            <button class="_button" :class="$style.entryDelete" :title="i18n.ts._common.delete" @click="removeEntry('user', entry)">
              <i class="ti ti-x" />
            </button>
          </template>
        </li>
      </ul>
      <p v-else :class="$style.empty">{{ i18n.ts._aiPersonalitySection.empty }}</p>
      <p v-if="!config.userMemory" :class="$style.note">{{ i18n.ts._aiPersonalitySection.userOffNote }}</p>
      <p :class="$style.hint">
        <i class="ti ti-info-circle" />
        {{ i18n.ts._aiPersonalitySection.sentNote }}
      </p>
      <p v-if="isFull(user)" :class="$style.note">{{ i18n.ts._aiPersonalitySection.full }}</p>
      <p v-if="user?.externallyChanged" :class="$style.note">{{ i18n.ts._aiPersonalitySection.externallyChanged }}</p>
      <div :class="$style.cardFooter">
        <button
          class="_button"
          :class="$style.forgetButton"
          :disabled="!user || user.entries.length === 0"
          @click="forgetAll('user')"
        >
          <i class="ti ti-eraser" />
          {{ i18n.ts._aiPersonalitySection.forgetAll }}
        </button>
      </div>
    </div>

    <!-- 覚え書き (MEMORY) -->
    <div :class="$style.card">
      <div :class="$style.cardHeader">
        <span :class="$style.cardTitle">{{ i18n.ts._aiPersonalitySection.memoryTitle }}</span>
      </div>
      <ul v-if="memory && memory.entries.length > 0" :class="$style.entries">
        <li v-for="entry in memory.entries" :key="entry" :class="$style.entry">
          <input
            v-if="isEditing('memory', entry)"
            :ref="focusOnMount"
            v-model="editDraft"
            :class="$style.entryInput"
            type="text"
            @keydown.enter.prevent="commitEdit"
            @keydown.esc.prevent="cancelEdit"
            @blur="commitEdit"
          >
          <template v-else>
            <button class="_button" :class="$style.entryText" :title="i18n.ts._common.edit" @click="startEdit('memory', entry)">{{ entry }}</button>
            <button class="_button" :class="$style.entryDelete" :title="i18n.ts._common.delete" @click="removeEntry('memory', entry)">
              <i class="ti ti-x" />
            </button>
          </template>
        </li>
      </ul>
      <p v-else :class="$style.empty">{{ i18n.ts._aiPersonalitySection.empty }}</p>
      <p v-if="isFull(memory)" :class="$style.note">{{ i18n.ts._aiPersonalitySection.full }}</p>
      <p v-if="memory?.externallyChanged" :class="$style.note">{{ i18n.ts._aiPersonalitySection.externallyChanged }}</p>
      <div :class="$style.cardFooter">
        <button
          class="_button"
          :class="$style.forgetButton"
          :disabled="!memory || memory.entries.length === 0"
          @click="forgetAll('memory')"
        >
          <i class="ti ti-eraser" />
          {{ i18n.ts._aiPersonalitySection.forgetAll }}
        </button>
      </div>
    </div>
  </AiSettingsSection>
</template>

<style lang="scss" module>
@use '@/styles/settingsFields' as *;

.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-fg) 4%, transparent);
}

.cardHeader { @include field-header; }

.cardTitle {
  @include field-label;
  font-weight: bold;
}

.fieldLabel { @include field-label; }

.hint {
  @include key-hint;
  align-items: center;
}

// 上限 / 外部変更の 1 行。目立たせるが警告色までは使わない
.note {
  @include field-hint;
  opacity: 0.8;
}

// --- キャラクター: 旧ペルソナのカードグリッドをコンパクトにした 1 行 ---

.characterRow {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
}

// --- 項目の行 ---

.entries {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.entriesDimmed {
  opacity: 0.5;
}

.entry {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  border-radius: var(--nd-radius-sm);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  &:hover .entryDelete {
    opacity: 1;
  }
}

.entryText.entryText {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  font-size: 0.85em;
  line-height: 1.4;
  text-align: left;
  color: var(--nd-fg);
  cursor: text;
  white-space: pre-wrap;
  word-break: break-word;
}

.entryInput {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid var(--nd-accent);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.85em;
  font-family: inherit;
  outline: none;
}

.entryDelete.entryDelete {
  flex-shrink: 0;
  padding: 4px;
  font-size: 0.85em;
  color: var(--nd-fg);
  opacity: 0;
  cursor: pointer;
  transition: opacity var(--nd-duration-base);

  &:hover {
    color: var(--nd-error, #ec4137);
  }
}

.empty {
  @include field-hint;
  padding: 4px 6px;
}

.cardFooter {
  display: flex;
  justify-content: flex-end;
  padding-top: 2px;
}

.forgetButton.forgetButton {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--nd-radius-sm);
  font-size: 0.75em;
  color: var(--nd-fg);
  opacity: 0.7;
  cursor: pointer;

  &:hover:not(:disabled) {
    opacity: 1;
    color: var(--nd-error, #ec4137);
  }

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }
}
</style>
