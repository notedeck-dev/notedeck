type RGBA = [r: number, g: number, b: number, a: number]

// Misskey は tinycolor に値を渡すため `#` の無いベア hex (`e2deda`) も色として通る。
// 実際に l-botanical.json5 の bg がこの書き方をしているので同じ表記を受け入れる。
const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

// ベア hex を `#` 付きに揃える。CSS / SVG の fill にそのまま入れられる形にするため。
export function normalizeColor(value: string): string {
  const trimmed = value.trim()
  return HEX_RE.test(trimmed) && !trimmed.startsWith('#')
    ? `#${trimmed}`
    : trimmed
}

export function parseColor(value: string): RGBA | null {
  value = value.trim()

  // #RGB or #RRGGBB or #RRGGBBAA (先頭の `#` は省略可)
  if (HEX_RE.test(value)) {
    const hex = value.startsWith('#') ? value.slice(1) : value
    if (hex.length === 3) {
      return [
        parseInt(hex.charAt(0) + hex.charAt(0), 16),
        parseInt(hex.charAt(1) + hex.charAt(1), 16),
        parseInt(hex.charAt(2) + hex.charAt(2), 16),
        1,
      ]
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        1,
      ]
    }
    if (hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        parseInt(hex.slice(6, 8), 16) / 255,
      ]
    }
    return null
  }

  // 関数表記: rgb / rgba / hsl / hsla / oklch。カンマ区切りと空白 + `/` 区切りの
  // 両方を受ける。解釈できないと派生関数 (:darken 等) が素通りになり、明暗判定も
  // 外れる (テーマ作者が hsl や oklch で書いたとき)
  const fn = value.match(/^(rgba?|hsla?|oklch)\(\s*([^)]*)\)$/i)
  if (fn) {
    const name = fn[1]?.toLowerCase() ?? ''
    const parts = (fn[2] ?? '').split(/\s*[,/]\s*|\s+/).filter(Boolean)
    if (parts.length < 3 || parts.length > 4) return null
    const [p1, p2, p3, p4] = parts as [string, string, string, string?]
    const a = p4 === undefined ? 1 : parseNumberOrPercent(p4, 1)
    if (a === null) return null
    if (name.startsWith('rgb')) {
      const c = [p1, p2, p3].map((v) => parseNumberOrPercent(v, 255))
      if (c.some((v) => v === null)) return null
      return [c[0] as number, c[1] as number, c[2] as number, a]
    }
    if (name.startsWith('hsl')) {
      const h = Number.parseFloat(p1)
      const sat = Number.parseFloat(p2)
      const l = Number.parseFloat(p3)
      if ([h, sat, l].some(Number.isNaN)) return null
      const [r, g, b] = hslToRgb(h, sat, l)
      return [r, g, b, a]
    }
    const l = parseNumberOrPercent(p1, 1)
    const c = parseNumberOrPercent(p2, 0.4)
    const h = Number.parseFloat(p3)
    if (l === null || c === null || Number.isNaN(h)) return null
    const [r, g, b] = oklchToRgb(l, c, h)
    return [r, g, b, a]
  }

  return null
}

/** `40%` は scale に対する割合、数値はそのまま */
function parseNumberOrPercent(v: string, scale: number): number | null {
  const n = Number.parseFloat(v)
  if (Number.isNaN(n)) return null
  return v.trim().endsWith('%') ? (n / 100) * scale : n
}

/** OKLCH → sRGB (0-255、範囲外は切り詰める) */
function oklchToRgb(
  l: number,
  c: number,
  h: number,
): [r: number, g: number, b: number] {
  const rad = (h * Math.PI) / 180
  const A = c * Math.cos(rad)
  const B = c * Math.sin(rad)
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  const toSrgb = (x: number) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
    return Math.max(0, Math.min(1, v)) * 255
  }
  return [toSrgb(lin[0] ?? 0), toSrgb(lin[1] ?? 0), toSrgb(lin[2] ?? 0)]
}

/** 知覚的な明るさで明るい色か (背景がライトかの判定)。解釈できなければ false */
export function isLightColor(value: string): boolean {
  const rgba = parseColor(value)
  if (!rgba) return false
  const [r, g, b] = rgba
  return (r * 299 + g * 587 + b * 114) / 1000 > 128
}

export function toRgba(rgba: RGBA): string {
  const [r, g, b, a] = rgba
  if (a === 1)
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`
}

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): [h: number, s: number, l: number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s * 100, l * 100]
}

function hslToRgb(
  h: number,
  s: number,
  l: number,
): [r: number, g: number, b: number] {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(100, s)) / 100
  l = Math.max(0, Math.min(100, l)) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0,
    g = 0,
    b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

function withHsl(
  color: string,
  fn: (h: number, s: number, l: number) => [number, number, number],
): string {
  const rgba = parseColor(color)
  if (!rgba) return color
  const [h, s, l] = rgbToHsl(rgba[0], rgba[1], rgba[2])
  const [nh, ns, nl] = fn(h, s, l)
  const [r, g, b] = hslToRgb(nh, ns, nl)
  return toRgba([r, g, b, rgba[3]])
}

export function darken(color: string, amount: number): string {
  return withHsl(color, (h, s, l) => [h, s, l - amount])
}

export function lighten(color: string, amount: number): string {
  return withHsl(color, (h, s, l) => [h, s, l + amount])
}

export function alpha(color: string, amount: number): string {
  const rgba = parseColor(color)
  if (!rgba) return color
  return toRgba([rgba[0], rgba[1], rgba[2], amount])
}

export function hue(color: string, rotate: number): string {
  return withHsl(color, (h, s, l) => [h + rotate, s, l])
}

export function saturate(color: string, amount: number): string {
  return withHsl(color, (h, s, l) => [h, s + amount, l])
}
