<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GalleryPost } from '@/bindings'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useAccountsStore } from '@/stores/accounts'
import { openSafeUrl, webUiUrl } from '@/utils/url'
import PopupMenu from './PopupMenu.vue'

// ギャラリー投稿のコンテキストメニュー (#793)。DriveItemMenu と同型の
// PopupMenu ラッパー。「開く」はホスト委譲、リンク系は内部完結。

const props = defineProps<{
  post: GalleryPost | null
  accountId: string | null | undefined
}>()

const emit = defineEmits<{
  'open-request': [post: GalleryPost]
}>()

const accountsStore = useAccountsStore()
const { copyToClipboard } = useClipboardFeedback()
const popupMenuRef = ref<InstanceType<typeof PopupMenu>>()

const postWebUrl = computed(() => {
  if (!props.post) return null
  const host = accountsStore.accounts.find(
    (a) => a.id === props.accountId,
  )?.host
  if (!host) return null
  return webUiUrl(host, `/gallery/${props.post.id}`)
})

function open(e: MouseEvent) {
  popupMenuRef.value?.open(e)
}

function close() {
  popupMenuRef.value?.close()
}

function onOpen() {
  close()
  if (props.post) emit('open-request', props.post)
}

async function copyLink() {
  close()
  if (postWebUrl.value) await copyToClipboard(postWebUrl.value)
}

async function openInBrowser() {
  close()
  if (postWebUrl.value) await openSafeUrl(postWebUrl.value)
}

defineExpose({ open, close })
</script>

<template>
  <PopupMenu ref="popupMenuRef">
    <button class="_popupItem" @click="onOpen">
      <i class="ti ti-external-link" />
      開く
    </button>
    <div class="_popupDivider" />
    <button class="_popupItem" :disabled="!postWebUrl" @click="copyLink">
      <i class="ti ti-link" />
      リンクをコピー
    </button>
    <button class="_popupItem" :disabled="!postWebUrl" @click="openInBrowser">
      <i class="ti ti-world" />
      ブラウザで開く
    </button>
    <!-- 将来の register_gallery_post_action はここに getPluginHandlers computed +
         v-for セクションを足す（NoteMoreMenu と同型の拡張点） -->
  </PopupMenu>
</template>
