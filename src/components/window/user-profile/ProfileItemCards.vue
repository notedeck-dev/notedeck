<script setup lang="ts">
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'

export interface ProfileItemCard {
  id: string
  title: string
  summary?: string | null
}

defineProps<{
  cards: ProfileItemCard[]
  isLoading: boolean
  error?: string | null
  emptyMessage: string
  infoImageUrl?: string
  errorImageUrl?: string
}>()

const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <button
    v-for="card in cards"
    :key="card.id"
    class="_button"
    :class="$style.card"
    @click="emit('select', card.id)"
  >
    <div :class="$style.cardTitle">{{ card.title }}</div>
    <div v-if="card.summary" :class="$style.cardSummary">{{ card.summary }}</div>
  </button>

  <div v-if="isLoading" :class="$style.stateMessage">
    <LoadingSpinner />
  </div>
  <ColumnEmptyState
    v-else-if="error"
    :message="error"
    is-error
    :image-url="errorImageUrl"
  />
  <ColumnEmptyState
    v-else-if="cards.length === 0"
    :message="emptyMessage"
    :image-url="infoImageUrl"
  />
</template>

<style lang="scss" module>
.card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 12px 14px;
  text-align: left;
  border-bottom: 1px solid var(--nd-divider);
  transition: background var(--nd-duration-base);
  contain: layout style paint;
  content-visibility: auto;
  contain-intrinsic-size: auto 60px;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.cardTitle {
  font-size: var(--nd-font-body);
  font-weight: var(--nd-weight-bold);
  color: var(--nd-fgHighlighted);
}

.cardSummary {
  font-size: var(--nd-font-sm);
  opacity: 0.7;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.stateMessage {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: var(--nd-fg);
  opacity: 0.6;
  font-size: var(--nd-font-body);
}
</style>
