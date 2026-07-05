<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { NormalizedUserDetail } from '@/adapters/types'
import MkMfm from '@/components/common/MkMfm.vue'
import { useServersStore } from '@/stores/servers'
import { proxyUrl } from '@/utils/imageProxy'
import { commands, unwrap } from '@/utils/tauriInvoke'

const props = defineProps<{
  user: NormalizedUserDetail | null
  accountHost?: string
}>()

const serversStore = useServersStore()

const showQrCode = ref(false)
const qrCodeContainerEl = ref<HTMLDivElement | null>(null)

async function fetchImageAsDataUrl(url: string): Promise<string | undefined> {
  try {
    return unwrap(await commands.fetchImageBase64(url)) ?? undefined
  } catch {
    return undefined
  }
}

async function open() {
  if (!props.user || !props.accountHost) return
  showQrCode.value = true
  await nextTick()

  const container = qrCodeContainerEl.value
  if (!container) return
  container.replaceChildren()

  const profileUrl = `https://${props.accountHost}/users/${props.user.id}`

  const serverInfo = await serversStore.getServerInfo(props.accountHost)

  const { colord } = await import('colord')
  const baseColor = colord(serverInfo.themeColor || '#86b300')
  const hsl = baseColor.toHsl()

  const imageDataUrl = serverInfo.iconUrl
    ? await fetchImageAsDataUrl(serverInfo.iconUrl)
    : undefined

  const { default: QRCodeStyling } = await import('qr-code-styling')
  const qr = new QRCodeStyling({
    width: 600,
    height: 600,
    margin: 42,
    type: 'canvas',
    data: profileUrl,
    image: imageDataUrl,
    qrOptions: {
      typeNumber: 0,
      mode: 'Byte',
      errorCorrectionLevel: 'H',
    },
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: 0.3,
      margin: 16,
    },
    dotsOptions: {
      type: 'dots',
      color: colord({ h: hsl.h, s: 100, l: 18 }).toRgbString(),
    },
    cornersDotOptions: {
      type: 'dot',
    },
    cornersSquareOptions: {
      type: 'extra-rounded',
    },
    backgroundOptions: {
      color: colord({ h: hsl.h, s: 100, l: 97 }).toRgbString(),
    },
  })

  qr.append(container)

  const canvas = container.querySelector('canvas')
  if (canvas) {
    Object.assign(canvas.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
    })
  }
}

defineExpose({ open })
</script>

<template>
  <div v-if="showQrCode" :class="$style.qrOverlay" @click="showQrCode = false">
    <div :class="$style.qrModal" @click.stop>
      <button class="_button" :class="$style.qrCloseBtn" @click="showQrCode = false">
        <i class="ti ti-x" />
      </button>
      <div ref="qrCodeContainerEl" :class="$style.qrCanvas" />
      <div :class="$style.qrUser">
        <img v-if="user?.avatarUrl" :src="proxyUrl(user.avatarUrl)" :class="$style.qrAvatar" />
        <div :class="$style.qrUserInfo">
          <div :class="$style.qrName">
            <MkMfm v-if="user?.name" :text="user.name" :emojis="user?.emojis" :server-host="accountHost" plain />
            <template v-else>{{ user?.username }}</template>
          </div>
          <div :class="$style.qrAcct">@{{ user?.username }}@{{ accountHost }}</div>
        </div>
      </div>
      <img :class="$style.qrLogo" src="/misskey-logo.svg" alt="Misskey" />
    </div>
  </div>
</template>

<style lang="scss" module>
.qrOverlay {
  position: fixed;
  inset: 0;
  z-index: var(--nd-z-popup);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--nd-overlayDark);
}

.qrModal {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.qrCloseBtn {
  position: absolute;
  top: -40px;
  right: -40px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
  font-size: 16px;

  &:hover {
    background: rgba(255, 255, 255, 0.3);
  }
}

.qrCanvas {
  position: relative;
  width: min(230px, 80vw);
  border-radius: 12px;
  overflow: clip;
  aspect-ratio: 1;
}

.qrUser {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-top: 28px;
  color: #fff;
  max-width: 230px;
}

.qrAvatar {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  object-fit: cover;
  margin-bottom: 16px;
}

.qrUserInfo {
  overflow: hidden;
  max-width: 100%;
}

.qrName {
  font-weight: bold;
  font-size: 1.1em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qrAcct {
  font-size: 0.9em;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qrLogo {
  width: 100px;
  margin-top: 28px;
  filter: drop-shadow(0 0 6px rgb(0 0 0 / 43%));
}
</style>
