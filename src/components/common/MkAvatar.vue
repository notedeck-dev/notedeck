<script setup lang="ts">
import { type CSSProperties, computed, ref, useCssModule, watch } from 'vue'
import type { AvatarDecoration } from '@/adapters/types'
import { proxyThumbUrl, proxyUrl } from '@/utils/mediaProxy'

const props = withDefaults(
  defineProps<{
    avatarUrl: string | null
    decorations?: AvatarDecoration[]
    size?: number
    alt?: string
    indicator?: boolean
    isCat?: boolean
    onlineStatus?: 'online' | 'active' | 'offline' | 'unknown' | null
  }>(),
  {
    decorations: () => [],
    size: 58,
    alt: undefined,
    indicator: false,
    isCat: false,
    onlineStatus: null,
  },
)

const emit = defineEmits<{
  click: [event: MouseEvent]
  mouseenter: [event: MouseEvent]
  mouseleave: [event: MouseEvent]
}>()

const AVATAR_DEFAULT = '/avatar-default.svg'
const AVATAR_ERROR = '/avatar-error.svg'

const proxyFailed = ref(false)
const allFailed = ref(false)

watch(
  () => props.avatarUrl,
  () => {
    proxyFailed.value = false
    allFailed.value = false
  },
)

const avatarSrc = computed(() => {
  if (!props.avatarUrl) return AVATAR_DEFAULT
  if (allFailed.value) return AVATAR_ERROR
  if (proxyFailed.value) return props.avatarUrl
  return proxyThumbUrl(props.avatarUrl, props.size)
})

const avatarSrcset = computed(() => {
  if (!props.avatarUrl || allFailed.value || proxyFailed.value) return undefined
  const x1 = proxyThumbUrl(props.avatarUrl, props.size)
  const x2 = proxyThumbUrl(props.avatarUrl, props.size * 2)
  if (!x1 || !x2) return undefined
  return `${x1} 1x, ${x2} 2x`
})

function onAvatarError(e: Event) {
  const img = e.target as HTMLImageElement
  if (!proxyFailed.value && img.src !== props.avatarUrl) {
    proxyFailed.value = true
  } else if (!allFailed.value) {
    allFailed.value = true
  }
}

function computeDecorationStyle(d: AvatarDecoration): CSSProperties {
  const style: CSSProperties = {}
  const angle = d.angle ?? 0
  if (angle !== 0) style.rotate = `${angle * 360}deg`
  if (d.flipH) style.scale = '-1 1'
  const ox = d.offsetX ?? 0
  const oy = d.offsetY ?? 0
  if (ox !== 0 || oy !== 0) style.translate = `${ox * 100}% ${oy * 100}%`
  return style
}

const decorationStyles = computed(() =>
  props.decorations.map((d) => computeDecorationStyle(d)),
)

const $style = useCssModule()
const statusClassMap: Record<string, string> = {
  online: $style.statusOnline,
  active: $style.statusActive,
  offline: $style.statusOffline,
  unknown: $style.statusUnknown,
}
const statusClass = computed(() =>
  props.onlineStatus ? statusClassMap[props.onlineStatus] : undefined,
)
</script>

<template>
  <div
    class="mk-avatar"
    :class="$style.mkAvatar"
    :style="`--avatar-size:${props.size}px`"
    @click="emit('click', $event)"
    @mouseenter="emit('mouseenter', $event)"
    @mouseleave="emit('mouseleave', $event)"
  >
    <img
      :key="props.avatarUrl ?? undefined"
      :src="avatarSrc"
      :srcset="avatarSrcset"
      :sizes="`${props.size}px`"
      :alt="props.alt"
      :class="$style.avatarImg"
      loading="lazy"
      decoding="async"
      @error="onAvatarError"
    />
    <img
      v-if="props.isCat"
      src="/cat-ear-left.svg"
      :class="[$style.avatarDecoration, $style.catEarLeft]"
      decoding="async"
    />
    <img
      v-if="props.isCat"
      src="/cat-ear-right.svg"
      :class="[$style.avatarDecoration, $style.catEarRight]"
      decoding="async"
    />
    <img
      v-for="(d, i) in props.decorations"
      :key="d.id"
      :src="proxyUrl(d.url)"
      :class="$style.avatarDecoration"
      :style="decorationStyles[i]"
      loading="lazy"
      decoding="async"
    />
    <div
      v-if="indicator && onlineStatus"
      :class="[$style.onlineIndicator, statusClass]"
    />
  </div>
</template>

<style lang="scss" module>
@keyframes earWiggleLeft {
  0% { transform: rotate(0deg); }
  25% { transform: rotate(-16deg); }
  50% { transform: rotate(8deg); }
  75% { transform: rotate(-6deg); }
  100% { transform: rotate(0deg); }
}

@keyframes earWiggleRight {
  0% { transform: rotate(0deg); }
  30% { transform: rotate(16deg); }
  55% { transform: rotate(-8deg); }
  75% { transform: rotate(6deg); }
  100% { transform: rotate(0deg); }
}

.mkAvatar {
  position: relative;
  display: inline-block;
  flex-shrink: 0;
  width: var(--avatar-size, 58px);
  height: var(--avatar-size, 58px);
  border-radius: 50%;
  background: var(--nd-buttonBg);
  transition: transform var(--nd-duration-slow) ease;
  user-select: none;
  -webkit-user-select: none;

  &:hover {
    transform: scale(1.05);

    > .catEarLeft {
      animation: earWiggleLeft 1s ease-in-out infinite;
    }

    > .catEarRight {
      animation: earWiggleRight 1s ease-in-out infinite;
    }
  }
}

.avatarImg {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.avatarDecoration {
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  pointer-events: none;
  z-index: 1;
}

.catEarLeft {
  transform-origin: 35.5% 32%;
}

.catEarRight {
  transform-origin: 64.5% 32%;
}

.onlineIndicator {
  position: absolute;
  z-index: 2;
  bottom: 0;
  left: 0;
  width: 20%;
  height: 20%;
  border-radius: 50%;
  box-shadow: 0 0 0 3px var(--nd-panel, var(--nd-bg));
}

.statusOnline {
  background: var(--nd-statusOnline);
}

.statusActive {
  background: var(--nd-statusActive);
}

.statusOffline {
  background: var(--nd-statusOffline);
}

.statusUnknown {
  background: var(--nd-statusUnknown);
}
</style>
