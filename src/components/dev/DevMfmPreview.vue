<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import FormInput from '@/components/common/form/FormInput.vue'
import FormSwitchRow from '@/components/common/form/FormSwitchRow.vue'
import MfmPlayground from '@/components/common/MfmPlayground.vue'
import { MFM_PLAYGROUND_SAMPLES } from '@/components/common/mfmPlaygroundSamples'
import { i18n } from '@/i18n'
import { useSettingsStore } from '@/stores/settings'

/**
 * Dev Dashboard (#977) の MFM プレビュー。共通部品 MfmPlayground に、ダッシュボード
 * だけの面を足す: アプリの設定 (高度な MFM / 動きのある MFM) の切り替え、サーバーの
 * /api/emojis からの絵文字、実行中アプリの HTTP API からの実ノートの読み込み。
 * ブラウザ (5173) で開くので emoji store は空で、絵文字はここで取った辞書で解決する。
 */

const settingsStore = useSettingsStore()
const text = ref(MFM_PLAYGROUND_SAMPLES[0]?.text ?? '')
const advanced = computed(() => settingsStore.get('mfm.advanced') !== false)
const animated = computed(() => settingsStore.get('mfm.animated') !== false)
const me = ref('')

// --- 絵文字 (サーバーの /api/emojis を直接引く。ブラウザからでも CORS で読める) ---
const host = ref('misskey.io')
const emojis = shallowRef<Record<string, string>>({})
const emojiStatus = ref('')
const emojiBusy = ref(false)
async function fetchEmojis() {
  const h = host.value
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
  if (!h) return
  emojiBusy.value = true
  emojiStatus.value = ''
  try {
    const res = await fetch(`https://${h}/api/emojis`, { method: 'POST' })
    if (!res.ok) throw new Error(String(res.status))
    const body = (await res.json()) as {
      emojis?: { name: string; url: string }[]
    }
    const map: Record<string, string> = {}
    for (const e of body.emojis ?? []) map[e.name] = e.url
    emojis.value = map
    host.value = h
    emojiStatus.value = i18n.tsx._devMfm.emojisLoaded({
      count: Object.keys(map).length,
    })
  } catch (e) {
    emojiStatus.value = `${i18n.ts._devMfm.emojisFailed}: ${String(e)}`
  } finally {
    emojiBusy.value = false
  }
}

// --- 実ノートの読み込み (実行中アプリの内蔵 HTTP サーバー経由) ---
const noteRef = ref('')
const noteStatus = ref('')
const noteBusy = ref(false)
async function loadNote() {
  const m = noteRef.value
    .trim()
    .match(/^(?:https?:\/\/)?([^/\s]+)\/notes\/([A-Za-z0-9]+)/)
  if (!m) {
    noteStatus.value = i18n.ts._devMfm.noteRefInvalid
    return
  }
  const [, h, id] = m
  noteBusy.value = true
  noteStatus.value = ''
  try {
    const res = await fetch(
      `/api/${encodeURIComponent(h ?? '')}/notes/${encodeURIComponent(id ?? '')}`,
    )
    if (!res.ok) throw new Error(String(res.status))
    const note = (await res.json()) as {
      text?: string | null
      cw?: string | null
      emojis?: Record<string, string>
      _serverHost?: string
    }
    text.value = note.text ?? note.cw ?? ''
    if (note._serverHost) host.value = note._serverHost
    emojis.value = { ...emojis.value, ...(note.emojis ?? {}) }
    noteStatus.value = i18n.ts._devMfm.noteLoaded
  } catch (e) {
    noteStatus.value = `${i18n.ts._devMfm.noteLoadFailed}: ${String(e)}`
  } finally {
    noteBusy.value = false
  }
}
</script>

<template>
  <MfmPlayground v-model="text" :emojis="emojis" :server-host="host" :my-username="me || undefined">
    <template #settings>
      <div :class="$style.group">
        <p :class="$style.groupTitle">{{ i18n.ts._devMfm.appSettings }}</p>
        <FormSwitchRow
          :label="i18n.ts._appearanceEditorContent.advancedMfm"
          :on="advanced"
          @toggle="settingsStore.set('mfm.advanced', !advanced)"
        />
        <FormSwitchRow
          :label="i18n.ts._appearanceEditorContent.animatedMfm"
          :on="animated"
          :disabled="!advanced"
          @toggle="settingsStore.set('mfm.animated', !animated)"
        />
      </div>

      <div :class="$style.group">
        <p :class="$style.groupTitle">{{ i18n.ts._devMfm.server }}</p>
        <label :class="$style.field">
          <span>{{ i18n.ts._devMfm.host }}</span>
          <FormInput v-model="host" placeholder="misskey.io" />
        </label>
        <div :class="$style.actionRow">
          <button type="button" :class="$style.btn" :disabled="emojiBusy" @click="fetchEmojis">
            <i class="ti ti-mood-smile" /> {{ i18n.ts._devMfm.fetchEmojis }}
          </button>
          <span :class="$style.status">{{ emojiStatus }}</span>
        </div>
        <label :class="$style.field">
          <span>{{ i18n.ts._devMfm.me }}</span>
          <FormInput v-model="me" placeholder="username" />
        </label>
      </div>

      <div :class="$style.group">
        <p :class="$style.groupTitle">{{ i18n.ts._devMfm.loadNote }}</p>
        <p :class="$style.groupDesc">{{ i18n.ts._devMfm.loadNoteDesc }}</p>
        <FormInput v-model="noteRef" placeholder="https://misskey.io/notes/xxxx" @keydown.enter="loadNote" />
        <div :class="$style.actionRow">
          <button type="button" :class="$style.btn" :disabled="noteBusy" @click="loadNote">
            <i class="ti ti-download" /> {{ i18n.ts._devMfm.loadNote }}
          </button>
          <span :class="$style.status">{{ noteStatus }}</span>
        </div>
      </div>
    </template>
  </MfmPlayground>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

/* 共通部品の設定欄 (.group) と同じ見た目。slot の中身は親のスコープで描かれるので
   ここに持つ */
.group {
  padding: 8px 12px;
  border-top: 1px solid var(--nd-divider);
}

.groupTitle {
  margin: 0 0 6px;
  font-size: var(--nd-font-xs);
  font-weight: var(--nd-weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
}

.groupDesc {
  margin: 0 0 8px;
  font-size: var(--nd-font-xs);
  opacity: 0.7;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  font-size: var(--nd-font-sm);

  > span {
    flex: none;
  }

  > :last-child {
    width: 150px;
  }
}

.actionRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}

.btn {
  @include btn-secondary;
  flex: none;
  padding: 4px 10px;
  font-size: var(--nd-font-sm);
}

.status {
  font-size: var(--nd-font-xs);
  opacity: 0.7;
  overflow-wrap: anywhere;
}
</style>
