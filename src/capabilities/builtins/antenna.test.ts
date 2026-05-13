import { describe, expect, it } from 'vitest'
import {
  ANTENNA_BUILTIN_CAPABILITIES,
  antennaListCapability,
  antennaNotesCapability,
} from './antenna'

describe('antenna capabilities — declaration', () => {
  it('antenna.list: account.read, cheap, aiTool', () => {
    expect(antennaListCapability.id).toBe('antenna.list')
    expect(antennaListCapability.permissions).toEqual(['account.read'])
    expect(antennaListCapability.signature?.cheap).toBe(true)
    expect(antennaListCapability.signature?.returns?.type).toBe('array')
    expect(antennaListCapability.aiTool).toBe(true)
  })

  it('antenna.notes: notes.read, requires antennaId', () => {
    expect(antennaNotesCapability.id).toBe('antenna.notes')
    expect(antennaNotesCapability.permissions).toEqual(['notes.read'])
    expect(antennaNotesCapability.aiTool).toBe(true)
    expect(
      antennaNotesCapability.signature?.params?.antennaId?.optional,
    ).not.toBe(true)
    expect(antennaNotesCapability.signature?.params?.limit?.optional).toBe(true)
  })

  it('antenna.notes throws when antennaId is missing', async () => {
    await expect(antennaNotesCapability.execute({})).rejects.toThrow(
      /antennaId is required/,
    )
  })
})

describe('ANTENNA_BUILTIN_CAPABILITIES', () => {
  it('contains list / notes', () => {
    const ids = ANTENNA_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(['antenna.list', 'antenna.notes'])
  })
})
