<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import CodeDiffView from '@/components/common/CodeDiffView.vue'
import SystemIcon from '@/components/common/SystemIcon.vue'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { type ConfirmIcon, useConfirm } from '@/stores/confirm'
import { highlightCode, highlighterLoaded } from '@/utils/highlight'

const INSTALL_PREVIEW_ICON = {
  plugin: 'ti-puzzle',
  widget: 'ti-layout-grid-add',
  theme: 'ti-palette',
  skill: 'ti-book',
} as const

const { visible: show, options, resolve } = useConfirm()

const iconType = computed<Exclude<ConfirmIcon, 'none'> | null>(() => {
  if (options.value.icon === 'none') return null
  if (options.value.icon) return options.value.icon
  switch (options.value.type) {
    case 'danger':
    case 'warning':
      return 'warn'
    case 'info':
      return 'info'
    case 'success':
      return 'success'
    case 'error':
      return 'error'
    case 'question':
      return 'question'
    case 'waiting':
      return 'waiting'
    default:
      return null
  }
})

const { visible, entering, leaving } = useVaporTransition(show, {
  enterDuration: 200,
  leaveDuration: 200,
})

const dialogRef = ref<HTMLDialogElement | null>(null)

// `rememberLabel` 付きダイアログのチェックボックス状態。ダイアログを開くたび
// (新しい options がセットされるたび) に false へリセットする。
const remember = ref(false)
watch(show, (v) => {
  if (v) remember.value = false
})

function accept() {
  resolve({ accepted: true, remember: remember.value })
}
function cancel() {
  resolve({ accepted: false, remember: false })
}
function resolveAction(value: string) {
  resolve({ accepted: true, remember: false, action: value })
}

useNativeDialog(dialogRef, visible, {
  get initialFocus() {
    return options.value.type === 'danger'
      ? '._button:first-child'
      : '._button:last-child'
  },
  onCancel: cancel,
  leaveDuration: 200,
})
</script>

<template>
    <dialog
      v-if="visible"
      ref="dialogRef"
      class="_nativeDialog"
      :class="[entering && $style.enter, leaving && $style.leave]"
    >
      <div
        class="_dialog nd-popup-content"
        :class="[entering && $style.contentEnter, leaving && $style.contentLeave]"
      >
        <div :class="$style.header">
          <div v-if="options.trusted" :class="$style.trusted">
            <i class="ti ti-shield-lock" />
            <span>NoteDeck の権限確認</span>
          </div>
          <div v-if="iconType" :class="$style.icon">
            <SystemIcon :type="iconType" />
          </div>
          <div v-if="options.attribution" :class="$style.attribution">
            {{ options.attribution }}
          </div>
          <div :class="$style.title">{{ options.title }}</div>
        </div>
        <div :class="$style.body">
          <p v-if="options.message" :class="$style.message">{{ options.message }}</p>
          <div v-if="options.installPreview" :class="$style.installPreview">
            <div :class="$style.installIcon">
              <i :class="['ti', INSTALL_PREVIEW_ICON[options.installPreview.kind]]" />
            </div>
            <div :class="$style.installBody">
              <div :class="$style.installRow1">
                <span :class="$style.installName">{{ options.installPreview.name }}</span>
                <span v-if="options.installPreview.version" :class="$style.installVersion">v{{ options.installPreview.version }}</span>
              </div>
              <div v-if="options.installPreview.author" :class="$style.installAuthor">
                {{ options.installPreview.author }}
              </div>
              <div v-if="options.installPreview.description" :class="$style.installDesc">
                {{ options.installPreview.description }}
              </div>
              <div v-if="options.installPreview.permissions?.length" :class="$style.installPerms">
                <span
                  v-for="p in options.installPreview.permissions"
                  :key="p"
                  :class="$style.installPermChip"
                >{{ p }}</span>
              </div>
            </div>
          </div>
          <!-- diff 指定時はコードブロックの代わりに全文 diff を描画 (#981)。
               code と併用時は diff 優先 -->
          <div v-if="options.diff" :class="$style.diffBlock">
            <CodeDiffView
              :old-text="options.diff.old"
              :new-text="options.diff.new"
              :language="options.diff.language ?? 'text'"
            />
          </div>
          <div
            v-else-if="options.code"
            :key="`code-${highlighterLoaded}`"
            :class="$style.codeBlock"
            v-html="highlightCode(options.code, options.codeLanguage ?? 'json')"
          />
        </div>
        <label v-if="options.rememberLabel" :class="$style.remember">
          <input v-model="remember" type="checkbox" />
          <span>{{ options.rememberLabel }}</span>
        </label>
        <div :class="$style.actions">
          <template v-if="options.actions">
            <button
              v-for="action in options.actions"
              :key="action.value"
              class="_button"
              :class="action.primary ? (options.type === 'danger' ? $style.btnDanger : $style.btnOk) : $style.btnCancel"
              @click="action.cancel ? cancel() : resolveAction(action.value)"
            >
              {{ action.label }}
            </button>
          </template>
          <template v-else>
            <button v-if="!options.hideCancel" class="_button" :class="$style.btnCancel" @click="cancel">
              {{ options.cancelLabel || 'キャンセル' }}
            </button>
            <button
              class="_button"
              :class="options.type === 'danger' ? $style.btnDanger : $style.btnOk"
              @click="accept"
            >
              {{ options.okLabel || 'OK' }}
            </button>
          </template>
        </div>
      </div>
    </dialog>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;
@use '@/styles/popup';

.header {
  padding: 20px 20px 4px;
  text-align: center;
}

// 信頼マーカー (#720): NoteDeck 本体の権限確認であることを示す。プラグインの
// Mk:confirm はこのバッジを出せないので、システム確認となりすませない。
.trusted {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 10px;
  padding: 2px 10px;
  border-radius: var(--nd-radius-full);
  font-size: 0.72em;
  font-weight: bold;
  color: var(--nd-accent);
  background: color-mix(in srgb, var(--nd-accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--nd-accent) 35%, transparent);

  i {
    font-size: 1.15em;
    line-height: 1;
  }
}

.icon {
  display: flex;
  justify-content: center;
  margin-bottom: 8px;

  svg {
    width: 40px;
    height: 40px;
  }
}

.title {
  font-size: 1em;
  font-weight: bold;
  color: var(--nd-fg);
}

// 帰属表示 (#712): 誰の操作要求かをタイトルより先に示す
.attribution {
  margin-bottom: 8px;
  font-size: 0.8em;
  font-weight: bold;
  color: var(--nd-accent);
}

.body {
  padding: 4px 20px 12px;
  text-align: center;
  // 長文 message (e.g. AI capability の params JSON) で
  // ダイアログが viewport を超えないようスクロール可能にする
  max-height: 60vh;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.message {
  margin: 0;
  color: var(--nd-fg);
  font-size: 0.85em;
  line-height: 1.5;
  opacity: 0.8;
  white-space: pre-wrap;
  word-break: break-word;
}

// install preview — plugin / widget のインストール確認時に MisStore カード風の
// 構造化レイアウトを表示する。タイトルは中央寄せだが、ここは情報密度のため
// 左寄せでまとめる。
.installPreview {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-top: 8px;
  padding: 12px;
  text-align: left;
  background: color-mix(in srgb, var(--nd-fg) 4%, transparent);
  border: 1px solid color-mix(in srgb, var(--nd-divider) 60%, transparent);
  border-radius: 8px;
}

.installIcon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  color: var(--nd-accent);
  font-size: 24px;
}

.installBody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.installRow1 {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.installName {
  font-size: 13px;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.installVersion {
  font-size: 11px;
  color: var(--nd-fg);
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
}

.installAuthor {
  font-size: 11px;
  color: var(--nd-fg);
  opacity: 0.6;
}

.installDesc {
  font-size: 12px;
  color: var(--nd-fg);
  opacity: 0.8;
  line-height: 1.4;
  margin-top: 2px;
  white-space: pre-wrap;
  word-break: break-word;
}

.installPerms {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.installPermChip {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--nd-accent) 14%, transparent);
  color: var(--nd-fg);
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
}

// diff block — 適用前の全文 diff (#981)。ダイアログ内は最大高さを制限して
// diff 側に内部スクロールを持たせる。
.diffBlock {
  margin-top: 8px;
  text-align: left;
  font-size: 0.85em;

  > [data-nd-code-diff] {
    max-height: 40vh;
  }
}

// code block — capability の引数 JSON / コード片用。タイトルは中央寄せだが
// コードは左寄せで読みやすく。
.codeBlock {
  margin-top: 8px;
  text-align: left;
  font-size: 0.78em;
  line-height: 1.5;
  border-radius: 6px;
  overflow: hidden;

  :global(pre) {
    margin: 0;
    padding: 10px 12px;
    background: var(--nd-codeBg, var(--nd-panelHighlight));
    overflow-x: auto;
    scrollbar-width: thin;
  }

  :global(code) {
    font-family: var(--nd-font-mono);
    white-space: pre;
    word-break: normal;
  }
}

// rememberLabel 付きダイアログのチェックボックス行。body と actions の間に
// 置き、ダイアログ本体に合わせて中央揃えにする。
.remember {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 20px 4px;
  font-size: 0.82em;
  color: var(--nd-fg);
  opacity: 0.85;
  cursor: pointer;

  input {
    flex-shrink: 0;
    cursor: pointer;
  }
}

.actions {
  display: flex;
  gap: 6px;
  padding: 8px 16px 16px;
  justify-content: center;
}

.btnCancel { @include btn-secondary; }
.btnOk { @include btn-primary; }
.btnDanger { @include btn-danger; }

</style>
