// Parser dei titoli Spotify (funzione pura, nessun I/O). Vedi SPEC §6.2 fase 1.
// Solo import relativi con estensione .ts: i test lo eseguono direttamente con `node --test`.

export type Catalog = { system: string; number: string; sub?: string }
export type Movement = { index?: number; title: string }
export type Parsed = {
  raw: string // parte "opera" del titolo, non toccata
  workTitle: string // parte opera senza catalogo, tonalità, soprannome
  catalog: Catalog[]
  number?: number
  key?: string // "C minor", "Eb major", "D" (modo ignoto)
  genre?: string // forma canonica inglese: symphony, concerto, ...
  nickname?: string
  movement?: Movement
}

// ---------- normalizzazione testo ----------

export const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const COMPOUND_PREFIX: Record<string, string> = {
  klavier: 'piano', violin: 'violin', violoncello: 'cello', cello: 'cello',
  streich: 'string', orgel: 'organ', floten: 'flute', flote: 'flute'
}
const splitCompounds = (s: string) =>
  s.replace(
    /\b(klavier|violin|violoncello|cello|streich|orgel|floten|flote)(?=(?:konzert|sonate|trio|quartett|quintett|sinfonie)\b)/g,
    (_, p: string) => COMPOUND_PREFIX[p] + ' '
  )

// Forme in testo già "foldato" (senza accenti, minuscolo)
const GENRES: [string, RegExp][] = [
  ['symphony', /\b(?:\w*sinfonie|symphon(?:y|ie|ies)|sinfon(?:ia|ias|ies))\b/g],
  ['concerto', /\b(?:\w*konzert|concert(?:o|i|os)|concertos)\b/g],
  ['sonata', /\bsonat(?:a|e|en|as|es)\b/g],
  ['quartet', /\b(?:quartet(?:t|to|ti|s)?|quatuors?|\w*quartett)\b/g],
  ['quintet', /\b(?:quintet(?:t|to|ti|s)?|quintettes?|\w*quintett)\b/g],
  ['trio', /\btrios?\b/g],
  ['suite', /\bsuites?\b/g],
  ['overture', /\b(?:overtures?|ouvertures?|ouverture|sinfonia avanti)\b/g],
  ['mass', /\b(?:mass|messa|messe)\b/g],
  ['requiem', /\brequiem\b/g],
  ['prelude', /\b(?:preludes?|preludio|praludium|praludien)\b/g],
  ['fugue', /\b(?:fugues?|fuga|fughe|fuge)\b/g],
  ['partita', /\bpartitas?\b/g],
  ['cantata', /\b(?:cantatas?|kantate)\b/g],
  ['variations', /\b(?:variations?|variazioni|variationen|variaciones)\b/g],
  ['etude', /\b(?:etudes?|etuden|studio|studi|study)\b/g],
  ['nocturne', /\b(?:nocturnes?|notturno|nocturno)\b/g],
  ['waltz', /\b(?:waltz(?:es)?|valzer|walzer|valses?)\b/g],
  ['mazurka', /\bmazurkas?\b/g],
  ['polonaise', /\b(?:polonaises?|polacca)\b/g],
  ['impromptu', /\bimpromptus?\b/g],
  ['ballade', /\b(?:ballades?|ballata)\b/g],
  ['scherzo', /\bscherzos?\b/g],
  ['rhapsody', /\b(?:rhapsody|rhapsodie|rapsodia|rhapsodies)\b/g],
  ['serenade', /\b(?:serenades?|serenata|serenaden)\b/g],
  ['divertimento', /\bdivertimentos?\b/g],
  ['lied', /\b(?:lieder|lied)\b/g],
  ['opera', /\bopera\b/g],
  ['oratorio', /\boratorio\b/g],
  ['fantasia', /\b(?:fantasia|fantasy|fantaisie|fantasie)\b/g],
  ['toccata', /\btoccatas?\b/g],
  ['bagatelle', /\bbagatell(?:e|en)\b/g],
  ['rondo', /\brondo\b/g],
  ['chaconne', /\b(?:chaconne|ciaccona)\b/g],
  ['magnificat', /\bmagnificat\b/g]
]

const INSTRUMENTS: [string, RegExp][] = [
  ['piano', /\b(?:pianoforte|klavier)\b/g],
  ['violin', /\b(?:violino|violine|violon)\b/g],
  ['cello', /\b(?:violoncello|violoncelle)\b/g],
  ['organ', /\b(?:organo|orgel|orgue)\b/g],
  ['flute', /\b(?:flauto|flote|flute)\b/g],
  ['clarinet', /\b(?:clarinetto|klarinette|clarinette)\b/g],
  ['orchestra', /\b(?:orchestre|orchester|orchestra)\b/g],
  ['string', /\b(?:strings|streich|archi|cordes)\b/g]
]

const STOP = new Set(
  'no nos n nr num op opus in the a an for de di des der die das le la il of und and e et en von van zu du dei del della ein eine pour per'.split(
    ' '
  )
)

/** Testo foldato con forme composte spezzate (Klavierkonzert → piano konzert). */
const prep = (s: string) => splitCompounds(fold(s))

export function detectGenre(s: string): string | undefined {
  const t = prep(s)
  let best: [number, string] | undefined
  for (const [name, re] of GENRES) {
    re.lastIndex = 0
    const m = re.exec(t)
    if (m && (!best || m.index < best[0])) best = [m.index, name]
  }
  return best?.[1]
}

/** Token comparabili tra lingue: genere e strumenti in forma canonica, senza rumore. */
export function normTokens(s: string): string[] {
  let t = prep(s).replace(/[’'`"“”«»]/g, ' ')
  for (const [name, re] of GENRES) t = t.replace(re, ` ${name} `)
  for (const [name, re] of INSTRUMENTS) t = t.replace(re, ` ${name} `)
  return t
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
}
export const normTitle = (s: string) => normTokens(s).join(' ')

/** Coefficiente di Dice su insiemi di token. */
export function dice(a: string[], b: string[]): number {
  const A = new Set(a)
  const B = new Set(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return (2 * inter) / (A.size + B.size)
}

// ---------- catalogo ----------

// sotto-numero: "Op. 27 No. 2", "Op. 27, No. 2", "D. 899/3"
const SUB = String.raw`(?:\s*[,]?\s*(?:[Nn][Oo]|[Nn][Rr]|[Nn][º°]?)\.?\s*(\d+)|\s*/\s*(\d+))?`
const cat = (system: string, src: string, flags = 'gi', sub = false): [string, RegExp, boolean] => [
  system,
  new RegExp(src + (sub ? SUB : ''), flags),
  sub
]
const CATALOGS: [string, RegExp, boolean][] = [
  cat('Op', String.raw`\bop(?:us|\.)?\s*(?:posth\.?\s*)?(\d+[a-z]?)(?!\d)`, 'gi', true),
  cat('BWV', String.raw`\bBWV\.?\s*((?:anh\.?\s*)?\d+[a-z]?)`),
  cat('K', String.raw`\b(?:K|KV|K[oö]chel)\.?\s*(\d+[a-z]?)(?!\d)`),
  cat('D', String.raw`\bD\.?\s*(\d{1,4}[a-z]?)(?!\d)`, 'g', true),
  cat('Hob', String.raw`\bHob\.?\s*([IVX]+[a-z]?\s*:\s*\w+)`),
  cat('RV', String.raw`\bRV\.?\s*(\d+[a-z]?)`),
  cat('HWV', String.raw`\bHWV\.?\s*(\d+[a-z]?)`),
  cat('TWV', String.raw`\bTWV\.?\s*(\d+\s*:\s*[\w]+)`),
  cat('SWV', String.raw`\bSWV\.?\s*(\d+[a-z]?)`),
  cat('BuxWV', String.raw`\bBuxWV\.?\s*(\d+[a-z]?)`),
  cat('MWV', String.raw`\bMWV\.?\s*([A-Z]{1,2}\s*\d+)`),
  cat('ZWV', String.raw`\bZWV\.?\s*(\d+)`),
  cat('LW', String.raw`\bLW\.?\s*([A-Z]?\d+)`),
  cat('S', String.raw`\bS\.?\s*(\d{1,4}[a-z]?)(?!\d)`, 'g', true),
  cat('WoO', String.raw`\bWoO\.?\s*(\d+[a-z]?)`, 'gi', true),
  cat('TrV', String.raw`\bTrV\.?\s*(\d+[a-z]?)`),
  cat('Sz', String.raw`\bSz\.?\s*(\d+[a-z]?)`),
  cat('BB', String.raw`\bBB\.?\s*(\d+[a-z]?)`),
  cat('L', String.raw`\bL\.?\s*(\d{1,3}[a-z]?)(?!\d)`, 'g'),
  cat('FWV', String.raw`\bFWV\.?\s*(\d+)`),
  cat('M', String.raw`\bM\.?\s*(\d{1,3}[a-z]?)(?!\d)`, 'g'),
  cat('JB', String.raw`\bJB\.?\s*(\d+)`),
  cat('B', String.raw`\bB\.?\s*(\d{1,3}[a-z]?)(?!\d)`, 'g'),
  cat('TH', String.raw`\bTH\.?\s*(\d+)`),
  cat('Wq', String.raw`\bWq\.?\s*(\d+[a-z]?)`)
]

const cn = (s: string) => s.toLowerCase().replace(/[\s.]/g, '')

const tidy = (s: string) =>
  s
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(?:\s*[,;:])+(?=\s*(?:[,;:]|$))/g, '')
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '')
    .replace(/\s+(?:in|en|em)\s*$/i, '')
    .trim()

export function extractCatalog(text: string): { catalog: Catalog[]; rest: string } {
  const catalog: Catalog[] = []
  let rest = text
  for (const [system, re, hasSub] of CATALOGS) {
    re.lastIndex = 0
    rest = rest.replace(re, (_m, g1: string, g2?: string, g3?: string) => {
      const sub = hasSub ? (g2 ?? g3) : undefined
      catalog.push({ system, number: cn(g1), ...(sub ? { sub } : {}) })
      return ' '
    })
  }
  return { catalog, rest: tidy(rest) }
}

const dot = (s: string) => (['Op', 'K', 'D', 'S', 'L', 'M', 'B', 'Hob'].includes(s) ? s + '.' : s)
export const catalogLabel = (c: Catalog) =>
  `${dot(c.system)} ${c.number.toUpperCase()}${c.sub ? ` No. ${c.sub}` : ''}`

/** Relazione tra il catalogo del brano e quello di un candidato. */
export function catalogRelation(track: Catalog[], cand: Catalog[]): 'match' | 'conflict' | 'none' {
  let conflict = false
  for (const t of track) {
    for (const c of cand) {
      if (c.system !== t.system) continue
      if (c.number === t.number && (!t.sub || !c.sub || t.sub === c.sub)) return 'match'
      conflict = true
    }
  }
  return conflict ? 'conflict' : 'none'
}

// ---------- tonalità ----------

const IT_NOTE: Record<string, string> = { do: 'C', re: 'D', mi: 'E', fa: 'F', sol: 'G', la: 'A', si: 'B' }
const mode = (m: string) => (/^(?:minor|minore|moll)$/i.test(m) ? 'minor' : 'major')

function extractKey(text: string): { key?: string; rest: string } {
  let m = /\bin\s+([A-Ga-g])(?:[\s-]?(sharp|flat)|([#♯♭]|b(?![a-z])))?[\s-]+(major|minor)\b/i.exec(text)
  if (m) {
    const acc = m[2] ? (/sharp/i.test(m[2]) ? '#' : 'b') : m[3] ? (m[3] === 'b' || m[3] === '♭' ? 'b' : '#') : ''
    return { key: `${m[1].toUpperCase()}${acc} ${mode(m[4])}`, rest: tidy(text.replace(m[0], ' ')) }
  }
  m = /\bin\s+(do|re|mi|fa|sol|la|si)(?:\s+(diesis|bemolle))?\s+(maggiore|minore)\b/i.exec(text)
  if (m) {
    const acc = m[2] ? (/diesis/i.test(m[2]) ? '#' : 'b') : ''
    return { key: `${IT_NOTE[m[1].toLowerCase()]}${acc} ${mode(m[3])}`, rest: tidy(text.replace(m[0], ' ')) }
  }
  m = /\b([A-Ha-h])(is|es|s)?[-\s]?(Moll|Dur)\b/i.exec(text)
  if (m) {
    let t = m[1].toUpperCase()
    let acc = m[2] ? (m[2].toLowerCase() === 'is' ? '#' : 'b') : ''
    if (t === 'H') t = 'B'
    else if (t === 'B' && !acc) acc = 'b'
    return { key: `${t}${acc} ${mode(m[3])}`, rest: tidy(text.replace(m[0], ' ')) }
  }
  m = /\b[Ii]n\s+([A-G])([#♯♭])?(?=[\s,.:;)]|$)/.exec(text)
  if (m) {
    const acc = m[2] ? (m[2] === '♭' ? 'b' : '#') : ''
    return { key: `${m[1]}${acc}`, rest: tidy(text.replace(m[0], ' ')) }
  }
  return { rest: text }
}

/** Compatibile se stessa tonica e (modo uguale oppure uno dei due ignoto). */
export function keyCompat(a?: string, b?: string): boolean {
  if (!a || !b) return false
  const [ta, ma] = a.split(' ')
  const [tb, mb] = b.split(' ')
  return ta === tb && (!ma || !mb || ma === mb)
}

// ---------- numero, movimento ----------

function detectNumber(s: string): number | undefined {
  const t = fold(s)
  let m = /(?:^|[\s,(])(?:nos?|nr|num|nº|n°|nro|n)\.?\s*(\d{1,3})(?!\d)/.exec(t)
  if (m) return +m[1]
  m = /\b(?:symphon(?:y|ie)|sinfon(?:ia|ie)|concert(?:o|i)|konzert|sonat(?:a|e)|quartet(?:t|to)?|quintet(?:t|to)?|trio|suite|partita|mass|messa|messe)\s+(\d{1,3})(?!\d)/.exec(t)
  if (m) return +m[1]
  m = /(?:^|[\s,(])(\d{1,3})(?:st|nd|rd|th|\.|º|°|a|ª|e|eme)?\s+(?:symphon|sinfon|konzert|concert|sonat|quart|quint)/.exec(t)
  return m ? +m[1] : undefined
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 }
function romanToInt(r: string): number | undefined {
  if (!/^(?:XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/.test(r) || !r) return undefined
  let n = 0
  for (let i = 0; i < r.length; i++) {
    const v = ROMAN[r[i]]
    n += v < (ROMAN[r[i + 1]] ?? 0) ? -v : v
  }
  return n
}

export function parseMovement(s: string): Movement {
  const t = s.trim()
  const m = /^(?:(?:No|Nr|N|Nº)\.?\s*)?(\d{1,2}|[IVXL]{1,6})\s*(?:[.):,]\s*|$)(.*)$/.exec(t)
  if (m) {
    const index = /^\d/.test(m[1]) ? +m[1] : romanToInt(m[1])
    if (index) return { index, title: m[2].trim() }
  }
  return { title: t }
}

// ---------- split opera / movimento ----------

/** Indice della prima occorrenza di `sep` fuori da virgolette. */
function indexOutsideQuotes(s: string, sep: string): number {
  let open = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '"' || c === '“' || c === '«') open = c === '"' ? !open : true
    else if (c === '”' || c === '»') open = false
    else if (!open && s.startsWith(sep, i)) return i
  }
  return -1
}

const hasWorkMarkers = (s: string) => extractCatalog(s).catalog.length > 0 || !!detectGenre(s)

function splitWorkMovement(t: string): [string, string?] {
  const i = indexOutsideQuotes(t, ': ')
  if (i > 0) {
    const left = t.slice(0, i)
    const right = t.slice(i + 2).trim()
    if (right) {
      // "Beethoven: Symphony No. 5 - I. Allegro": il prefisso è il compositore, non l'opera
      if (!hasWorkMarkers(left) && hasWorkMarkers(right)) return splitWorkMovement(right)
      return [left.trim(), right]
    }
  }
  for (const sep of [' - ', ' – ', ' — ']) {
    const j = indexOutsideQuotes(t, sep)
    if (j > 0 && hasWorkMarkers(t.slice(0, j))) return [t.slice(0, j).trim(), t.slice(j + sep.length).trim()]
  }
  return [t]
}

// "- 2011 Remastered Version", "(Live at ...)", ecc. in coda
const NOISE_WORD = String.raw`(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?(?:re-?master(?:ed)?|live\b|mono\b|stereo\b|remix|bonus)`
const NOISE = [
  new RegExp(String.raw`\s+[-–—]\s+${NOISE_WORD}.*$`, 'i'),
  new RegExp(String.raw`\s*[(\[]${NOISE_WORD}[^)\]]*[)\]]\s*$`, 'i')
]
function stripNoise(s: string) {
  for (let prev = ''; prev !== s; ) {
    prev = s
    for (const re of NOISE) s = s.replace(re, '')
  }
  return s
}

// ---------- entry point ----------

export function parseTitle(input: string): Parsed {
  const [workPart, mvPart] = splitWorkMovement(stripNoise(input.normalize('NFC').trim()))
  let s = workPart
  let nickname: string | undefined
  s = s.replace(/["“«]([^"”»]{2,40})["”»]/, (_m, n: string) => ((nickname = n.trim()), ' '))
  const { catalog, rest: r1 } = extractCatalog(s)
  const { key, rest } = extractKey(r1)
  const workTitle = tidy(rest)
  return {
    raw: workPart,
    workTitle,
    catalog,
    number: detectNumber(workTitle),
    key,
    genre: detectGenre(workTitle),
    nickname,
    movement: mvPart ? parseMovement(mvPart) : undefined
  }
}

/** Parse del brano con ripiego sul titolo album per tracce tipo "I. Allegro". */
export function parseTrack(name: string, albumName?: string): Parsed {
  const p = parseTitle(name)
  if (p.catalog.length || p.genre || !albumName) return p
  const a = parseTitle(albumName)
  if (!a.catalog.length && !a.genre) return p
  const mv = p.movement ?? parseMovement(name)
  return { ...a, movement: mv }
}
