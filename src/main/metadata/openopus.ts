// Open Opus: epoche, ritratti, opere "recommended"/"popular" (SPEC §3.1).
// Sorgente opzionale e sostituibile: ogni funzione deve poter fallire senza rompere il pannello.
import { fetchJson } from './http.ts'
import { dice, fold, normTokens, parseTitle } from './parse.ts'
import type { Cand } from './score.ts'

const OO = 'https://api.openopus.org'

export type OoComposer = { id: string; name: string; complete_name: string; birth?: string; death?: string; epoch: string; portrait?: string }
export type OoWork = { id: string; title: string; subtitle?: string; genre?: string; popular?: string; recommended?: string }

const yr = (s?: string) => s?.slice(0, 4)

/** Trova il compositore per cognome e conferma con anno di nascita o somiglianza del nome. */
export async function ooComposer(name: string, birthYear?: string): Promise<OoComposer | undefined> {
  const surname = fold(name).split(/\s+/).filter(Boolean).pop()
  if (!surname) return undefined
  const r = await fetchJson<{ composers?: OoComposer[] }>(`${OO}/composer/list/search/${encodeURIComponent(surname)}.json`)
  const mine = normTokens(name)
  return (r.composers ?? []).find(
    (c) => (birthYear && yr(c.birth) === birthYear) || dice(mine, normTokens(c.complete_name)) >= 0.6
  )
}

export async function ooWorks(composerId: string): Promise<OoWork[]> {
  const r = await fetchJson<{ works?: OoWork[] }>(`${OO}/work/list/composer/${encodeURIComponent(composerId)}/genre/all.json`)
  return r.works ?? []
}

/** Le opere Open Opus come candidati (il sottotitolo diventa soprannome tra virgolette). */
export async function ooCandidates(composerId: string): Promise<Cand[]> {
  return (await ooWorks(composerId)).map((w) => ({
    source: 'openopus' as const,
    ooId: w.id,
    titles: [w.subtitle ? `${w.title} "${w.subtitle}"` : w.title]
  }))
}

export async function ooPopularComposers(): Promise<OoComposer[]> {
  return (await fetchJson<{ composers?: OoComposer[] }>(`${OO}/composer/list/pop.json`)).composers ?? []
}

export async function ooPopularWork(composerId: string): Promise<OoWork | undefined> {
  const r = await fetchJson<{ works?: OoWork[] }>(`${OO}/work/list/composer/${encodeURIComponent(composerId)}/genre/Popular.json`)
  return r.works?.[0]
}

/** Opere dello stesso genere canonico dell'opera corrente: prima le consigliate, poi le popolari. */
export function sameGenre(works: OoWork[], genre: string, exclude?: string): OoWork[] {
  const rank = (w: OoWork) => (w.recommended === '1' ? 0 : w.popular === '1' ? 1 : 2)
  return works
    .filter((w) => parseTitle(w.title).genre === genre && (!exclude || w.title !== exclude))
    .sort((a, b) => rank(a) - rank(b))
    .filter((w) => rank(w) < 2)
}

