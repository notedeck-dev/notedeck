<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import DevDashboard from '@/components/dev/DevDashboard.vue'

/**
 * ブラウザ (`pnpm dev`) で開いたときのフォールバック画面 兼
 * 開発ダッシュボード (#977) の入口。
 *
 * Vite の dev proxy (vite.config.ts) が内蔵 HTTP サーバー (19820, #940) へ
 * Bearer 注入付きで橋渡しするので、ここからは相対パスの fetch で external API
 * を叩ける。実行中のアプリが見つかればダッシュボードに切り替える。
 *
 * ここは製品画面ではないが、アプリのトークン (`--nd-*`) をそのまま使う。
 * 独自のカラーパレットを持たせると、テーマを変えたときにここだけ取り残される。
 */
declare const __APP_VERSION__: string
const appVersion = __APP_VERSION__

const connected = ref(false)
let probeTimer: ReturnType<typeof setTimeout> | null = null

// アプリ起動待ちポーリング: tauri:dev の起動を検知したら自動でダッシュボードへ
async function probe() {
  try {
    const index = await fetch('/api')
    if (index.ok) {
      connected.value = true
      return
    }
  } catch {
    // アプリ未起動 (proxy 先が居ない)
  }
  probeTimer = setTimeout(probe, 3000)
}

onMounted(probe)
onUnmounted(() => {
  if (probeTimer) clearTimeout(probeTimer)
})
</script>

<template>
  <div :class="$style.page">
    <DevDashboard v-if="connected" />
    <div v-else :class="$style.center">
      <img src="/favicon.svg" alt="" :class="$style.icon" />
      <h1 :class="$style.title">NoteDeck</h1>
      <p :class="$style.tagline">Misskey Pro — Misskey廃人のための Misskey IDE</p>
      <div :class="$style.notice">
        <p>デスクトップアプリとして起動してください</p>
        <div :class="$style.cmd">
          <code><span :class="$style.prompt">$</span> pnpm tauri:dev</code>
        </div>
        <p :class="$style.hint">起動を検知すると自動で Dev Dashboard に切り替わります</p>
      </div>
      <p :class="$style.version">v{{ appVersion }}</p>
    </div>
  </div>
</template>

<style lang="scss" module>
.page {
  height: 100%;
  overflow: hidden;
  background: var(--nd-bg);
  color: var(--nd-fg);
}

.center {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 32px;
}

.icon {
  width: 72px;
  height: 72px;
  border-radius: 18px;
}

.title {
  font-size: 2.5rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--nd-fgHighlighted);
}

.tagline {
  color: var(--nd-fg);
  opacity: 0.65;
  font-size: 1.05rem;
}

.notice {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 28px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius);
  background: var(--nd-panel);
  text-align: center;

  p {
    color: var(--nd-fg);
    opacity: 0.65;
    font-size: 0.9rem;
  }
}

.cmd {
  padding: 8px 16px;
  border-radius: var(--nd-radius-md);
  background: var(--nd-buttonBg);

  code {
    font-family: var(--nd-font-mono);
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--nd-accent);
  }
}

.prompt {
  color: var(--nd-fg);
  opacity: 0.5;
  user-select: none;
  margin-right: 0.5rem;
}

.hint {
  font-size: 0.75rem;
  opacity: 0.45;
}

.version {
  color: var(--nd-fg);
  opacity: 0.4;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}
</style>
