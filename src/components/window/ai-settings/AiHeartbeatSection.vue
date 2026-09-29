<script setup lang="ts">
import { computed } from 'vue'
import {
  HEARTBEAT_DAILY_MAX_AI_RUNS_MAX,
  HEARTBEAT_DAILY_MAX_AI_RUNS_MIN,
  HEARTBEAT_INTERVAL_MAX_MINUTES,
  HEARTBEAT_INTERVAL_MIN_MINUTES,
  HEARTBEAT_MAX_SKIP_HOURS_MAX,
  HEARTBEAT_MAX_SKIP_HOURS_MIN,
  useAiConfig,
} from '@/composables/useAiConfig'
import { i18n } from '@/i18n'
import { presetChipLabel } from '@/permissions/labels'
import { usePermissionsConfig } from '@/permissions/store'
import { useWindowsStore } from '@/stores/windows'
import AiHeartbeatResidentRow from './AiHeartbeatResidentRow.vue'
import AiSettingsSection from './AiSettingsSection.vue'
import AiSwitchRow from './AiSwitchRow.vue'

const { config } = useAiConfig()
const windowsStore = useWindowsStore()

// どの skill を heartbeat 対象にするかは skill 側の frontmatter
// (`mode: heartbeat`) で持つので、AI 設定では skill 一覧を扱わない。

// --- 権限は権限ウィンドウ (#712 PR 2) に移動した ---
// 現在値の read-only chip + 導線だけ残す。
const { file: permissionsFile } = usePermissionsConfig()

const heartbeatPermChip = computed(() => {
  const profile = permissionsFile.value.principals['ai.heartbeat']
  return profile ? presetChipLabel(profile) : '-'
})

function openPermissionsWindow(): void {
  windowsStore.open('permissions')
}
</script>

<template>
  <AiSettingsSection
    icon="ti-activity-heartbeat"
    title="HEARTBEAT"
    :badge="config.heartbeat.enabled ? i18n.tsx._aiHeartbeatSection.enabledWithInterval({ minutes: config.heartbeat.intervalMinutes }) : i18n.ts._common.disabled"
  >
    <!-- Basic: 有効化 (TL フィルターと同じトグル) + interval + notice -->
    <AiSwitchRow
      icon="ti-activity-heartbeat"
      :label="i18n.ts._aiHeartbeatSection.enable"
      :on="config.heartbeat.enabled"
      @toggle="config.heartbeat.enabled = !config.heartbeat.enabled"
    />

    <!-- 常駐 (#1106): 巡回をアプリ終了後も続けるかは HEARTBEAT の一部として見せる -->
    <AiHeartbeatResidentRow v-if="config.heartbeat.enabled" />

    <!-- tick 間隔: 数値入力 (PerformanceEditor 風 1 行レイアウト) -->
    <div v-if="config.heartbeat.enabled" :class="$style.field">
      <div :class="$style.fieldHeader">
        <span :class="$style.fieldLabel">{{ i18n.ts._aiHeartbeatSection.tickInterval }}</span>
        <div :class="$style.fieldValue">
          <input
            v-model.number="config.heartbeat.intervalMinutes"
            type="number"
            :min="HEARTBEAT_INTERVAL_MIN_MINUTES"
            :max="HEARTBEAT_INTERVAL_MAX_MINUTES"
            :class="$style.numberInput"
          />
          <span :class="$style.fieldUnit">{{ i18n.ts._aiHeartbeatSection.minutes }}</span>
        </div>
      </div>
    </div>

    <!-- デスクトップ通知 (#411 0.19.0): 重要発見を即気付ける。
         アプリにフォーカスがあるときは自動抑制。 -->
    <AiSwitchRow
      v-if="config.heartbeat.enabled"
      icon="ti-bell"
      :label="i18n.ts._aiHeartbeatSection.desktopNotification"
      :sub-label="i18n.ts._aiHeartbeatSection.desktopNotificationDescription"
      :on="config.heartbeat.desktopNotification"
      @toggle="config.heartbeat.desktopNotification = !config.heartbeat.desktopNotification"
    />

    <!-- Cheap Check First (#411): skill 側で cheapCheckCapabilities 宣言した
         heartbeat skill に対して、tick 開始時に「変化検知」用の軽量 capability
         を呼び、前回値と一致すれば AI 起動を skip する。
         opt-out 可能 (= 常に AI を叩きたい場合は OFF にする)。 -->
    <template v-if="config.heartbeat.enabled">
      <AiSwitchRow
        icon="ti-bolt"
        label="Cheap Check First"
        :sub-label="i18n.ts._aiHeartbeatSection.cheapCheckDescription"
        :on="config.heartbeat.cheapCheck.enabled"
        @toggle="config.heartbeat.cheapCheck.enabled = !config.heartbeat.cheapCheck.enabled"
      />

      <div v-if="config.heartbeat.cheapCheck.enabled" :class="$style.field">
        <div :class="$style.fieldHeader">
          <span :class="$style.fieldLabel">{{ i18n.ts._aiHeartbeatSection.maxSkipHours }}</span>
          <div :class="$style.fieldValue">
            <input
              v-model.number="config.heartbeat.cheapCheck.maxSkipHours"
              type="number"
              :min="HEARTBEAT_MAX_SKIP_HOURS_MIN"
              :max="HEARTBEAT_MAX_SKIP_HOURS_MAX"
              :class="$style.numberInput"
            />
            <span :class="$style.fieldUnit">{{ i18n.ts._aiHeartbeatSection.hours }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 安全装置 (#411): 1 日の AI 起動上限 + 上限到達時の動作 -->
    <template v-if="config.heartbeat.enabled">
      <div :class="$style.field">
        <div :class="$style.fieldHeader">
          <span :class="$style.fieldLabel">{{ i18n.ts._aiHeartbeatSection.dailyMaxAiRuns }}</span>
          <div :class="$style.fieldValue">
            <input
              v-model.number="config.heartbeat.dailyMaxAiRuns"
              type="number"
              :min="HEARTBEAT_DAILY_MAX_AI_RUNS_MIN"
              :max="HEARTBEAT_DAILY_MAX_AI_RUNS_MAX"
              :class="$style.numberInput"
            />
            <span :class="$style.fieldUnit">{{ i18n.ts._aiHeartbeatSection.runsPerDay }}</span>
          </div>
        </div>
      </div>

      <AiSwitchRow
        icon="ti-hand-stop"
        :label="i18n.ts._aiHeartbeatSection.disableOnDailyLimit"
        :sub-label="i18n.ts._aiHeartbeatSection.disableOnDailyLimitDescription"
        :on="config.heartbeat.onDailyLimit === 'disable'"
        @toggle="config.heartbeat.onDailyLimit = config.heartbeat.onDailyLimit === 'disable' ? 'warn' : 'disable'"
      />
    </template>

    <!-- HEARTBEAT 中の権限は権限ウィンドウで管理 (#712 PR 2) -->
    <template v-if="config.heartbeat.enabled">
      <div :class="$style.field">
        <label :class="$style.fieldLabel">
          <span>{{ i18n.ts._aiHeartbeatSection.permissions }}</span>
        </label>
        <div :class="$style.keyHint">
          <i class="ti ti-shield-lock" />
          <span>{{ heartbeatPermChip }}</span>
          <button class="_button" :class="$style.inlineLink" @click="openPermissionsWindow">
            {{ i18n.ts._aiHeartbeatSection.changeInPermissions }}
          </button>
        </div>
      </div>
    </template>
  </AiSettingsSection>
</template>

<style lang="scss" module>
@use '@/styles/settingsFields' as *;

.keyHint {
  @include key-hint;
  align-items: center;
}

// HEARTBEAT 権限 chip の「権限設定で変更」導線 (#712 PR 2)
.inlineLink {
  color: var(--nd-link);
  text-decoration: underline;
  font-size: 1em;
}

.field { @include field; }
.fieldHeader { @include field-header; }
.fieldLabel { @include field-label; }
.fieldValue { @include field-value; }
.numberInput { @include number-input; }
.fieldUnit { @include field-unit; }
</style>
