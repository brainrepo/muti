// Palette dalla copertina: tre colori per luminosità (scuro → sfondo, medio → superfici, chiaro → accento).
// I pixel restano in memoria e vengono scartati subito (policy Spotify, §2.3).
type Hsl = { h: number; s: number; l: number }
export type Palette = { dark: Hsl; mid: Hsl; light: Hsl }

function rgbToHsl(r: number, g: number, b: number): Hsl {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  const d = max - min
  if (!d) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

const load = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('copertina non leggibile'))
    img.src = url
  })

/** Media pesata per saturazione: i colori vivaci contano più dei grigi. */
function bucketAverage(px: { r: number; g: number; b: number }[]): Hsl {
  let R = 0, G = 0, B = 0, W = 0
  for (const p of px) {
    const w = 0.15 + rgbToHsl(p.r, p.g, p.b).s
    R += p.r * w; G += p.g * w; B += p.b * w; W += w
  }
  return rgbToHsl(R / W, G / W, B / W)
}

export async function extractPalette(url: string): Promise<Palette | null> {
  const img = await load(url)
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data
  const px: { r: number; g: number; b: number; y: number }[] = []
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
    px.push({ r, g, b, y: 0.2126 * r + 0.7152 * g + 0.0722 * b })
  }
  px.sort((a, b) => a.y - b.y)
  const third = Math.floor(px.length / 3)
  const p: Palette = {
    dark: bucketAverage(px.slice(0, third)),
    mid: bucketAverage(px.slice(third, 2 * third)),
    light: bucketAverage(px.slice(2 * third))
  }
  // copertina quasi in scala di grigi: si tiene la palette di base
  return Math.max(p.dark.s, p.mid.s, p.light.s) < 0.12 ? null : p
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`

const VARS = ['--bg', '--bg2', '--bg3', '--line', '--muted', '--accent', '--warn']

/** Applica la palette alle variabili CSS; `null` ripristina quella di base. Luminosità bloccate per tenere il contrasto. */
export function applyPalette(p: Palette | null) {
  const root = document.documentElement.style
  if (!p) return VARS.forEach((v) => root.removeProperty(v))
  const hd = p.dark.h, hm = p.mid.h
  const sd = clamp(p.dark.s, 0.3, 0.75), sm = clamp(p.mid.s, 0.25, 0.6)
  root.setProperty('--bg', hsl(hd, sd, 0.09))
  root.setProperty('--bg2', hsl(hm, sm, 0.14))
  root.setProperty('--bg3', hsl(hm, sm, 0.2))
  root.setProperty('--line', hsl(hm, sm, 0.28))
  root.setProperty('--muted', hsl(hm, clamp(p.mid.s, 0.08, 0.25), 0.68))
  const accent = hsl(p.light.h, clamp(p.light.s * 1.2, 0.6, 0.95), clamp(p.light.l, 0.62, 0.74))
  root.setProperty('--accent', accent)
  root.setProperty('--warn', accent)
}
