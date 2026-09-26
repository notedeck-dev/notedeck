<script setup lang="ts">
import { computed } from 'vue'
import type { NormalizedPoll } from '@/adapters/types'
import { i18n } from '@/i18n'

const props = defineProps<{
  poll: NormalizedPoll
}>()

const emit = defineEmits<{
  vote: [choice: number]
}>()

const totalVotes = computed(() =>
  props.poll.choices.reduce((sum, c) => sum + c.votes, 0),
)

const isExpired = computed(() => {
  if (!props.poll.expiresAt) return false
  return new Date(props.poll.expiresAt) < new Date()
})

const hasVoted = computed(() => props.poll.choices.some((c) => c.isVoted))

function percentage(votes: number): number {
  if (totalVotes.value === 0) return 0
  return Math.round((votes / totalVotes.value) * 100)
}

function formatExpiry(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(i18n.lang)
}

function canVote(isVoted: boolean): boolean {
  if (isExpired.value) return false
  if (isVoted) return false
  if (!props.poll.multiple && hasVoted.value) return false
  return true
}

function onClick(i: number, isVoted: boolean) {
  if (!canVote(isVoted)) return
  emit('vote', i)
}
</script>

<template>
  <div :class="$style.mkPoll">
    <button
      v-for="(choice, i) in poll.choices"
      :key="i"
      type="button"
      :class="[$style.pollChoice, { [$style.disabled]: !canVote(choice.isVoted) }]"
      :disabled="!canVote(choice.isVoted)"
      @click.stop="onClick(i, choice.isVoted)"
    >
      <div :class="$style.pollBar" :style="{ width: percentage(choice.votes) + '%' }" />
      <div :class="$style.pollContent">
        <span :class="$style.pollText">
          <svg v-if="choice.isVoted" viewBox="0 0 24 24" width="12" height="12" style="margin-right: 4px; vertical-align: -1px;">
            <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          {{ choice.text }}
        </span>
        <span :class="$style.pollPct">{{ percentage(choice.votes) }}%</span>
      </div>
    </button>
    <div :class="$style.pollFooter">
      <span :class="$style.pollTotal">{{ i18n.tsx._mkPoll.votes_plural({ count: totalVotes }) }}</span>
      <span v-if="poll.multiple" :class="$style.pollBadge">{{ i18n.ts._mkPoll.multiple }}</span>
      <span v-if="poll.expiresAt" :class="$style.pollExpiry">
        {{ isExpired ? i18n.ts._mkPoll.ended : i18n.tsx._mkPoll.until({ date: formatExpiry(poll.expiresAt) }) }}
      </span>
    </div>
  </div>
</template>

<style lang="scss" module>
.mkPoll {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pollChoice {
  position: relative;
  border-radius: 4px;
  overflow: clip;
  background: var(--nd-accentedBg);
  min-height: 35px;
  display: flex;
  align-items: center;
  cursor: pointer;
  border: none;
  padding: 0;
  width: 100%;
  text-align: left;
  color: inherit;
  font: inherit;

  &:hover:not(.disabled) {
    filter: brightness(1.05);
  }

  &.disabled {
    cursor: default;
  }
}

.pollBar {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: var(--nd-accent);
  background: linear-gradient(90deg, var(--nd-buttonGradateA), var(--nd-buttonGradateB));
  transition: width 1s ease;
}

.pollContent {
  position: relative;
  z-index: 1;
  display: inline-block;
  padding: 3px 5px;
  background: var(--nd-panel);
  border-radius: 3px;
  margin: 4px;
}

.pollText {
  font-size: 0.9em;
}

.pollPct {
  font-size: 0.8em;
  font-weight: bold;
  opacity: 0.7;
  flex-shrink: 0;
  margin-left: 8px;
}

.pollFooter {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px;
  font-size: 0.75em;
  opacity: 0.6;
}

.pollBadge {
  padding: 1px 6px;
  border-radius: var(--nd-radius-full);
  background: var(--nd-buttonBg);
  font-weight: bold;
}

.pollExpiry {
  margin-left: auto;
}
</style>
