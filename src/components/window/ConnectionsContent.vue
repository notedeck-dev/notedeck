<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { PrincipalClass } from '@/bindings'
import ChoiceCard from '@/components/common/ChoiceCard.vue'
import ChoiceCardGrid from '@/components/common/ChoiceCardGrid.vue'
import { useVault } from '@/composables/useVault'
import { BUILTIN_TEMPLATES, faviconUrl } from '@/data/connectionTemplates'
import { i18n } from '@/i18n'
import { resolveForProfiled } from '@/permissions/store'
import { useWindowsStore } from '@/stores/windows'

const vault = useVault()
const windowsStore = useWindowsStore()

// favicon の取得に失敗したロゴのキー集合 (テンプレ id / 接続 id)。
// 失敗したものは tabler icon に fallback する。
const failedIcons = ref(new Set<string>())

const connections = computed(() => vault.connections.value)
const isEmpty = computed(
  () => vault.loaded.value && connections.value.length === 0,
)

onMounted(() => {
  void vault.refresh()
})

/** 接続編集ウィンドウを開く。connectionId 未指定 = 新規作成。 */
function openEdit(props: { connectionId?: string; templateId?: string }) {
  windowsStore.open('connectionEdit', props)
}

/**
 * 開示先バッジ (#712 §8.3)。一覧 1 画面で「どの secret がどこに見えているか」を
 * 一望する。対象クラスの vault.use が実効 OFF なら淡色 (inactive) —
 * バッジの見た目と実効開示を一致させる。
 */
function classBadge(
  conn: { exposedTo?: PrincipalClass[]; slots?: string[] },
  cls: PrincipalClass,
): 'active' | 'inactive' | 'hidden' {
  if (!conn.exposedTo?.includes(cls)) return 'hidden'
  const vaultUse =
    cls === 'ai'
      ? resolveForProfiled('ai.chat')['vault.use'] ||
        resolveForProfiled('ai.heartbeat')['vault.use']
      : resolveForProfiled(cls)['vault.use']
  if (!vaultUse || (conn.slots?.length ?? 0) === 0) return 'inactive'
  return 'active'
}
</script>

<template>
  <div :class="$style.content">
    <!-- 追加パネル: テンプレートと「＋ 手動追加」を同じグリッドで表示。 -->
    <p :class="$style.sectionTitle">
      {{ isEmpty ? i18n.ts._connectionsContent.chooseService : i18n.ts._connectionsContent.addConnection }}
    </p>
    <ChoiceCardGrid>
      <ChoiceCard
        v-for="tpl in BUILTIN_TEMPLATES"
        :key="tpl.id"
        :label="tpl.name"
        :icon-url="failedIcons.has(tpl.id) ? null : faviconUrl(tpl.baseUrl)"
        :icon="tpl.icon"
        @icon-error="failedIcons.add(tpl.id)"
        @click="openEdit({ templateId: tpl.id })"
      />
      <!-- 手動追加も同じグリッドの「＋」カードに統一。 -->
      <ChoiceCard dashed icon="plus" :label="i18n.ts._connectionsContent.addManually" @click="openEdit({})" />
    </ChoiceCardGrid>

    <!-- 登録済みの接続: 同じグリッド UI で表示。 -->
    <template v-if="connections.length > 0">
      <p :class="$style.sectionTitle">{{ i18n.ts._connectionsContent.registered }}</p>
      <ChoiceCardGrid>
        <ChoiceCard
          v-for="conn in connections"
          :key="conn.id"
          :label="conn.name"
          :icon-url="failedIcons.has(conn.id) ? null : faviconUrl(conn.baseUrl)"
          icon="plug-connected"
          @icon-error="failedIcons.add(conn.id)"
          @click="openEdit({ connectionId: conn.id })"
        >
          <template #badge>
            <span
              v-if="classBadge(conn, 'ai') !== 'hidden'"
              :class="$style[`cls_${classBadge(conn, 'ai')}`]"
              :title="
                classBadge(conn, 'ai') === 'active'
                  ? i18n.ts._connectionsContent.aiActive
                  : i18n.ts._connectionsContent.aiPending
              "
            >
              <i class="ti ti-robot" />
            </span>
            <span
              v-if="classBadge(conn, 'plugin') !== 'hidden'"
              :class="$style[`cls_${classBadge(conn, 'plugin')}`]"
              :title="
                classBadge(conn, 'plugin') === 'active'
                  ? i18n.ts._connectionsContent.pluginActive
                  : i18n.ts._connectionsContent.pluginPending
              "
            >
              <i class="ti ti-puzzle" />
            </span>
            <span
              v-if="classBadge(conn, 'external') !== 'hidden'"
              :class="$style[`cls_${classBadge(conn, 'external')}`]"
              :title="
                classBadge(conn, 'external') === 'active'
                  ? i18n.ts._connectionsContent.externalActive
                  : i18n.ts._connectionsContent.externalPending
              "
            >
              <i class="ti ti-plug" />
            </span>
          </template>
        </ChoiceCard>
      </ChoiceCardGrid>
    </template>
  </div>
</template>

<style lang="scss" module>
.content {
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 8px;
  // テンプレも登録済みの接続も増えると窓の max-height を超える — 超過分を
  // スクロールに流す (ConnectionEditContent と同じパターン)。DeckWindow の
  // windowBody は overflow: hidden なので、スクロールは content 側の責務
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.sectionTitle {
  margin: 8px 0 2px;
  font-size: 0.85em;
  color: var(--nd-fgMuted);
}

.cls_active {
  color: var(--nd-success, var(--nd-link));
}

// 開示はされているが実効的にまだ見えない (vault.use 無効 / secret 未設定)
.cls_inactive {
  color: var(--nd-fgMuted);
  opacity: 0.5;
}
</style>
