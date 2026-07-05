<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    icon: string
    title: string
    /** ヘッダー右の現在値 chip。undefined なら chip 自体を出さない */
    badge?: string
    badgeIcon?: string
    badgeOk?: boolean
    defaultExpanded?: boolean
  }>(),
  {
    badge: undefined,
    badgeIcon: 'ti-info-circle',
    badgeOk: false,
    defaultExpanded: false,
  },
)

const expanded = ref(props.defaultExpanded)
</script>

<template>
  <div :class="$style.section">
    <button
      class="_button"
      :class="$style.sectionLabel"
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
      <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expanded }]" />
    </button>
    <template v-if="expanded">
      <slot />
    </template>
  </div>
</template>

<style lang="scss" module>
.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 10px;
  border-bottom: 1px solid var(--nd-divider);
}

.sectionLabel {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  font-size: 0.8em;
  font-weight: bold;
  opacity: 0.7;
  cursor: pointer;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 1;
  }
}

.chevron {
  margin-left: auto;
  font-size: 0.9em;
  transition: transform var(--nd-duration-base);
  transform: rotate(-90deg);
}

.chevronOpen {
  transform: rotate(0deg);
}

.statusBadge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
  padding: 2px 6px;
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-fg) 8%, transparent);
  font-size: 0.85em;
  font-weight: normal;
  opacity: 0.9;
}

.badgeOk { color: var(--nd-accent); }
.badgeNone { color: var(--nd-fg); opacity: 0.5; }
</style>
