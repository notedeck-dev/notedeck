<script setup lang="ts">
defineProps<{
  isDark: boolean
  isFollowingSystem: boolean
}>()

const emit = defineEmits<{
  'toggle-dark': []
  'toggle-sync': [checked: boolean]
}>()

function onSyncChange(e: Event) {
  emit('toggle-sync', (e.target as HTMLInputElement).checked)
}
</script>

<template>
  <div :class="$style.themePanel">
    <div :class="$style.toggleArea">
      <div :class="$style.toggleInner">
        <button :class="[$style.dayNightToggle, { [$style.checked]: isDark }]" :aria-label="isDark ? 'ライトモードに切替' : 'ダークモードに切替'" @click="emit('toggle-dark')">
          <span :class="$style.labelBefore">ライト</span>
          <span :class="$style.labelAfter">ダーク</span>
          <span :class="$style.toggleHandler">
            <span :class="[$style.crater, $style.crater1]" />
            <span :class="[$style.crater, $style.crater2]" />
            <span :class="[$style.crater, $style.crater3]" />
          </span>
          <span :class="[$style.star, $style.star1]" />
          <span :class="[$style.star, $style.star2]" />
          <span :class="[$style.star, $style.star3]" />
          <span :class="[$style.star, $style.star4]" />
          <span :class="[$style.star, $style.star5]" />
          <span :class="[$style.star, $style.star6]" />
        </button>
      </div>
    </div>
    <div :class="$style.syncArea">
      <label :class="$style.syncLabel">
        <span :class="[$style.syncToggle, { [$style.active]: isFollowingSystem }]">
          <input type="checkbox" :checked="isFollowingSystem" @change="onSyncChange" />
          <span :class="$style.syncToggleTrack">
            <span :class="$style.syncToggleKnob" />
          </span>
        </span>
        <span :class="$style.syncText">デバイスのダークモードに同期</span>
      </label>
    </div>
  </div>
</template>

<style lang="scss" module>
.themePanel {
  border-radius: var(--nd-radius-sm);
}

.toggleArea {
  position: relative;
  padding: 26px 0;
  text-align: center;
}

.toggleInner {
  display: inline-block;
  text-align: left;
  padding: 0 66px;
  vertical-align: bottom;
}

.dayNightToggle {
  cursor: pointer;
  display: inline-block;
  position: relative;
  width: 90px;
  height: 50px;
  margin: 4px;
  padding: 0;
  border: none;
  font: inherit;
  text-align: left;
  background-color: #83d8ff;
  border-radius: 84px;
  transition: background-color 200ms cubic-bezier(0.445, 0.05, 0.55, 0.95);

  &.checked {
    background-color: #749dd6;
  }
}

.checked { /* modifier */ }

.labelBefore,
.labelAfter {
  position: absolute;
  top: 15px;
  transition: color 1s ease;
  font-size: 0.85em;
  user-select: none;
  white-space: nowrap;
}

.labelBefore {
  left: -58px;
  color: var(--nd-accent);

  .checked & {
    color: var(--nd-fg);
  }
}

.labelAfter {
  right: -56px;
  color: var(--nd-fg);

  .checked & {
    color: var(--nd-accent);
  }
}

.toggleHandler {
  display: inline-block;
  position: relative;
  z-index: 1;
  top: 3px;
  left: 3px;
  width: 44px;
  height: 44px;
  background-color: #ffcf96;
  border-radius: 50px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  transition: background-color 400ms cubic-bezier(0.68, -0.55, 0.265, 1.55), transform 400ms cubic-bezier(0.68, -0.55, 0.265, 1.55);
  transform: rotate(-45deg);

  .checked & {
    background-color: #ffe5b5;
    transform: translate3d(40px, 0, 0) rotate(0);
  }
}

.crater {
  position: absolute;
  background-color: #e8cda5;
  opacity: 0;
  transition: opacity 200ms ease-in-out;
  border-radius: 100%;

  .checked & {
    opacity: 1;
  }
}

.crater1 { top: 18px; left: 10px; width: 4px; height: 4px; }
.crater2 { top: 28px; left: 22px; width: 6px; height: 6px; }
.crater3 { top: 10px; left: 25px; width: 8px; height: 8px; }

.star {
  position: absolute;
  width: 30px;
  height: 3px;
  background-color: #fff;
  transition: width 300ms cubic-bezier(0.445, 0.05, 0.55, 0.95), height 300ms cubic-bezier(0.445, 0.05, 0.55, 0.95), transform 300ms cubic-bezier(0.445, 0.05, 0.55, 0.95);
  border-radius: 50%;
}

.star1 {
  top: 10px; left: 35px; z-index: 0;
  .checked & { width: 2px; height: 2px; }
}

.star2 {
  top: 18px; left: 28px; z-index: 1;
  .checked & { width: 4px; height: 4px; transform: translate3d(-5px, 0, 0); }
}

.star3 {
  top: 27px; left: 40px; z-index: 0;
  .checked & { width: 2px; height: 2px; transform: translate3d(-7px, 0, 0); }
}

.star4, .star5, .star6 {
  opacity: 0;
  transition: opacity 300ms 0ms cubic-bezier(0.445, 0.05, 0.55, 0.95), transform 300ms 0ms cubic-bezier(0.445, 0.05, 0.55, 0.95);
}

.star4 {
  top: 16px; left: 11px; z-index: 0; width: 2px; height: 2px;
  transform: translate3d(3px, 0, 0);
  .checked & { opacity: 1; transform: translate3d(0, 0, 0); transition: opacity 300ms 200ms cubic-bezier(0.445, 0.05, 0.55, 0.95), transform 300ms 200ms cubic-bezier(0.445, 0.05, 0.55, 0.95); }
}

.star5 {
  top: 32px; left: 17px; z-index: 0; width: 3px; height: 3px;
  transform: translate3d(3px, 0, 0);
  .checked & { opacity: 1; transform: translate3d(0, 0, 0); transition: opacity 300ms 300ms cubic-bezier(0.445, 0.05, 0.55, 0.95), transform 300ms 300ms cubic-bezier(0.445, 0.05, 0.55, 0.95); }
}

.star6 {
  top: 36px; left: 28px; z-index: 0; width: 2px; height: 2px;
  transform: translate3d(3px, 0, 0);
  .checked & { opacity: 1; transform: translate3d(0, 0, 0); transition: opacity 300ms 400ms cubic-bezier(0.445, 0.05, 0.55, 0.95), transform 300ms 400ms cubic-bezier(0.445, 0.05, 0.55, 0.95); }
}

.active { /* modifier */ }

.syncArea {
  padding: 12px 16px;
  border-top: solid 0.5px var(--nd-divider);
}

.syncLabel {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 0.85em;
  color: var(--nd-fg);
}

.syncToggle {
  position: relative;
  flex-shrink: 0;

  input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
}

.syncToggleTrack {
  display: block;
  width: 40px;
  height: 22px;
  background: var(--nd-buttonBg, rgba(0, 0, 0, 0.15));
  border-radius: 11px;
  position: relative;
  transition: background var(--nd-duration-slow);

  .active & {
    background: var(--nd-accent);
  }
}

.syncToggleKnob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: #fff;
  border-radius: 50%;
  transition: translate var(--nd-duration-slow);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);

  .active & {
    translate: 18px 0;
  }
}

.syncText {
  user-select: none;
  line-height: 1.3;
}
</style>
