<script setup lang="ts">
import type { Interpreter } from '@syuilo/aiscript'
import type { Value, VFn } from '@syuilo/aiscript/interpreter/value.js'
import { type CSSProperties, computed } from 'vue'
import type { UiComponent } from '@/aiscript/ui'
import MkMfm from '@/components/common/MkMfm.vue'

export interface PostFormRequest {
  text?: string
  cw?: string
  visibility?: string
  localOnly?: boolean
}

const props = defineProps<{
  components: UiComponent[]
  interpreter: Interpreter | null
  serverUrl?: string
}>()

const emit = defineEmits<{
  post: [form: PostFormRequest]
}>()

const serverHost = computed(() => {
  if (!props.serverUrl) return ''
  try {
    return new URL(props.serverUrl).host
  } catch {
    return ''
  }
})

async function callHandler(
  handler: unknown,
  interpreter: Interpreter | null,
  arg?: Value,
) {
  if (!interpreter || !handler || typeof handler !== 'object') return
  const fn = handler as VFn
  if (fn.type !== 'fn') return
  try {
    await interpreter.execFn(fn, arg ? [arg] : [])
  } catch {
    // handler errors are silently ignored
  }
}

function containerAlignItems(align: string | undefined): string | undefined {
  switch (align) {
    case 'center':
      return 'center'
    case 'right':
      return 'flex-end'
    case 'left':
      return 'flex-start'
    default:
      return undefined
  }
}

function handlePostFormButton(comp: UiComponent) {
  const form = comp.props.form as Record<string, unknown> | undefined
  emit('post', {
    text: form?.text ? String(form.text) : undefined,
    cw: form?.cw ? String(form.cw) : undefined,
    visibility: form?.visibility ? String(form.visibility) : undefined,
    localOnly: !!form?.localOnly,
  })
}
</script>

<template>
  <div :class="$style.aisUiRenderer">
    <template v-for="comp in components" :key="comp.id">
      <!-- text / mfm (both rendered as MFM, matching Misskey behavior) -->
      <div v-if="comp.type === 'text' || comp.type === 'mfm'" :class="$style.aisMfm">
        <MkMfm :text="(comp.props.text as string) ?? ''" :server-host="serverHost" />
      </div>

      <!-- button -->
      <button
        v-else-if="comp.type === 'button'"
        :class="$style.aisButton"
        :disabled="!!comp.props.disabled"
        @click="callHandler(comp.props.onClick, interpreter)"
      >
        {{ comp.props.text ?? '' }}
      </button>

      <!-- textInput -->
      <input
        v-else-if="comp.type === 'textInput'"
        :class="$style.aisTextInput"
        type="text"
        :placeholder="(comp.props.placeholder as string) ?? ''"
        :value="(comp.props.default as string) ?? ''"
        @input="
          (e) => {
            const val = (e.target as HTMLInputElement).value
            callHandler(comp.props.onInput, interpreter, { type: 'str', value: val } as Value)
          }
        "
      />

      <!-- numberInput -->
      <input
        v-else-if="comp.type === 'numberInput'"
        :class="$style.aisNumberInput"
        type="number"
        :value="(comp.props.default as number) ?? 0"
        @input="
          (e) => {
            const val = Number((e.target as HTMLInputElement).value)
            callHandler(comp.props.onInput, interpreter, { type: 'num', value: val } as Value)
          }
        "
      />

      <!-- switch -->
      <label v-else-if="comp.type === 'switch'" :class="$style.aisSwitch">
        <input
          type="checkbox"
          :checked="!!comp.props.default"
          @change="
            (e) => {
              const val = (e.target as HTMLInputElement).checked
              callHandler(comp.props.onChange, interpreter, { type: 'bool', value: val } as Value)
            }
          "
        />
        {{ comp.props.label ?? '' }}
      </label>

      <!-- select -->
      <select
        v-else-if="comp.type === 'select'"
        :class="$style.aisSelect"
        :value="(comp.props.default as string) ?? ''"
        @change="
          (e) => {
            const val = (e.target as HTMLSelectElement).value
            callHandler(comp.props.onChange, interpreter, { type: 'str', value: val } as Value)
          }
        "
      >
        <option
          v-for="item in (comp.props.items as { text: string; value: string }[]) ?? []"
          :key="item.value"
          :value="item.value"
        >
          {{ item.text }}
        </option>
      </select>

      <!-- container -->
      <div
        v-else-if="comp.type === 'container'"
        :class="$style.aisContainer"
        :style="({
          textAlign: (comp.props.align as string) ?? undefined,
          alignItems: containerAlignItems(comp.props.align as string | undefined),
          backgroundColor: (comp.props.bgColor as string) ?? undefined,
          color: (comp.props.fgColor as string) ?? undefined,
          padding: (comp.props.padding as string) ? `${comp.props.padding}px` : undefined,
        } as CSSProperties)"
      >
        <AiScriptUiRenderer
          v-if="comp.children?.length"
          :components="comp.children"
          :interpreter="interpreter"
          :server-url="serverUrl"
          @post="(form: PostFormRequest) => emit('post', form)"
        />
      </div>

      <!-- folder -->
      <details v-else-if="comp.type === 'folder'" :class="$style.aisFolder">
        <summary>{{ comp.props.title ?? 'Folder' }}</summary>
        <AiScriptUiRenderer
          v-if="comp.children?.length"
          :components="comp.children"
          :interpreter="interpreter"
          :server-url="serverUrl"
          @post="(form: PostFormRequest) => emit('post', form)"
        />
      </details>

      <!-- buttons (horizontal button group) -->
      <div v-else-if="comp.type === 'buttons'" :class="$style.aisButtons">
        <button
          v-for="(btn, idx) in (comp.props.buttons as { text: string; onClick?: unknown; disabled?: boolean }[]) ?? []"
          :key="idx"
          :class="$style.aisButton"
          :disabled="!!btn.disabled"
          @click="callHandler(btn.onClick, interpreter)"
        >
          {{ btn.text }}
        </button>
      </div>

      <!-- textarea -->
      <textarea
        v-else-if="comp.type === 'textarea'"
        :class="$style.aisTextarea"
        :placeholder="(comp.props.placeholder as string) ?? ''"
        :value="(comp.props.default as string) ?? ''"
        @input="
          (e) => {
            const val = (e.target as HTMLTextAreaElement).value
            callHandler(comp.props.onInput, interpreter, { type: 'str', value: val } as Value)
          }
        "
      />

      <!-- postFormButton (Play-specific: opens share page in browser) -->
      <button
        v-else-if="comp.type === 'postFormButton'"
        :class="[$style.aisButton, $style.aisPostFormButton, { [$style.primary]: !!comp.props.primary, [$style.rounded]: !!comp.props.rounded }]"
        @click="handlePostFormButton(comp)"
      >
        {{ comp.props.text ?? 'Post' }}
      </button>

      <!-- postForm (embedded post form) -->
      <div v-else-if="comp.type === 'postForm'" :class="$style.aisPostForm">
        <textarea
          :class="$style.aisTextarea"
          :placeholder="(comp.props.placeholder as string) ?? ''"
          @input="
            (e) => {
              const val = (e.target as HTMLTextAreaElement).value
              callHandler(comp.props.onInput, interpreter, { type: 'str', value: val } as Value)
            }
          "
        />
      </div>

      <!-- spacer -->
      <div
        v-else-if="comp.type === 'spacer'"
        :class="$style.aisSpacer"
        :style="{ height: `${(comp.props.size as number) ?? 16}px` }"
      />
    </template>
  </div>
</template>

<style lang="scss" module>
.aisUiRenderer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.aisText {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.85em;
  line-height: 1.5;
}

.aisMfm {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.85em;
  line-height: 1.5;
}

.aisButton {
  padding: 7px 14px;
  border: none;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  cursor: pointer;
  font-size: 0.85em;
  transition: background var(--nd-duration-fast);

  &:hover:not(:disabled) {
    background: var(--nd-buttonHoverBg);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.aisButtons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.aisTextInput,
.aisNumberInput,
.aisSelect {
  padding: 6px 10px;
  border: none;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 0.85em;
  outline: none;

  &:focus {
    box-shadow: 0 0 0 2px var(--nd-accent);
  }
}

.aisTextarea {
  padding: 6px 10px;
  border: none;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 0.85em;
  font-family: inherit;
  outline: none;
  resize: vertical;
  min-height: 60px;

  &:focus {
    box-shadow: 0 0 0 2px var(--nd-accent);
  }
}

.aisSwitch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85em;
  cursor: pointer;
}

.aisContainer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.aisFolder {
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-md);
  overflow: hidden;

  summary {
    cursor: pointer;
    padding: 6px 10px;
    font-size: 0.85em;
    font-weight: 500;
    background: var(--nd-panelHighlight);
    transition: background var(--nd-duration-base);

    &:hover {
      background: var(--nd-buttonHoverBg);
    }
  }

  > :deep(.aisUiRenderer) {
    padding: 8px 10px;
  }
}

.aisPostFormButton {
  &.primary {
    background: var(--nd-accent);
    color: var(--nd-fgOnAccent);

    &:hover:not(:disabled) {
      background: var(--nd-accentDarken);
    }
  }

  &.rounded {
    border-radius: var(--nd-radius-full);
  }
}

.aisPostForm {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.aisSpacer {
  flex-shrink: 0;
}
</style>
