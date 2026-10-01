<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { WorkspaceFile } from '@/bindings'
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

// --- 人格 (SOUL): textarea。入力は debounce、blur で即保存 ---

const SOUL_SAVE_DELAY_MS = 800
const soulDraft = ref('')
let soulDirty = false
let soulTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => soul.value?.body,
  (body) => {
    if (!soulDirty) soulDraft.value = body ?? ''
  },
  { immediate: true },
)

function onSoulInput(): void {
  soulDirty = true
  if (soulTimer) clearTimeout(soulTimer)
  soulTimer = setTimeout(() => void flushSoul(), SOUL_SAVE_DELAY_MS)
}

async function flushSoul(): Promise<void> {
  if (soulTimer) {
    clearTimeout(soulTimer)
    soulTimer = null
  }
  if (!soulDirty) return
  const body = soulDraft.value
  try {
    await workspace.write('soul', body)
    // 保存中に打たれた分があれば dirty のまま次の保存に回す
    if (soulDraft.value === body) soulDirty = false
  } catch (e) {
    failed(e)
  }
}

onBeforeUnmount(() => void flushSoul())

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
    <!-- 人格: SOUL の本文 + キャラクター 1 行 -->
    <div :class="$style.card">
      <div :class="$style.cardHeader">
        <span :class="$style.cardTitle">{{ i18n.ts._aiPersonalitySection.soul }}</span>
      </div>
      <textarea
        v-model="soulDraft"
        :class="$style.textarea"
        rows="6"
        spellcheck="false"
        :placeholder="i18n.ts._aiPersonalitySection.soulPlaceholder"
        :disabled="!soul"
        @input="onSoulInput"
        @blur="flushSoul"
      />
      <p v-if="isFull(soul)" :class="$style.note">{{ i18n.ts._aiPersonalitySection.full }}</p>
      <p v-if="soul?.externallyChanged" :class="$style.note">{{ i18n.ts._aiPersonalitySection.externallyChanged }}</p>

      <div :class="$style.characterRow">
        <span :class="$style.fieldLabel">{{ i18n.ts._aiPersonalitySection.character }}</span>
        <div :class="$style.grid">
          <button
            class="_button"
            :class="[$style.characterCard, { [$style.characterCardActive]: !config.personaSkillId }]"
            :aria-pressed="!config.personaSkillId"
            @click="config.personaSkillId = ''"
          >
            <i class="ti ti-user-off" :class="$style.logoFallback" />
            <span>{{ i18n.ts._aiPersonalitySection.characterNone }}</span>
          </button>
          <button
            v-for="s in personaCandidates"
            :key="s.id"
            class="_button"
            :class="[$style.characterCard, { [$style.characterCardActive]: config.personaSkillId === s.id }]"
            :aria-pressed="config.personaSkillId === s.id"
            :title="s.description || s.name"
            @click="config.personaSkillId = s.id"
          >
            <!-- SVG icon を accent 色で render (DeckAiColumn.personaIndicator と同じ
                 mask + currentColor パターン) -->
            <span
              v-if="isProxiable(s.iconUrl)"
              :class="$style.logo"
              :style="{ '--icon-url': proxyCssUrl(s.iconUrl, 48) }"
              aria-hidden="true"
            />
            <i v-else class="ti ti-user-circle" :class="$style.logoFallback" />
            <span>{{ s.name }}</span>
          </button>
        </div>
      </div>
      <p :class="$style.hint">
        <i class="ti ti-info-circle" />
        {{ personaCandidates.length === 0 ? i18n.ts._aiPersonalitySection.noCharacters : i18n.ts._aiPersonalitySection.characterHint }}
      </p>
    </div>

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

.textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: var(--nd-radius-sm);
  border: 1px solid var(--nd-divider);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.85em;
  line-height: 1.5;
  resize: vertical;
  font-family: inherit;
  outline: none;

  &:focus {
    border-color: var(--nd-accent);
  }
}

// --- キャラクター: 旧ペルソナのカードグリッドをコンパクトにした 1 行 ---

.characterRow {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

// `_button` と特異度が同点だと WebView2 で display: inline-block に負けるため (0,2,0) に上げる
.characterCard.characterCard {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 0.8em;
  cursor: pointer;
  text-align: left;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
}

.characterCardActive.characterCardActive {
  background: color-mix(in srgb, var(--nd-accent) 12%, var(--nd-buttonBg));
  box-shadow: inset 0 0 0 1px var(--nd-accent);
}

// SVG mask + currentColor でテーマアクセント色化 (DeckAiColumn.personaIndicator
// と同じパターン)。ラスタ画像は表示できないが、persona icon は SVG 前提。
.logo {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  background-color: currentColor;
  color: var(--nd-accent);
  -webkit-mask: var(--icon-url) center / contain no-repeat;
  mask: var(--icon-url) center / contain no-repeat;
}

.logoFallback {
  font-size: 16px;
  color: var(--nd-fgMuted);
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
