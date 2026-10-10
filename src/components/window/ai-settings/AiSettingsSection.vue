<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import CollapseBox from '@/components/common/CollapseBox.vue'

const props = withDefaults(
  defineProps<{
    icon: string
    title: string
    /** ヘッダー右の現在値 chip。undefined なら chip 自体を出さない */
    badge?: string
    badgeIcon?: string
    badgeOk?: boolean
    /** 値が変わるたびに開いて見える位置に出す (外から開かせる合図, #1165) */
    reveal?: number
  }>(),
  {
    badge: undefined,
    badgeIcon: 'ti-info-circle',
    badgeOk: false,
    reveal: undefined,
  },
)

const expanded = ref(false)
const root = useTemplateRef<HTMLElement>('root')

watch(
  () => props.reveal,
  async (v) => {
    if (v == null) return
    expanded.value = true
    await nextTick()
    root.value?.scrollIntoView({ block: 'start' })
  },
  { immediate: true },
)
</script>

<template>
  <div ref="root" :class="$style.section">
    <button
      class="_button"
      :class="$style.sectionLabel"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <i :class="'ti ' + icon" />
      {{ title }}
      <span v-if="badge != null" :class="$style.statusBadge">
        <i
          class="ti"
          :class="[badgeIcon, badgeOk ? $style.badgeOk : $style.badgeNone]"
        />
        {{ badge }}
      </span>
      <i class="ti ti-chevron-down nd-chevron" :class="[$style.chevron, { 'nd-chevron-closed': !expanded }]" />
    </button>
    <CollapseBox :open="expanded">
      <div :class="$style.body">
        <slot />
      </div>
    </CollapseBox>
  </div>
</template>

<style lang="scss" module>
.section {
  display: flex;
  flex-direction: column;
  padding: 12px 10px;
  border-bottom: 1px solid var(--nd-divider);
}

.sectionLabel {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  font-size: var(--nd-font-sm);
  font-weight: var(--nd-weight-bold);
  opacity: 0.7;
  cursor: pointer;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 1;
  }
}

.chevron {
  margin-left: auto;
  font-size: var(--nd-font-body);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
}

.statusBadge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
  padding: 2px 6px;
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-fg) 8%, transparent);
  font-size: var(--nd-font-md);
  font-weight: var(--nd-weight-regular);
  opacity: 0.9;
}

.badgeOk { color: var(--nd-accentText); }
.badgeNone { color: var(--nd-fg); opacity: 0.5; }
</style>
