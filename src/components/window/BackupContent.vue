<script setup lang="ts">
import { relaunch } from '@tauri-apps/plugin-process'
import { ref } from 'vue'
import { i18n } from '@/i18n'
import { nativeField } from '@/i18n/native'
import { type ConfirmOptions, useConfirm } from '@/stores/confirm'
import { commands, unwrap } from '@/utils/tauriInvoke'

defineProps<{
  initialTab?: 'notedeck' | 'db'
}>()

const { confirm } = useConfirm()

const isExportingSettings = ref(false)
const isImportingSettings = ref(false)
const isExportingDb = ref(false)
const isImportingDb = ref(false)
const errorMessage = ref('')

async function backupAction(
  loading: { value: boolean },
  action: () => Promise<unknown>,
  opts?: { confirmOpts?: ConfirmOptions; relaunch?: boolean },
) {
  if (opts?.confirmOpts && !(await confirm(opts.confirmOpts))) return
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await action()
    if (result && opts?.relaunch) {
      await relaunch()
    }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

const exportSettings = () =>
  backupAction(isExportingSettings, () =>
    commands.exportSettingsJson().then((r) => unwrap(r)),
  )

const importSettings = () =>
  backupAction(
    isImportingSettings,
    async () => {
      const result = unwrap(await commands.importSettingsJson())
      if (!result.imported) return false // dialog cancelled
      // スキップ / 別名退避したエントリ (#913) を再起動前に開示する。
      // 再起動後では警告が失われるのでここで見せるしかない
      if (result.warnings.length > 0) {
        await confirm({
          title: i18n.ts._backupContent.importDoneTitle,
          message: i18n.tsx._backupContent.importDoneMessage_plural({
            count: result.warnings.length,
          }),
          code: result.warnings.map((w) => nativeField(w, 'text')).join('\n'),
          codeLanguage: 'text',
          type: 'warning',
          hideCancel: true,
          okLabel: i18n.ts._backupContent.restart,
        })
      }
      return true
    },
    {
      confirmOpts: {
        title: i18n.ts._backupContent.importSettingsTitle,
        message: i18n.ts._backupContent.importSettingsMessage,
        okLabel: i18n.ts._common.import,
        type: 'danger',
      },
      relaunch: true,
    },
  )

const exportDb = () =>
  backupAction(isExportingDb, () => commands.exportDb().then((r) => unwrap(r)))

const importDb = () =>
  backupAction(
    isImportingDb,
    () => commands.importDb().then((r) => unwrap(r)),
    {
      confirmOpts: {
        title: i18n.ts._backupContent.importDbTitle,
        message: i18n.ts._backupContent.importDbMessage,
        okLabel: i18n.ts._common.import,
        type: 'danger',
      },
      relaunch: true,
    },
  )
</script>

<template>
  <div :class="$style.content">
    <!-- notedeck/ 設定エクスポート / インポート -->
    <div :class="$style.section">
      <div :class="$style.sectionHeader">
        <i class="ti ti-folder" :class="$style.sectionIcon" />
        <span :class="$style.sectionTitle">notedeck/</span>
        <span :class="$style.sectionDesc">{{ i18n.ts._backupContent.settingsFiles }}</span>
      </div>
      <p :class="$style.hint">
        {{ i18n.ts._backupContent.settingsHint }}
      </p>
      <div :class="$style.btnRow">
        <button class="_button" :class="$style.actionBtn" :disabled="isExportingSettings" @click="exportSettings">
          <i class="ti ti-package-export" />
          {{ isExportingSettings ? i18n.ts._backupContent.processing : i18n.ts._common.export }}
        </button>
        <button class="_button" :class="$style.actionBtn" :disabled="isImportingSettings" @click="importSettings">
          <i class="ti ti-package-import" />
          {{ isImportingSettings ? i18n.ts._backupContent.processing : i18n.ts._common.import }}
        </button>
      </div>
    </div>

    <div :class="$style.divider" />

    <!-- notecli.db バックアップ / インポート -->
    <div :class="$style.section">
      <div :class="$style.sectionHeader">
        <i class="ti ti-database" :class="$style.sectionIcon" />
        <span :class="$style.sectionTitle">notecli.db</span>
        <span :class="$style.sectionDesc">{{ i18n.ts._backupContent.database }}</span>
      </div>
      <p :class="$style.hint">
        {{ i18n.ts._backupContent.databaseHint }}
        {{ i18n.ts._backupContent.databaseCredentialsNote }}
      </p>
      <div :class="$style.btnRow">
        <button class="_button" :class="$style.actionBtn" :disabled="isExportingDb" @click="exportDb">
          <i class="ti ti-database-export" />
          {{ isExportingDb ? i18n.ts._backupContent.processing : i18n.ts._backupContent.backup }}
        </button>
        <button class="_button" :class="$style.actionBtn" :disabled="isImportingDb" @click="importDb">
          <i class="ti ti-database-import" />
          {{ isImportingDb ? i18n.ts._backupContent.processing : i18n.ts._backupContent.restore }}
        </button>
      </div>
    </div>

    <div v-if="errorMessage" :class="$style.error">{{ errorMessage }}</div>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.content {
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 0;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sectionHeader {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sectionIcon {
  font-size: 16px;
  color: var(--nd-fgMuted);
}

.sectionTitle {
  font-weight: bold;
  font-size: 0.95em;
  color: var(--nd-fg);
}

.sectionDesc {
  font-size: 0.8em;
  color: var(--nd-fgMuted);
}

.hint {
  font-size: 0.8em;
  color: var(--nd-fgMuted);
  line-height: 1.5;
  margin: 0;
}

.btnRow {
  display: flex;
  gap: 8px;
}

.actionBtn {
  @include btn-action;
}

.divider {
  height: 1px;
  background: var(--nd-divider);
  margin: 16px 0;
}

.error {
  margin-top: 12px;
  padding: 8px 12px;
  font-size: 0.8em;
  color: var(--nd-love);
  background: color-mix(in srgb, var(--nd-love) 10%, transparent);
  border-radius: var(--nd-radius-sm);
}
</style>
