import { computed, type Ref, ref, watch } from 'vue'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { toLocalDateInput, toLocalTimeInput } from '@/services/scheduleTime'

/**
 * 予約投稿ダイアログの state と操作を集約する composable。
 * native `<dialog>` と date/time 分離入力（WebKitGTK 回避）で構成される。
 *
 * `scheduledAt` の ISO 文字列 ref を受け取り、OK で更新 / 解除で null 化する。
 * `scheduleNow` は「あと ◯ 分」表示向けの 30 秒周期タイマーで、`scheduledAt`
 * が null の間は停止する（watch の onCleanup で漏れない）。
 */
export function useScheduleDialog(scheduledAt: Ref<string | null>) {
  const showScheduleDialog = ref(false)
  const scheduleDialogRef = ref<HTMLDialogElement | null>(null)
  const pendingScheduleDate = ref('')
  const pendingScheduleTime = ref('')
  const scheduleNow = ref(Date.now())

  const canConfirmSchedule = computed(
    () => !!pendingScheduleDate.value && !!pendingScheduleTime.value,
  )

  useNativeDialog(scheduleDialogRef, showScheduleDialog, {
    onCancel: () => (showScheduleDialog.value = false),
    leaveDuration: 200,
  })

  watch(
    scheduledAt,
    (v, _, onCleanup) => {
      if (!v) return
      scheduleNow.value = Date.now()
      const t = setInterval(() => (scheduleNow.value = Date.now()), 30_000)
      onCleanup(() => clearInterval(t))
    },
    { immediate: true },
  )

  function openScheduleDialog() {
    const base = scheduledAt.value
      ? new Date(scheduledAt.value)
      : new Date(Date.now() + 60 * 60_000)
    base.setSeconds(0, 0)
    pendingScheduleDate.value = toLocalDateInput(base)
    pendingScheduleTime.value = toLocalTimeInput(base)
    showScheduleDialog.value = true
  }

  function confirmSchedule() {
    if (!canConfirmSchedule.value) return
    const d = new Date(
      `${pendingScheduleDate.value}T${pendingScheduleTime.value}`,
    )
    // 5 分後を下回る場合は切り上げ
    const minMs = Date.now() + 5 * 60_000
    if (d.getTime() < minMs) d.setTime(minMs)
    d.setSeconds(0, 0)
    scheduledAt.value = d.toISOString()
    showScheduleDialog.value = false
  }

  function clearSchedule() {
    scheduledAt.value = null
    showScheduleDialog.value = false
  }

  function minScheduleDate(): string {
    return toLocalDateInput(new Date(Date.now() + 5 * 60_000))
  }

  return {
    showScheduleDialog,
    scheduleDialogRef,
    pendingScheduleDate,
    pendingScheduleTime,
    canConfirmSchedule,
    scheduleNow,
    openScheduleDialog,
    confirmSchedule,
    clearSchedule,
    minScheduleDate,
  }
}
