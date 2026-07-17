<script setup lang="ts">
declare const __APP_VERSION__: string
const appVersion = __APP_VERSION__
</script>

<template>
  <div :class="$style.page">
    <div :class="$style.blob1" />
    <div :class="$style.blob2" />
    <div :class="$style.center">
      <img
        src="https://raw.githubusercontent.com/notedeck-dev/notedeck/main/src-tauri/icons/128x128%402x.png"
        alt="NoteDeck"
        :class="$style.icon"
      />
      <h1 :class="$style.title">Note<span>Deck</span></h1>
      <p :class="$style.tagline">Misskey Pro — Misskey廃人のための Misskey IDE</p>
      <div :class="$style.notice">
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
  --accent: #86b300;
  --accent2: #4ab300;
  --bg: #161616;
  --text: #e8e8e8;
  --muted: #888;
  --surface: rgba(255, 255, 255, 0.05);
  --border: rgba(255, 255, 255, 0.08);
  --ease: cubic-bezier(0.22, 1, 0.36, 1);

  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

@media (prefers-color-scheme: light) {
  .page {
    --bg: #f8f8f8;
    --text: #1a1a1a;
    --muted: #777;
    --surface: rgba(0, 0, 0, 0.03);
    --border: rgba(0, 0, 0, 0.08);
  }
}

.blob1,
.blob2 {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}

.blob1 {
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, rgba(134, 179, 0, 0.12), transparent 70%);
  top: -200px;
  right: -150px;
  animation: blobFloat 20s ease-in-out infinite alternate;
}

.blob2 {
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(74, 179, 0, 0.08), transparent 70%);
  bottom: -150px;
  left: -150px;
  animation: blobFloat 25s ease-in-out infinite alternate-reverse;
}

@keyframes blobFloat {
  0% { transform: translate(0, 0) scale(1) }
  100% { transform: translate(30px, -20px) scale(1.08) }
}

.center {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 2rem;
}

.center > * {
  opacity: 0;
  transform: translateY(16px);
  animation: fadeUp 0.7s var(--ease) forwards;
}

.center > *:nth-child(1) { animation-delay: 0s }
.center > *:nth-child(2) { animation-delay: 0.1s }
.center > *:nth-child(3) { animation-delay: 0.2s }
.center > *:nth-child(4) { animation-delay: 0.3s }
.center > *:nth-child(5) { animation-delay: 0.4s }

@keyframes fadeUp {
  to { opacity: 1; transform: translateY(0) }
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

  span {
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
}

.tagline {
  color: var(--muted);
  font-size: 1.05rem;
}

.notice {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 1.25rem 1.75rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  p {
    color: var(--muted);
    font-size: 0.9rem;
  }
}

.cmd {
  background: rgba(134, 179, 0, 0.08);
  border-radius: 8px;
  padding: 0.5rem 1rem;

  code {
    font-family: 'SF Mono', Monaco, Consolas, 'Liberation Mono', monospace;
    font-size: 0.9rem;
    color: var(--accent);
    font-weight: 600;
  }
}

.prompt {
  color: var(--muted);
  user-select: none;
  margin-right: 0.5rem;
}

.version {
  color: var(--muted);
  font-size: 0.8rem;
  opacity: 0.6;
}
</style>
