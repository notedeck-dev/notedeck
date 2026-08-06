<script setup lang="ts">
import { computed } from 'vue'
import { useAiConfig } from '@/composables/useAiConfig'
import { useSkillsStore } from '@/stores/skills'
import { isProxiable, proxyCssUrl } from '@/utils/mediaProxy'
import AiSettingsSection from './AiSettingsSection.vue'

const { config } = useAiConfig()

// Persona (#491) — `isPersona: true` な skill 一覧をセレクタ候補として提供。
// 値は SkillMeta.id (raw)。AI チャット側で `skill:<id>` プレフィックスを付けて
// resolveIdentity に渡す。空文字 = persona なし (汎用 AI)。
const skillsStore = useSkillsStore()
skillsStore.ensureLoaded()
const personaCandidates = computed(() =>
  skillsStore.skills.filter((s) => s.isPersona),
)
const currentPersonaSkill = computed(() => {
  const id = config.value.personaSkillId
  if (!id) return null
  const s = skillsStore.get(id)
  return s?.isPersona ? s : null
})
</script>

<template>
  <AiSettingsSection
    icon="ti-user-circle"
    title="ペルソナ"
    :badge="currentPersonaSkill ? currentPersonaSkill.name : 'なし'"
  >
    <div :class="$style.keyHint">
      <i class="ti ti-info-circle" />
      新規セッションのデフォルトです。過去のセッションは作成時のペルソナを保持します。
    </div>
    <div :class="$style.grid">
      <button
        class="_button"
        :class="[$style.card, { [$style.cardActive]: !config.personaSkillId }]"
        :aria-pressed="!config.personaSkillId"
        @click="config.personaSkillId = ''"
      >
        <span v-if="!config.personaSkillId" :class="$style.activeBadge">
          <i class="ti ti-circle-check-filled" />
        </span>
        <i class="ti ti-user-off" :class="$style.logoFallback" />
        <span>なし</span>
      </button>
      <button
        v-for="s in personaCandidates"
        :key="s.id"
        class="_button"
        :class="[$style.card, { [$style.cardActive]: config.personaSkillId === s.id }]"
        :aria-pressed="config.personaSkillId === s.id"
        :title="s.description || s.name"
        @click="config.personaSkillId = s.id"
      >
        <span v-if="config.personaSkillId === s.id" :class="$style.activeBadge">
          <i class="ti ti-circle-check-filled" />
        </span>
        <!-- SVG icon を accent 色で render (DeckAiColumn.personaIndicator と同じ
             mask + currentColor パターン) -->
        <span
          v-if="isProxiable(s.iconUrl)"
          :class="$style.logo"
          :style="{ '--icon-url': proxyCssUrl(s.iconUrl, 48) }"
          aria-hidden="true"
        />
        <i v-else class="ti ti-user-circle" :class="$style.logoFallback" />
        <span>{{ s.name }}</span>
      </button>
    </div>
    <div v-if="personaCandidates.length === 0" :class="$style.personaEmpty">
      <i class="ti ti-info-circle" />
      <span>
        ペルソナ候補がありません。Skill 編集ウィンドウで「Persona」を ON にしたスキルがここに表示されます。
      </span>
    </div>
  </AiSettingsSection>
</template>

<style lang="scss" module>
.keyHint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7em;
  opacity: 0.5;
}

// --- Persona selector (#491) ---
// 「接続」ウィンドウ (ConnectionsContent) のカードグリッドと同じ見た目に揃える

.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

// `_button` と特異度が同点だと WebView2 で display: inline-block に負けるため (0,2,0) に上げる
.card.card {
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

// 選択中のペルソナ。ConnectionsContent には無い状態なのでアクセントで示す
.cardActive.cardActive {
  background: color-mix(in srgb, var(--nd-accent) 12%, var(--nd-buttonBg));
  box-shadow: inset 0 0 0 1px var(--nd-accent);
}

.activeBadge {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  color: var(--nd-accent);

  i {
    font-size: 12px;
  }
}

// SVG mask + currentColor でテーマアクセント色化 (DeckAiColumn.personaIndicator
// と同じパターン)。ラスタ画像は表示できないが、persona icon は SVG 前提。
.logo {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  background-color: currentColor;
  color: var(--nd-accent);
  -webkit-mask: var(--icon-url) center / contain no-repeat;
  mask: var(--icon-url) center / contain no-repeat;
}

.logoFallback {
  font-size: 22px;
  color: var(--nd-fgMuted);
}

.personaEmpty {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 10px;
  font-size: 0.75em;
  color: var(--nd-fg);
  opacity: 0.6;
  line-height: 1.5;

  i {
    flex-shrink: 0;
    margin-top: 1px;
  }
}
</style>
