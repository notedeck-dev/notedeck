<script setup lang="ts">
import { computed } from 'vue'
import PermissionProfileFields from '@/components/window/PermissionProfileFields.vue'
import type { ProfiledPrincipalId } from '@/permissions/principal'
import type { PermissionKey, PermissionsConfig } from '@/permissions/schema'
import { resolveForProfiled, usePermissionsConfig } from '@/permissions/store'

/**
 * principal 1 つ分の権限プロファイル編集 (#712 §8.1)。権限ウィンドウ
 * (PermissionsContent) が principal 行ごとに 1 個ずつ使う。面は
 * PermissionProfileFields で、ここは permissions.json5 (permissionsFile) との結線だけ。
 * 表示値は resolveForProfiled (= floor / clamp 適用済みの実効値)。
 */
const props = defineProps<{
  principalId: ProfiledPrincipalId
  /** 固定キー: disabled + 理由 chip 表示 (fixedValue は表示上の固定値) */
  disabledKeys?: readonly {
    keys: readonly PermissionKey[]
    reason: string
    fixedValue: boolean
  }[]
}>()

const { file: permissionsFile } = usePermissionsConfig()

const profile = computed<PermissionsConfig>(
  () =>
    permissionsFile.value.principals[props.principalId] ?? {
      preset: 'readonly',
      custom: {} as never,
    },
)
const resolved = computed(() => {
  void permissionsFile.value
  return resolveForProfiled(props.principalId)
})

function update(next: PermissionsConfig) {
  permissionsFile.value.principals[props.principalId] = next
}
</script>

<template>
  <PermissionProfileFields
    :model-value="profile"
    :resolved="resolved"
    :disabled-keys="disabledKeys"
    @update:model-value="update"
  />
</template>
