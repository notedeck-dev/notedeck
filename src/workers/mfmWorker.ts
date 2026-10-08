/// <reference lib="webworker" />

import type { MfmToken } from '../services/mfmParser'
import { parseTokens } from '../services/mfmParser'

export interface MfmParseRequest {
  type: 'parse'
  id: number
  texts: string[]
}

export interface MfmParseResponse {
  id: number
  results: { text: string; tokens: MfmToken[] }[]
}

self.onmessage = (event: MessageEvent<MfmParseRequest>) => {
  const { id, texts } = event.data
  const results = texts.map((text) => ({
    text,
    tokens: text ? parseTokens(text) : ([] as MfmToken[]),
  }))
  const response: MfmParseResponse = { id, results }
  self.postMessage(response)
}
