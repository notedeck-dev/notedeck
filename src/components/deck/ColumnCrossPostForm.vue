<script setup lang="ts">
import { computed, defineAsyncComponent, useTemplateRef } from 'vue'
import type { useColumnSetup } from '@/composables/useColumnSetup'
import { usePortal } from '@/composables/usePortal'
import { useAccountsStore } from '@/stores/accounts'

/**
 * 全アカウント面 (column.accountId == null) の投稿フォーム。宛先は
 * useColumnSetup の handlers が操作したノートの取得元 (`postForm.accountId`)。
 * per-account 分岐のフォームは各カラムが column.accountId で描画するので、
 * 検索 / 通知のように両モードを持つカラムは `v-if="isCrossAccount"` で使う
 */
const MkPostForm = defineAsyncComponent(
  () => import('@/components/common/MkPostForm.vue'),
)

const props = defineProps<{
  postForm: ReturnType<typeof useColumnSetup>['postForm']
}>()
const emit = defineEmits<{ posted: [editedNoteId?: string] }>()

const accountsStore = useAccountsStore()
const account = computed(() =>
  accountsStore.accountMap.get(props.postForm.accountId.value ?? ''),
)
const portalRef = useTemplateRef<HTMLElement>('portalRef')
usePortal(portalRef)
</script>

<template>
  <!-- MkPostForm は accountId を初期値でしか読まないので、開いたまま別アカウントの
       ノートを操作したときは key で作り直す -->
  <div v-if="postForm.show.value && account?.hasToken" :key="account.id" ref="portalRef">
    <MkPostForm
      :account-id="account.id"
      :reply-to="postForm.replyTo.value"
      :renote-id="postForm.renoteId.value"
      :edit-note="postForm.editNote.value"
      :initial-note="postForm.initialNote.value"
      :initial-text="postForm.initialText.value"
      :initial-cw="postForm.initialCw.value"
      :initial-visibility="postForm.initialVisibility.value"
      @close="postForm.close"
      @posted="emit('posted', $event)"
    />
  </div>
</template>
