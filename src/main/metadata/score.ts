// Scoring dei candidati opera (SPEC §6.2 fase 4). Funzione pura.
import {
  catalogRelation,
  dice,
  fold,
  keyCompat,
  normTokens,
  parseTitle,
  type Catalog,
  type Parsed
} from './parse.ts'

export type Cand = {
  source: 'wikidata' | 'musicbrainz' | 'openopus'
  qid?: string
  mbid?: string
  ooId?: string
  titles: string[] // etichette e alias, in qualunque lingua
  catalog?: Catalog[] // cataloghi noti dalla sorgente, oltre a quelli nei titoli
  key?: string
}

// Pesi iniziali della SPEC, da calibrare sul corpus (§10).
export const W = {
  catalog: 0.6,
  genreNumber: 0.25,
  key: 0.1,
  nickname: 0.1,
  dice: 0.3,
  catalogConflict: -1,
  // oltre la SPEC: stesso genere ma numero diverso (es. Sinfonia n. 5 vs n. 7)
  numberConflict: -0.3
}
export const AUTO = 0.6
export const PROBABLE = 0.35

export function scoreCandidate(p: Parsed, c: Cand): number {
  const parsed = c.titles.map(parseTitle)
  const catalogs: Catalog[] = [...(c.catalog ?? []), ...parsed.flatMap((x) => x.catalog)]
  const numbers = parsed.map((x) => x.number)
  const genres = new Set(parsed.map((x) => x.genre))
  const keys = [c.key, ...parsed.map((x) => x.key)]
  let s = 0

  const rel = catalogRelation(p.catalog, catalogs)
  if (rel === 'match') s += W.catalog
  else if (rel === 'conflict') s += W.catalogConflict

  if (p.genre && genres.has(p.genre)) {
    const compatible = p.number === undefined ? numbers.every((n) => n === undefined) : numbers.includes(p.number)
    if (compatible) s += W.genreNumber
    else if (p.number !== undefined && numbers.some((n) => n !== undefined)) s += W.numberConflict
  }

  if (p.key && keys.some((k) => keyCompat(p.key, k))) s += W.key

  if (p.nickname) {
    const nick = fold(p.nickname)
    if (c.titles.some((t) => fold(t).includes(nick))) s += W.nickname
  }

  const mine = normTokens(p.workTitle)
  s += W.dice * Math.max(0, ...parsed.map((x) => dice(mine, normTokens(x.workTitle))))
  return Math.min(1, s)
}

export type Confidence = 'certain' | 'probable' | 'none'
export const classify = (score: number): Confidence => (score >= AUTO ? 'certain' : score >= PROBABLE ? 'probable' : 'none')

/** Un candidato che descrive un solo movimento non è un'opera. */
export const isWholeWork = (c: Cand) =>
  c.titles.some((t) => !parseTitle(t).movement && !/^\s*(?:[IVX]{1,5}|\d{1,2})\s*[.)]\s/.test(t))
