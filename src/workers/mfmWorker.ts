/// <reference lib="webworker" />

import type { MfmNode } from '../services/mfmParser'
import { parseTokens } from '../services/mfmParser'

export interface MfmParseRequest {
  type: 'parse'
  id: number
  texts: string[]
}

export interface MfmParseResponse {
  id: number
  results: { text: string; tokens: MfmNode[] }[]
}

self.onmessage = (event: MessageEvent<MfmParseRequest>) => {
  const { id, texts } = event.data
  const results = texts.map((text) => ({
    text,
    tokens: text ? parseTokens(text) : ([] as MfmNode[]),
  }))
  const response: MfmParseResponse = { id, results }
  self.postMessage(response)
}
