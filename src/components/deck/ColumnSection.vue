<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  label: string
  count: number
}>()

// アコーディオン開閉。デフォルト展開、状態はカラムインスタンス内のみ
// (永続化しない)。
const collapsed = ref(false)
</script>

<template>
  <section :class="$style.section">
    <button
      class="_button"
      :class="$style.header"
      :aria-expanded="!collapsed"
      @click="collapsed = !collapsed"
    >
      <i
        class="ti"
        :class="[collapsed ? 'ti-chevron-right' : 'ti-chevron-down', $style.chevron]"
      />
      <span>{{ label }}</span>
      <span :class="$style.count">{{ count }}</span>
    </button>
    <div v-show="!collapsed">
      <slot />
    </div>
  </section>
</template>

<style module lang="scss">
.section {
  &:not(:first-child) {
    margin-top: 8px;
  }
}

.header {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 8px 12px 4px;
  font-size: 0.75em;
  font-weight: 600;
  color: var(--nd-fg);
  opacity: 0.55;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: opacity 0.1s;

  &:hover {
    opacity: 0.9;
  }
}

.chevron {
  font-size: 1.1em;
}

.count {
  font-weight: 400;
  opacity: 0.7;
}
</style>
