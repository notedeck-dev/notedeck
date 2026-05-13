<script setup lang="ts">
import { computed, ref } from 'vue'

import SystemIcon from '@/components/common/SystemIcon.vue'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { type ConfirmIcon, useConfirm } from '@/stores/confirm'
import { highlightCode, highlighterLoaded } from '@/utils/highlight'

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

useNativeDialog(dialogRef, visible, {
  get initialFocus() {
    return options.value.type === 'danger'
      ? '._button:first-child'
      : '._button:last-child'
  },
  onCancel: () => resolve(false),
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
          <div v-if="iconType" :class="$style.icon">
            <SystemIcon :type="iconType" />
          </div>
          <div :class="$style.title">{{ options.title }}</div>
        </div>
        <div :class="$style.body">
          <p v-if="options.message" :class="$style.message">{{ options.message }}</p>
          <div v-if="options.installPreview" :class="$style.installPreview">
            <div :class="$style.installIcon">
              <i :class="['ti', options.installPreview.kind === 'widget' ? 'ti-layout-grid-add' : 'ti-puzzle']" />
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
          <div
            v-if="options.code"
            :key="`code-${highlighterLoaded}`"
            :class="$style.codeBlock"
            v-html="highlightCode(options.code, options.codeLanguage ?? 'json')"
          />
        </div>
        <div :class="$style.actions">
          <button v-if="!options.hideCancel" class="_button" :class="$style.btnCancel" @click="resolve(false)">
            {{ options.cancelLabel || 'キャンセル' }}
          </button>
          <button
            class="_button"
            :class="options.type === 'danger' ? $style.btnDanger : $style.btnOk"
            @click="resolve(true)"
          >
            {{ options.okLabel || 'OK' }}
          </button>
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
    font-family: var(
      --nd-mono,
      ui-monospace,
      "SF Mono",
      Menlo,
      Consolas,
      monospace
    );
    white-space: pre;
    word-break: normal;
  }
}

.actions {
  display: flex;
  gap: 6px;
  padding: 0 16px 16px;
  justify-content: center;
}

.btnCancel { @include btn-secondary; }
.btnOk { @include btn-primary; }
.btnDanger { @include btn-danger; }

</style>
