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
import { useDeveloperMode } from '@/composables/useDeveloperMode'
import { useDoubleConfirm } from '@/composables/useDoubleConfirm'
import { useTutorialStore } from '@/composables/useTutorial'
import {
  buildTutorialSteps,
  TUTORIAL_CATEGORIES,
  type TutorialCategoryId,
  tutorialDocsUrl,
} from '@/data/tutorialSteps'
import { isExposed } from '@/settings/exposure'
import { openSafeUrl } from '@/utils/url'

const tutorial = useTutorialStore()
const resetConfirm = useDoubleConfirm()

const { setEnabled: setDeveloperMode } = useDeveloperMode()

/** ロックされたカテゴリの案内先を開放する */
function unlockDeveloperCategories(): void {
  setDeveloperMode(true)
}

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
      // 案内先の面が隠れているカテゴリは開放待ち (#1034)
      locked: !isExposed(category.exposure),
      complete: doneCount === items.length,
      running: tutorial.active && tutorial.runningCategoryId === category.id,
    }
  })
})

/** 次に手をつけるカテゴリ (先頭の未完了)。順路を 1 つだけ指し示す */
const nextCategoryId = computed(
  () => groups.value.find((g) => !g.complete && !g.locked)?.category.id ?? null,
)

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
  // 走らせたカテゴリは開いたままにする。既定の追従に任せると、最後の項目を
  // 達成した瞬間に畳まれ、押していたボタンごとレイアウトが動く
  userToggled.value = true
  openedId.value = id
  tutorial.startCategory(id)
}

function openDocs(path: string): void {
  openSafeUrl(tutorialDocsUrl(path))
}
</script>

<template>
  <div :class="$style.root">
    <header :class="$style.head">
      <p :class="$style.lead">
        操作するとチェックが付きます。カテゴリを終えると実績になり、通知に届きます。
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
          <span :class="$style.groupCount">
            <i v-if="group.locked" class="ti ti-lock" />
            <template v-else>{{ group.doneCount }}/{{ group.items.length }}</template>
          </span>
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
          <button
            type="button"
            class="_button"
            :class="$style.linkBtn"
            @click="openDocs(group.category.docsPath)"
          >
            読む
          </button>
          <button
            v-if="group.running"
            type="button"
            class="_button"
            :class="$style.runBtn"
            @click="tutorial.focusCard()"
          >
            案内を表示
          </button>
          <button
            v-else-if="group.locked"
            type="button"
            class="_button"
            :class="$style.runBtn"
            title="このカテゴリで案内する機能を表示する"
            @click="unlockDeveloperCategories"
          >
            開発者モードで開放
          </button>
          <button
            v-else
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




/* ヘッダ */
.head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--nd-divider);
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
