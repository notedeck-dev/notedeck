<script setup lang="ts">
import { computed } from 'vue'
import type { NormalizedNote } from '@/adapters/types'
import MkNote from '@/components/common/MkNote.vue'
import { useNavigation } from '@/composables/useNavigation'
import { i18n } from '@/i18n'

export interface NoteTreeNode {
  note: NormalizedNote
  children: NoteTreeNode[]
}

export interface NoteTreeHandlers {
  react: (reaction: string, note: NormalizedNote) => void
  reply: (note: NormalizedNote) => void
  renote: (note: NormalizedNote) => void
  quote: (note: NormalizedNote) => void
  deleteFn: (note: NormalizedNote) => void
  edit: (note: NormalizedNote) => void
  deleteAndEdit: (note: NormalizedNote) => void
  vote: (choice: number, note: NormalizedNote) => void
}

const props = defineProps<{
  nodes: NoteTreeNode[]
  accountId: string
  handlers: NoteTreeHandlers
  depth?: number
}>()

const MAX_DEPTH = 5

const currentDepth = computed(() => props.depth ?? 0)

const { navigateToNote } = useNavigation()
</script>

<template>
  <div v-for="node in nodes" :key="node.note.id" :class="$style.treeNode">
    <MkNote
      :note="node.note"
      @react="handlers.react"
      @reply="handlers.reply"
      @renote="handlers.renote"
      @quote="handlers.quote"
      @delete="handlers.deleteFn"
      @edit="handlers.edit"
      @delete-and-edit="handlers.deleteAndEdit"
      @vote="handlers.vote"
    />

    <div v-if="node.children.length > 0 && currentDepth < MAX_DEPTH" :class="$style.childrenWrap">
      <MkNoteTree
        :nodes="node.children"
        :account-id="accountId"
        :handlers="handlers"
        :depth="currentDepth + 1"
      />
    </div>

    <div
      v-else-if="node.children.length > 0 && currentDepth >= MAX_DEPTH"
      :class="$style.continueThread"
    >
      <button
        class="_button"
        :class="$style.continueButton"
        @click="navigateToNote(accountId, node.note.id)"
      >
        <i class="ti ti-arrow-forward" />
        {{ i18n.ts._mkNoteTree.continueThread }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" module>
.treeNode {
  // wrapper for each node
}

.childrenWrap {
  border-left: solid 1.5px var(--nd-divider);
  margin-left: 20px;
}

.continueThread {
  border-left: solid 1.5px var(--nd-divider);
  margin-left: 20px;
}

.continueButton {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  font-size: 0.85em;
  color: var(--nd-accent);
  opacity: 0.8;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 1;
  }
}
</style>
