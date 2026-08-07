<script setup lang="ts">
import { onMounted, ref } from 'vue'

/**
 * ブラウザ (`pnpm dev`) で開いたときのフォールバック画面 兼
 * 開発ダッシュボード (#977) の入口。
 *
 * Vite の dev proxy (vite.config.ts) が内蔵 HTTP サーバー (19820, #940) へ
 * Bearer 注入付きで橋渡しするので、ここからは相対パスの fetch で external API
 * を叩ける。実行中のアプリが見つかれば疎通状態を表示する。
 *
 * ここは製品画面ではないが、アプリのトークン (`--nd-*`) をそのまま使う。
 * 独自のカラーパレットを持たせると、テーマを変えたときにここだけ取り残される。
 */
declare const __APP_VERSION__: string
const appVersion = __APP_VERSION__

const connected = ref(false)
const columnCount = ref<number | null>(null)

onMounted(async () => {
  try {
    const index = await fetch('/api')
    if (!index.ok) return
    connected.value = true
    const cols = await fetch('/api/deck/columns')
    if (cols.ok) {
      const data: unknown = await cols.json()
      if (Array.isArray(data)) columnCount.value = data.length
    }
  } catch {
    // アプリ未起動 (proxy 先が居ない) — 起動案内の表示を維持する
  }
})
</script>

<template>
  <div :class="$style.page">
    <div :class="$style.center">
      <img src="/favicon.svg" alt="" :class="$style.icon" />
      <h1 :class="$style.title">NoteDeck</h1>
      <p :class="$style.tagline">Misskey Pro — Misskey廃人のための Misskey IDE</p>
      <div v-if="connected" :class="$style.notice">
        <p :class="$style.connectedRow">
          <span :class="$style.dot" />
          実行中のアプリに接続しています<template v-if="columnCount !== null"> — カラム {{ columnCount }} 本</template>
        </p>
        <a :class="$style.docsLink" href="/api/docs" target="_blank" rel="noopener">
          API ドキュメント (Scalar) を開く
        </a>
      </div>
      <div v-else :class="$style.notice">
        <p>デスクトップアプリとして起動してください</p>
        <div :class="$style.cmd">
          <code><span :class="$style.prompt">$</span> pnpm tauri:dev</code>
        </div>
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

.connectedRow {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--nd-success, #6c6);
  flex: none;
}

.docsLink {
  color: var(--nd-accent);
  font-size: 0.9rem;

  &:hover {
    text-decoration: underline;
  }
}

.version {
  color: var(--nd-fg);
  opacity: 0.4;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}
</style>
