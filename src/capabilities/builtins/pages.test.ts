import { describe, expect, it } from 'vitest'
import {
  PAGES_BUILTIN_CAPABILITIES,
  pagesListCapability,
  pagesShowCapability,
} from './pages'

describe('pages capabilities — declaration', () => {
  it('pages.list: account.read, cheap, requires endpoint', () => {
    expect(pagesListCapability.id).toBe('pages.list')
    expect(pagesListCapability.permissions).toEqual(['account.read'])
    expect(pagesListCapability.signature?.cheap).toBe(true)
    expect(pagesListCapability.signature?.returns?.type).toBe('array')
    expect(pagesListCapability.signature?.params?.endpoint?.optional).not.toBe(
      true,
    )
  })

  it('pages.show: account.read, requires pageId', () => {
    expect(pagesShowCapability.id).toBe('pages.show')
    expect(pagesShowCapability.permissions).toEqual(['account.read'])
    expect(pagesShowCapability.signature?.params?.pageId?.optional).not.toBe(
      true,
    )
  })
})

describe('PAGES_BUILTIN_CAPABILITIES', () => {
  it('contains list / show', () => {
    const ids = PAGES_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(['pages.list', 'pages.show'])
  })
})
