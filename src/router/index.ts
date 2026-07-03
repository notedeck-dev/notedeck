import { watch } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { useTutorialStore } from '@/composables/useTutorial'
import { useAccountsStore } from '@/stores/accounts'
import { useSettingsStore } from '@/stores/settings'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'deck',
      component: () => import('@/views/DeckPage.vue'),
    },
    {
      path: '/note/:accountId/:noteId',
      name: 'note-detail',
      component: () => import('@/views/NoteDetailPage.vue'),
      props: true,
    },
    {
      path: '/user/:accountId/:userId',
      name: 'user-profile',
      component: () => import('@/views/UserProfilePage.vue'),
      props: true,
    },
    {
      path: '/pip',
      name: 'pip',
      component: () => import('@/views/PipPage.vue'),
      meta: { pip: true },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundPage.vue'),
      meta: { public: true },
    },
  ],
})

// Non-blocking: let routes through immediately, redirect reactively when loaded
router.beforeEach((to) => {
  const accountsStore = useAccountsStore()

  if (!accountsStore.isLoaded) return

  const isPublic = to.meta.public === true
  const hasAccounts = accountsStore.accounts.length > 0

  // アカウント 0 件でもデッキシェルは隠さない (#692)。ログインは全画面
  // ページではなくデッキ内のログインウィンドウから行う。アカウント必須の
  // データページのみデッキへ戻す。
  if (!isPublic && !hasAccounts && to.name !== 'deck') {
    return { name: 'deck' }
  }
})

// After accounts finish loading with none registered: 初回起動なら
// チュートリアルを開く (デッキ上で動く)。以前はチュートリアル完了済みだと
// /login へ強制遷移していたが、#692 でアカウント 0 件でもデッキを見せる
// 方針に変更した。
export function setupFirstRunTutorial(): void {
  const accountsStore = useAccountsStore()
  const stop = watch(
    () => accountsStore.isLoaded,
    (loaded) => {
      if (!loaded) return
      stop()
      if (accountsStore.accounts.length === 0) {
        const route = router.currentRoute.value
        if (route.meta.public === true) return
        if (useSettingsStore().get('tutorial.completed') !== true) {
          useTutorialStore().start()
        }
      }
    },
    { immediate: true },
  )
}
