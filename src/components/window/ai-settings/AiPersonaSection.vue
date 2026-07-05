<script setup lang="ts">
import { computed } from 'vue'
import { useAiConfig } from '@/composables/useAiConfig'
import { useSkillsStore } from '@/stores/skills'
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
      **新規セッション**のデフォルトペルソナです。新しいチャット / heartbeat / task を開始したときに、ここで選んだペルソナが session に snapshot されます。**過去のセッション**は作成時のペルソナを保持し続けるため (Git commit の Author と同じ immutable semantic)、ここを変更しても遡って書き換わりません。
    </div>
    <div :class="$style.personaList">
      <label :class="[$style.personaOption, { [$style.personaOptionActive]: !config.personaSkillId }]">
        <input
          type="radio"
          :checked="!config.personaSkillId"
          @change="config.personaSkillId = ''"
        />
        <i class="ti ti-user-off" :class="$style.personaOptionIcon" />
        <span :class="$style.personaOptionName">ペルソナなし (汎用 AI)</span>
      </label>
      <label
        v-for="s in personaCandidates"
        :key="s.id"
        :class="[$style.personaOption, { [$style.personaOptionActive]: config.personaSkillId === s.id }]"
      >
        <input
          type="radio"
          :checked="config.personaSkillId === s.id"
          @change="config.personaSkillId = s.id"
        />
        <!-- SVG icon を accent 色で render (DeckAiColumn.personaIndicator と同じ
             mask + currentColor パターン) -->
        <span
          v-if="s.iconUrl"
          :class="$style.personaOptionAvatar"
          :style="{ '--icon-url': `url('${s.iconUrl}')` }"
          :title="s.name"
          aria-hidden="true"
        />
        <i v-else class="ti ti-user-circle" :class="$style.personaOptionIcon" />
        <div :class="$style.personaOptionMain">
          <div :class="$style.personaOptionName">{{ s.name }}</div>
          <div v-if="s.description" :class="$style.personaOptionDesc">
            {{ s.description }}
          </div>
        </div>
      </label>
      <div v-if="personaCandidates.length === 0" :class="$style.personaEmpty">
        <i class="ti ti-info-circle" />
        <span>
          ペルソナ候補がありません。Skill 編集ウィンドウで「Persona」を ON にしたスキルがここに表示されます。
        </span>
      </div>
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

.personaList {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.personaOption {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--nd-radius-sm);
  cursor: pointer;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  input[type='radio'] {
    flex-shrink: 0;
    margin: 0;
  }
}

.personaOptionActive {
  background: color-mix(in srgb, var(--nd-accent) 10%, transparent);

  &:hover {
    background: color-mix(in srgb, var(--nd-accent) 14%, transparent);
  }
}

.personaOptionIcon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--nd-fg);
  opacity: 0.6;
  flex-shrink: 0;
}

// SVG mask + currentColor でテーマアクセント色化 (DeckAiColumn.personaIndicator
// と同じパターン)。ラスタ画像は表示できないが、persona icon は SVG 前提。
.personaOptionAvatar {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  background-color: currentColor;
  color: var(--nd-accent);
  -webkit-mask: var(--icon-url) center / contain no-repeat;
  mask: var(--icon-url) center / contain no-repeat;
}

.personaOptionMain {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.personaOptionName {
  font-size: 0.85em;
  font-weight: 500;
  color: var(--nd-fg);
}

.personaOptionDesc {
  font-size: 0.7em;
  color: var(--nd-fg);
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
