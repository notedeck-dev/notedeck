<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { PrincipalClass } from '@/bindings'
import { useVault } from '@/composables/useVault'
import { BUILTIN_TEMPLATES, faviconUrl } from '@/data/connectionTemplates'
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
      : resolveForProfiled('external')['vault.use']
  if (!vaultUse || (conn.slots?.length ?? 0) === 0) return 'inactive'
  return 'active'
}
</script>

<template>
  <div :class="$style.content">
    <!-- 追加パネル: テンプレートと「＋ 手動追加」を同じグリッドで表示。 -->
    <p :class="$style.sectionTitle">
      {{ isEmpty ? '接続したいサービスを選んでください' : '接続を追加' }}
    </p>
    <div :class="$style.grid">
      <button
        v-for="tpl in BUILTIN_TEMPLATES"
        :key="tpl.id"
        class="_button"
        :class="$style.card"
        @click="openEdit({ templateId: tpl.id })"
      >
        <img
          v-if="faviconUrl(tpl.baseUrl) && !failedIcons.has(tpl.id)"
          :src="faviconUrl(tpl.baseUrl)!"
          :class="$style.logo"
          alt=""
          @error="failedIcons.add(tpl.id)"
        />
        <i v-else class="ti" :class="[`ti-${tpl.icon}`, $style.logoFallback]" />
        <span>{{ tpl.name }}</span>
      </button>

      <!-- 手動追加も同じグリッドの「＋」カードに統一。 -->
      <button
        class="_button"
        :class="[$style.card, $style.addCard]"
        @click="openEdit({})"
      >
        <i class="ti ti-plus" :class="$style.logoFallback" />
        <span>手動で追加</span>
      </button>
    </div>

    <!-- 登録済みの接続: 同じグリッド UI で表示。 -->
    <template v-if="connections.length > 0">
      <p :class="$style.sectionTitle">登録済みの接続</p>
      <div :class="$style.grid">
        <button
          v-for="conn in connections"
          :key="conn.id"
          class="_button"
          :class="$style.card"
          @click="openEdit({ connectionId: conn.id })"
        >
          <span
            v-if="classBadge(conn, 'ai') !== 'hidden'"
            :class="[$style.connBadge, $style[`cls_${classBadge(conn, 'ai')}`]]"
            :title="
              classBadge(conn, 'ai') === 'active'
                ? 'AI から利用可能'
                : 'AI に開示中 (vault.use が無効か secret 未設定でまだ使えません)'
            "
          >
            <i class="ti ti-robot" />
          </span>
          <span
            v-if="classBadge(conn, 'external') !== 'hidden'"
            :class="[$style.connBadge, $style[`cls_${classBadge(conn, 'external')}`]]"
            :title="
              classBadge(conn, 'external') === 'active'
                ? '外部アプリから利用可能'
                : '外部アプリに開示中 (vault.use が無効か secret 未設定でまだ使えません)'
            "
          >
            <i class="ti ti-plug" />
          </span>
          <img
            v-if="faviconUrl(conn.baseUrl) && !failedIcons.has(conn.id)"
            :src="faviconUrl(conn.baseUrl)!"
            :class="$style.logo"
            alt=""
            @error="failedIcons.add(conn.id)"
          />
          <i
            v-else
            class="ti ti-plug-connected"
            :class="$style.logoFallback"
          />
          <span>{{ conn.name }}</span>
        </button>
      </div>
    </template>
  </div>
</template>

<style lang="scss" module>
.content {
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 8px;
}

.sectionTitle {
  margin: 8px 0 2px;
  font-size: 0.85em;
  color: var(--nd-fgMuted);
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 8px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 0.8em;
  cursor: pointer;
  text-align: center;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
}

.addCard {
  border: 1px dashed var(--nd-divider);
  background: transparent;
}

.logo {
  width: 22px;
  height: 22px;
  object-fit: contain;
  border-radius: 4px;
}

.logoFallback {
  font-size: 22px;
  color: var(--nd-fgMuted);
}

.connBadge {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  font-size: 12px;

  i {
    font-size: 12px;
  }
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
