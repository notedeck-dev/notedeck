/**
 * ペット (#1080) の購読 + キャッシュ + UI 状態。
 *
 * 選択 (`pet.slug`) は settings.json5 が正本。本体は Rust 側キャッシュ
 * (`pet_store`) にあり、無ければ petdex から取り直す。WebView には base64 で
 * 受け取り Blob URL にして CSS 背景に敷く (アセット CDN に CORS が無いため
 * 直接は参照できない)。
 */

import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type { PetHitMask, PetInfo } from '@/bindings'
import { i18n } from '@/i18n'
import { parsePetSlugInput } from '@/services/petSprite'
import { useSettingsStore } from '@/stores/settings'
import { extractErrorMessage } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'

function dataUrlToBlobUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'))
  const bin = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

export const usePetStore = defineStore('pet', () => {
  const settings = useSettingsStore()

  const slug = computed(() => settings.get('pet.slug') ?? null)
  const info = shallowRef<PetInfo | null>(null)
  /** Blob URL。差し替え時は revoke する */
  const spriteUrl = ref<string | null>(null)
  /** 状態ごとの当たり判定。無ければ矩形 */
  const hitMask = shallowRef<PetHitMask | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  function release() {
    if (spriteUrl.value) URL.revokeObjectURL(spriteUrl.value)
    spriteUrl.value = null
    info.value = null
    hitMask.value = null
  }

  async function load(target: string | null): Promise<void> {
    release()
    error.value = null
    if (!target) return
    loading.value = true
    try {
      let loaded = unwrap(await commands.petLoad(target))
      if (!loaded) {
        // キャッシュが消えている (再インストール / 手動削除) → 取り直す
        unwrap(await commands.petInstall(target))
        loaded = unwrap(await commands.petLoad(target))
      }
      // 待っている間に選択が変わっていたら捨てる
      if (slug.value !== target) return
      if (loaded) {
        info.value = loaded.info
        hitMask.value = loaded.hitMask
        spriteUrl.value = dataUrlToBlobUrl(loaded.dataUrl)
      }
    } catch (e) {
      error.value = extractErrorMessage(e)
    } finally {
      loading.value = false
    }
  }

  /**
   * slug / petdex URL を受けて取得し、成功したら選択を保存する。
   * 形が合わない・取得できない場合は error に理由を残し選択は変えない。
   */
  async function select(input: string): Promise<boolean> {
    const parsed = parsePetSlugInput(input)
    if (!parsed) {
      error.value = i18n.ts._pet.invalidInput
      return false
    }
    loading.value = true
    error.value = null
    try {
      unwrap(await commands.petInstall(parsed))
    } catch (e) {
      error.value = extractErrorMessage(e)
      loading.value = false
      return false
    }
    loading.value = false
    if (slug.value === parsed) {
      await load(parsed)
    } else {
      settings.set('pet.slug', parsed)
    }
    return true
  }

  async function clear(): Promise<void> {
    settings.set('pet.slug', null)
    try {
      unwrap(await commands.petClear())
    } catch (e) {
      console.warn('[pet] cache clear failed:', e)
    }
  }

  watch(slug, (s) => void load(s), { immediate: true })

  return { slug, info, spriteUrl, hitMask, loading, error, select, clear }
})
