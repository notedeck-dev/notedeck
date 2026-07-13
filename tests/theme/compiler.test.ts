import { describe, expect, it } from 'vitest'
import {
  DARK_BASE,
  DARK_THEME,
  LIGHT_BASE,
  LIGHT_THEME,
} from '@/theme/builtinThemes'
import { parseColor } from '@/theme/colorUtils'
import { compileMisskeyTheme } from '@/theme/compiler'
import type { MisskeyTheme } from '@/theme/types'

const EMPTY_BASE: MisskeyTheme = { id: 'base', name: 'Base', props: {} }

describe('compileMisskeyTheme', () => {
  it('passes through literal color values', () => {
    const theme: MisskeyTheme = {
      id: 't',
      name: 't',
      props: { bg: '#000', fg: '#dadada' },
    }
    const compiled = compileMisskeyTheme(theme, EMPTY_BASE)
    expect(compiled.bg).toBe('#000')
    expect(compiled.fg).toBe('#dadada')
  })

  it('resolves @ref property references', () => {
    const theme: MisskeyTheme = {
      id: 't',
      name: 't',
      props: { accent: '#86b300', indicator: '@accent' },
    }
    const compiled = compileMisskeyTheme(theme, EMPTY_BASE)
    expect(compiled.indicator).toBe('#86b300')
  })

  it('resolves chained @ref references', () => {
    const theme: MisskeyTheme = {
      id: 't',
      name: 't',
      props: { accent: '#86b300', mention: '@accent', mentionMe: '@mention' },
    }
    const compiled = compileMisskeyTheme(theme, EMPTY_BASE)
    expect(compiled.mentionMe).toBe('#86b300')
  })

  it('applies :lighten color function', () => {
    const theme: MisskeyTheme = {
      id: 't',
      name: 't',
      props: { bg: '#000', panel: ':lighten<3<@bg' },
    }
    const compiled = compileMisskeyTheme(theme, EMPTY_BASE)
    const panelColor = parseColor(compiled.panel)
    expect(panelColor).not.toBeNull()
    // Black lightened by 3% should have some brightness
    expect(panelColor?.[0]).toBeGreaterThan(0)
  })

  it('applies :alpha color function', () => {
    const theme: MisskeyTheme = {
      id: 't',
      name: 't',
      props: { accent: '#86b300', accentedBg: ':alpha<0.15<@accent' },
    }
    const compiled = compileMisskeyTheme(theme, EMPTY_BASE)
    const accentedBg = parseColor(compiled.accentedBg)
    expect(accentedBg).not.toBeNull()
    expect(accentedBg?.[3]).toBe(0.15)
  })

  it('applies :hue color function', () => {
    const theme: MisskeyTheme = {
      id: 't',
      name: 't',
      props: { accent: '#86b300', buttonGradateB: ':hue<20<@accent' },
    }
    const compiled = compileMisskeyTheme(theme, EMPTY_BASE)
    expect(compiled.buttonGradateB).not.toBe('#86b300')
    expect(parseColor(compiled.buttonGradateB)).not.toBeNull()
  })

  it('handles "raw CSS values and replaces --MI_THEME- with --nd-', () => {
    const theme: MisskeyTheme = {
      id: 't',
      name: 't',
      props: { panelBorder: '" solid 1px var(--MI_THEME-divider)' },
    }
    const compiled = compileMisskeyTheme(theme, EMPTY_BASE)
    expect(compiled.panelBorder).toBe(' solid 1px var(--nd-divider)')
  })

  it('resolves nested expressions', () => {
    const theme: MisskeyTheme = {
      id: 't',
      name: 't',
      props: {
        bg: '#000',
        panel: ':lighten<3<@bg',
        panelHighlight: ':lighten<3<@panel',
      },
    }
    const compiled = compileMisskeyTheme(theme, EMPTY_BASE)
    // panel should be brighter than bg, panelHighlight brighter than panel
    const bg = parseColor(compiled.bg)
    const panel = parseColor(compiled.panel)
    const highlight = parseColor(compiled.panelHighlight)
    expect(bg).not.toBeNull()
    expect(panel).not.toBeNull()
    expect(highlight).not.toBeNull()
    expect(panel?.[0]).toBeGreaterThanOrEqual(bg?.[0] ?? 0)
    expect(highlight?.[0]).toBeGreaterThanOrEqual(panel?.[0] ?? 0)
  })

  it('handles circular references gracefully', () => {
    const theme: MisskeyTheme = {
      id: 't',
      name: 't',
      props: { a: '@b', b: '@a' },
    }
    // Should not throw, should return empty strings
    const compiled = compileMisskeyTheme(theme, EMPTY_BASE)
    expect(compiled.a).toBeDefined()
    expect(compiled.b).toBeDefined()
  })

  it('falls back to base theme props', () => {
    const base: MisskeyTheme = {
      id: 'base',
      name: 'Base',
      props: { bg: '#000', fg: '#dadada' },
    }
    const theme: MisskeyTheme = {
      id: 't',
      name: 't',
      props: { bg: '#111' }, // override bg, keep fg from base
    }
    const compiled = compileMisskeyTheme(theme, base)
    expect(compiled.bg).toBe('#111')
    expect(compiled.fg).toBe('#dadada')
  })

  it('compiles the full builtin dark theme without errors', () => {
    const compiled = compileMisskeyTheme(DARK_THEME, DARK_BASE)
    expect(Object.keys(compiled).length).toBeGreaterThan(40)
    // Key props should be valid colors
    expect(parseColor(compiled.bg)).not.toBeNull()
    expect(parseColor(compiled.fg)).not.toBeNull()
    expect(parseColor(compiled.accent)).not.toBeNull()
    expect(parseColor(compiled.panel)).not.toBeNull()
    expect(parseColor(compiled.accentedBg)).not.toBeNull()
    expect(parseColor(compiled.buttonBg)).not.toBeNull()
    expect(parseColor(compiled.buttonHoverBg)).not.toBeNull()
  })

  it('compiles the full builtin light theme without errors', () => {
    const compiled = compileMisskeyTheme(LIGHT_THEME, LIGHT_BASE)
    expect(Object.keys(compiled).length).toBeGreaterThan(40)
    expect(parseColor(compiled.bg)).not.toBeNull()
    expect(parseColor(compiled.fg)).not.toBeNull()
    expect(parseColor(compiled.accent)).not.toBeNull()
    // Light theme bg should be brighter than dark theme bg
    const lightBg = parseColor(compiled.bg)
    expect(lightBg).not.toBeNull()
    expect(lightBg?.[0]).toBeGreaterThan(200)
  })

  it('compiles a server theme that overrides base', () => {
    const serverTheme: MisskeyTheme = {
      id: 'server-custom',
      name: 'Custom',
      base: 'dark',
      props: {
        accent: '#ff6600', // custom accent
        bg: '#1a1a2e', // custom background
      },
    }
    const compiled = compileMisskeyTheme(serverTheme, DARK_BASE)
    expect(compiled.accent).toBe('#ff6600')
    expect(compiled.bg).toBe('#1a1a2e')
    // Should still have all dark base theme props (fg from DARK_BASE)
    expect(compiled.fg).toBe('#dadada')
    // accentedBg should use the custom accent
    const accentedBg = parseColor(compiled.accentedBg)
    expect(accentedBg).not.toBeNull()
  })

  it('derives accentDarken from accent when the theme does not define it', () => {
    const serverTheme: MisskeyTheme = {
      id: 'server-custom',
      name: 'Custom',
      base: 'dark',
      props: { accent: '#ff6600' },
    }
    const compiled = compileMisskeyTheme(serverTheme, DARK_BASE)
    const accent = parseColor(compiled.accent)
    const darkened = parseColor(compiled.accentDarken)
    expect(darkened).not.toBeNull()
    // accent より暗い（RGB 合計が小さい）こと
    const sum = (c: readonly number[] | null) =>
      (c?.[0] ?? 0) + (c?.[1] ?? 0) + (c?.[2] ?? 0)
    expect(sum(darkened)).toBeLessThan(sum(accent))
  })

  it('keeps an explicit accentDarken prop untouched', () => {
    const theme: MisskeyTheme = {
      id: 't',
      name: 't',
      props: { accent: '#86b300', accentDarken: '#123456' },
    }
    const compiled = compileMisskeyTheme(theme, EMPTY_BASE)
    expect(compiled.accentDarken).toBe('#123456')
  })

  it('passes through rgba values in props', () => {
    const theme: MisskeyTheme = {
      id: 't',
      name: 't',
      props: { divider: 'rgba(255, 255, 255, 0.1)' },
    }
    const compiled = compileMisskeyTheme(theme, EMPTY_BASE)
    expect(compiled.divider).toBe('rgba(255, 255, 255, 0.1)')
  })
})
