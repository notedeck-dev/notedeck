<script setup lang="ts">
/**
 * TutorialEditorContent — チュートリアル (#1029)。
 *
 * カテゴリ別のチェックリスト。読むだけのガイドにはせず、実際に操作すると
 * チェックが付く。カテゴリを完走すると NoteDeck 独自の実績が解除され、
 * 達成は tutorial.json5 に永続化される。
 *
 * カテゴリの区切りと並びは公式ドキュメントのサイドバーに揃えてあり、各項目
 * から対応するページを開ける (アプリで触る順序 = 読み進める順序)。
 *
 * 進捗の見せ方は「今どこまで来たか」に留める。未達成の数を煽らない
 * (回数・連続日数系の実績を作らないのと同じ理由)。
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useDoubleConfirm } from '@/composables/useDoubleConfirm'
import { useTutorialStore } from '@/composables/useTutorial'
import {
  buildTutorialSteps,
  TUTORIAL_CATEGORIES,
  type TutorialCategoryId,
  tutorialDocsUrl,
} from '@/data/tutorialSteps'
import { openSafeUrl } from '@/utils/url'

const tutorial = useTutorialStore()
const resetConfirm = useDoubleConfirm()

/** カテゴリごとの項目と達成状況 */
const groups = computed(() => {
  const all = buildTutorialSteps()
  return TUTORIAL_CATEGORIES.map((category, index) => {
    const items = all
      .filter((s) => s.category === category.id)
      .map((step) => ({
        id: step.id,
        title: step.title,
        docsPath: step.docsPath,
        done: tutorial.isStepDone(step),
      }))
    const doneCount = items.filter((i) => i.done).length
    return {
      category,
      step: index + 1,
      items,
      doneCount,
      complete: doneCount === items.length,
      unlockedAt: tutorial.progress.achievements[category.id] ?? null,
    }
  })
})

/** 次に手をつけるカテゴリ (先頭の未完了)。順路を 1 つだけ指し示す */
const nextCategoryId = computed(
  () => groups.value.find((g) => !g.complete)?.category.id ?? null,
)

const unlockedCount = computed(
  () => groups.value.filter((g) => g.unlockedAt != null).length,
)

/** 解除の知らせに出すカテゴリ */
const unlockedNotice = computed(() => {
  const id = tutorial.justUnlocked
  if (!id) return null
  return TUTORIAL_CATEGORIES.find((c) => c.id === id) ?? null
})

/**
 * 開いているカテゴリ。既定は「次にやる 1 つ」だけ。
 * 全カテゴリの項目を一度に見せると、やることが多く見えて選べなくなる。
 */
const openedId = ref<TutorialCategoryId | null>(null)
/** ユーザーが自分で開閉したら、以降は既定の追従をやめる */
const userToggled = ref(false)

function toggleGroup(id: TutorialCategoryId): void {
  userToggled.value = true
  openedId.value = openedId.value === id ? null : id
}

// 達成が進んで「次にやるカテゴリ」が変わったら、そこを開いて示す
watch(
  nextCategoryId,
  (id) => {
    if (!userToggled.value) openedId.value = id
  },
  { immediate: true },
)

onMounted(async () => {
  await tutorial.loadProgress()
  tutorial.syncProgress()
})

function runCategory(id: TutorialCategoryId): void {
  tutorial.startCategory(id)
}

function openDocs(path: string): void {
  openSafeUrl(tutorialDocsUrl(path))
}

function formatDate(at: number): string {
  return new Date(at).toLocaleDateString()
}
</script>

<template>
  <div :class="$style.root">
    <!-- 実績の解除。トーストは数秒で消えて「習熟の記録」に合わないので、
         開いている間は残る行として出す -->
    <div v-if="unlockedNotice" :class="$style.notice">
      <span :class="$style.noticeEmoji">{{ unlockedNotice.achievementEmoji }}</span>
      <span :class="$style.noticeText">
        <strong>{{ unlockedNotice.achievementName }}</strong> を達成しました
      </span>
      <button
        type="button"
        class="_button"
        :class="$style.iconBtn"
        title="閉じる"
        @click="tutorial.clearJustUnlocked()"
      >
        <i class="ti ti-x" />
      </button>
    </div>

    <header :class="$style.head">
      <div :class="$style.trophies">
        <span
          v-for="group in groups"
          :key="group.category.id"
          :class="[$style.trophy, { [$style.trophyOn]: group.unlockedAt != null }]"
          :title="group.unlockedAt != null
            ? `${group.category.achievementName} — ${formatDate(group.unlockedAt)}`
            : `${group.category.achievementName} (未達成)`"
        >{{ group.category.achievementEmoji }}</span>
        <span :class="$style.trophyCount">{{ unlockedCount }} / {{ groups.length }}</span>
      </div>
      <p :class="$style.lead">
        操作するとチェックが付きます。カテゴリを終えると実績になります。
      </p>
      <button type="button" class="_button" :class="$style.docsBtn" @click="openDocs('/docs/')">
        <i class="ti ti-book" />
        ドキュメントを読む
      </button>
    </header>

    <ol :class="$style.groups">
      <li
        v-for="group in groups"
        :key="group.category.id"
        :class="[
          $style.group,
          {
            [$style.groupNext]: group.category.id === nextCategoryId,
            [$style.groupDone]: group.complete,
          },
        ]"
      >
        <button
          type="button"
          class="_button"
          :class="$style.groupHead"
          :aria-expanded="openedId === group.category.id"
          @click="toggleGroup(group.category.id)"
        >
          <span :class="$style.stepNo">
            <i v-if="group.complete" class="ti ti-check" />
            <template v-else>{{ group.step }}</template>
          </span>
          <span :class="$style.groupTitles">
            <span :class="$style.groupTitle">{{ group.category.title }}</span>
            <span :class="$style.groupDesc">{{ group.category.description }}</span>
          </span>
          <span :class="$style.groupCount">{{ group.doneCount }}/{{ group.items.length }}</span>
          <i
            :class="[
              'ti ti-chevron-down',
              $style.chevron,
              { [$style.chevronOpen]: openedId === group.category.id },
            ]"
          />
        </button>

        <ul v-if="openedId === group.category.id" :class="$style.items">
          <li v-for="item in group.items" :key="item.id" :class="$style.item">
            <i
              :class="[
                item.done ? 'ti ti-circle-check-filled' : 'ti ti-circle',
                $style.check,
                { [$style.checkDone]: item.done },
              ]"
            />
            <span :class="[$style.itemTitle, { [$style.itemDone]: item.done }]">
              {{ item.title }}
            </span>
            <button
              v-if="item.docsPath"
              type="button"
              class="_button"
              :class="$style.iconBtn"
              title="このステップの解説を読む"
              @click="openDocs(item.docsPath)"
            >
              <i class="ti ti-external-link" />
            </button>
          </li>
        </ul>

        <div v-if="openedId === group.category.id" :class="$style.groupFoot">
          <span v-if="group.unlockedAt != null" :class="$style.award">
            <span :class="$style.awardEmoji">{{ group.category.achievementEmoji }}</span>
            {{ group.category.achievementName }}
            <span :class="$style.awardDate">{{ formatDate(group.unlockedAt) }}</span>
          </span>
          <button
            type="button"
            class="_button"
            :class="$style.linkBtn"
            @click="openDocs(group.category.docsPath)"
          >
            読む
          </button>
          <button
            type="button"
            class="_button"
            :class="$style.runBtn"
            @click="runCategory(group.category.id)"
          >
            {{ group.complete ? 'もう一度' : group.doneCount === 0 ? 'はじめる' : '続きから' }}
          </button>
        </div>
      </li>
    </ol>

    <footer :class="$style.footer">
      <button
        type="button"
        class="_button"
        :class="[$style.resetBtn, { [$style.resetArmed]: resetConfirm.confirming.value }]"
        @click="resetConfirm.trigger(() => tutorial.resetProgress())"
      >
        {{ resetConfirm.confirming.value ? 'もう一度押すと消えます' : '達成記録を消す' }}
      </button>
    </footer>
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex-direction: column;
  // モバイルはウィンドウが画面高いっぱいに広がるため、中身側でスクロールさせる
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  gap: 12px;
  padding: 14px 16px 12px;
  color: var(--nd-fg);
  font-size: 0.92em;
}

/* 実績解除の知らせ */
.notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--nd-accentedBg);
  color: var(--nd-accent);
}

.noticeEmoji {
  font-size: 1.2em;
  line-height: 1;
}

.noticeText {
  flex: 1;
  min-width: 0;
  font-size: 0.9em;
}

/* ヘッダ: 実績の並び + 導入 */
.head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--nd-divider);
}

.trophies {
  display: flex;
  align-items: center;
  gap: 6px;
}

.trophy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--nd-buttonBg);
  font-size: 0.95em;
  line-height: 1;
  filter: grayscale(1);
  opacity: 0.4;
  transition:
    filter var(--nd-duration, 0.2s) var(--nd-ease-decel),
    opacity var(--nd-duration, 0.2s) var(--nd-ease-decel);
}

.trophyOn {
  filter: none;
  opacity: 1;
  background: var(--nd-eventAchievement, var(--nd-accentedBg));
}

.trophyCount {
  margin-left: auto;
  font-size: 0.85em;
  opacity: 0.6;
  letter-spacing: 0.04em;
}

.lead {
  margin: 0;
  line-height: 1.6;
  font-size: 0.88em;
  opacity: 0.75;
}

.docsBtn {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 0.85em;
  color: var(--nd-fg);
  opacity: 0.75;
  cursor: pointer;
  transition:
    opacity 0.15s var(--nd-ease-decel),
    background 0.15s var(--nd-ease-decel);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

/* カテゴリ */
.groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--nd-divider);
  border-radius: 10px;
  transition: border-color 0.2s var(--nd-ease-decel);
}

/* 次に手をつける 1 つだけを指し示す */
.groupNext {
  border-color: var(--nd-accent);
}

.groupDone {
  opacity: 0.72;
}

.groupHead {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 0;
  text-align: left;
  color: inherit;
  cursor: pointer;
  border-radius: 6px;
  transition: opacity 0.15s var(--nd-ease-decel);

  &:hover {
    opacity: 0.85;
  }
}

.chevron {
  flex: none;
  font-size: 0.95em;
  opacity: 0.45;
  transition: transform 0.2s var(--nd-ease-decel);
}

.chevronOpen {
  transform: rotate(180deg);
}

.stepNo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 22px;
  height: 22px;
  margin-top: 1px;
  border-radius: 50%;
  background: var(--nd-buttonBg);
  font-size: 0.8em;
  font-weight: 600;
  opacity: 0.75;
}

.groupDone .stepNo {
  background: var(--nd-accentedBg);
  color: var(--nd-accent);
  opacity: 1;
}

.groupTitles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.groupTitle {
  font-weight: 600;
  color: var(--nd-fgHighlighted);
}

.groupDesc {
  font-size: 0.85em;
  line-height: 1.4;
  opacity: 0.65;
}

.groupCount {
  flex: none;
  font-size: 0.82em;
  opacity: 0.55;
  letter-spacing: 0.03em;
}

.items {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0 0 0 32px;
  list-style: none;
}

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}

.check {
  flex: none;
  font-size: 1.05em;
  opacity: 0.3;
}

.checkDone {
  color: var(--nd-accent);
  opacity: 1;
}

.itemTitle {
  flex: 1;
  min-width: 0;
  font-size: 0.92em;
}

.itemDone {
  opacity: 0.6;
}

.iconBtn {
  flex: none;
  padding: 3px 6px;
  border-radius: 5px;
  color: var(--nd-fg);
  opacity: 0.45;
  cursor: pointer;
  transition:
    opacity 0.15s var(--nd-ease-decel),
    background 0.15s var(--nd-ease-decel);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.groupFoot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 32px;
}

.award {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.82em;
  color: var(--nd-accent);
}

.awardEmoji {
  font-size: 1.05em;
  line-height: 1;
}

.awardDate {
  opacity: 0.6;
  color: var(--nd-fg);
}

.linkBtn {
  margin-left: auto;
  padding: 5px 12px;
  font-size: 0.85em;
  border-radius: 6px;
  color: var(--nd-fg);
  opacity: 0.7;
  cursor: pointer;
  transition:
    opacity 0.15s var(--nd-ease-decel),
    background 0.15s var(--nd-ease-decel);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.runBtn {
  padding: 5px 14px;
  font-size: 0.85em;
  font-weight: 600;
  border-radius: 6px;
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent, #fff);
  cursor: pointer;
  transition: filter 0.15s var(--nd-ease-decel);

  &:hover {
    filter: brightness(1.08);
  }
}

.footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 6px;
  border-top: 1px solid var(--nd-divider);
}

.resetBtn {
  padding: 5px 12px;
  font-size: 0.82em;
  border-radius: 6px;
  color: var(--nd-fg);
  opacity: 0.55;
  cursor: pointer;
  transition:
    opacity 0.15s var(--nd-ease-decel),
    background 0.15s var(--nd-ease-decel),
    color 0.15s var(--nd-ease-decel);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.resetArmed {
  opacity: 1;
  color: var(--nd-error);
  background: var(--nd-buttonHoverBg);
}
</style>
