<script setup lang="ts">
import { ref, watch } from 'vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkAchievementsGrid from '@/components/common/MkAchievementsGrid.vue'
import { i18n } from '@/i18n'
import type { Achievement } from '@/utils/achievements'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'

const props = defineProps<{
  accountId: string
  userId: string
  active: boolean
}>()

const achievements = ref<Achievement[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)
const loaded = ref(false)

async function load() {
  if (loaded.value) return
  loaded.value = true
  isLoading.value = true
  error.value = null
  try {
    achievements.value = unwrap(
      await commands.apiGetUserAchievements(props.accountId, props.userId),
    ) as unknown as Achievement[]
  } catch (e) {
    error.value = AppError.from(e).message
    loaded.value = false
  } finally {
    isLoading.value = false
  }
}

watch(
  () => props.active,
  (active) => {
    if (active) void load()
  },
  { immediate: true },
)
</script>

<template>
  <div v-show="active" :class="$style.pane">
    <div v-if="isLoading" :class="$style.stateMessage">
      <LoadingSpinner />
    </div>
    <div v-else-if="error" :class="[$style.stateMessage, $style.stateError]">
      {{ error }}
    </div>
    <div v-else-if="achievements.length === 0" :class="$style.stateMessage">
      {{ i18n.ts._userProfileAchievementsPane.empty }}
    </div>
    <MkAchievementsGrid v-else :achievements="achievements" />
  </div>
</template>

<style lang="scss" module>
.pane {
  padding: 4px;
}

.stateMessage {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: var(--nd-fg);
  opacity: 0.6;
  font-size: 0.9em;
}

.stateError {
  color: var(--nd-love);
  opacity: 1;
}
</style>
