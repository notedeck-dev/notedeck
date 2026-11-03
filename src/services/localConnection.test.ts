import { describe, expect, it } from 'vitest'
import { isLoopbackUrl, modelsPathFor } from './localConnection'

// この端末の中で動くサービス (ローカル接続、#880) の判定。Rust の
// ssrf::normalize_loopback_url と同じ 3 表記だけを loopback と見る
describe('isLoopbackUrl', () => {
  it('3 表記 (localhost / 127.0.0.1 / [::1]) を loopback と見る', () => {
    expect(isLoopbackUrl('http://localhost:11434/v1')).toBe(true)
    expect(isLoopbackUrl('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:11434')).toBe(true)
    expect(isLoopbackUrl('HTTP://LOCALHOST:1234')).toBe(true)
  })

  it('公開ホストや 3 表記以外は loopback と見ない (入力途中の文字列も)', () => {
    expect(isLoopbackUrl('https://api.openai.com/v1')).toBe(false)
    expect(isLoopbackUrl('http://127.0.0.2:11434')).toBe(false)
    expect(isLoopbackUrl('http://ollama.local:11434')).toBe(false)
    expect(isLoopbackUrl('')).toBe(false)
    expect(isLoopbackUrl('http://')).toBe(false)
    expect(isLoopbackUrl('localhost:11434')).toBe(false)
  })
})

describe('modelsPathFor', () => {
  it('protocol ごとのモデル一覧のパス (Rust の models_path_for と同じ)', () => {
    expect(modelsPathFor('openai-compat')).toBe('/models')
    expect(modelsPathFor('anthropic')).toBe('/v1/models')
    expect(modelsPathFor(null)).toBe('/')
  })
})
