// Sezioni caricate dopo il primo paint: storia, biografia, opere correlate, ricerca manuale (SPEC §5.3, §7).
import type { Lang, RelatedGroup, RelatedItem, SourceRef, TextBlock, WorkCandidate, WorkRef } from '../../shared/types.ts'
import { memo } from './http.ts'
import { getWork, workComposerName } from './musicbrainz.ts'
import { ooPopularComposers, ooPopularWork, ooWorks, sameGenre } from './openopus.ts'
import { dice, normTokens, parseTitle } from './parse.ts'
import { rank, SRC, toWorkCandidates } from './resolve.ts'
import { cycleSiblings, findComposers, sitelinks, textCandidates } from './wikidata.ts'
import { wikiSummary, wikiText } from './wikipedia.ts'

const empty = (lang: Lang): TextBlock => ({ sections: [], lang, sources: [] })

/** Voce Wikipedia nella lingua richiesta, con ripiego (segnalato al chiamante) sull'altra lingua. */
async function wikipedia(qid: string, lang: Lang): Promise<TextBlock> {
  const links = await sitelinks(qid, lang)
  const order: Lang[] = lang === 'it' ? ['it', 'en'] : ['en', 'it']
  const l = order.find((x) => links[x])
  if (!l) return empty(lang)
  const title = links[l]!
  const [sum, text] = await Promise.all([wikiSummary(l, title).catch(() => null), wikiText(l, title).catch(() => null)])
  if (!sum && !text) return empty(lang)
  const source: SourceRef = {
    name: `Wikipedia (${l})`,
    url: sum?.url ?? `https://${l}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    license: SRC.wikipedia.license
  }
  return {
    summary: sum?.extract ?? text?.intro,
    sections: text?.sections.slice(0, 8) ?? [],
    wikiUrl: source.url,
    thumbnail: sum?.thumbnail,
    lang: l,
    sources: [source]
  }
}

export const workText = (ref: WorkRef, lang: Lang): Promise<TextBlock> =>
  ref.qid ? memo(`wtext:${lang}:${ref.qid}`, 30, () => wikipedia(ref.qid!, lang)) : Promise.resolve(empty(lang))

export const composerText = (qid: string, lang: Lang): Promise<TextBlock> =>
  memo(`ctext:${lang}:${qid}`, 30, () => wikipedia(qid, lang))

// ---------- opere correlate ----------

const spotifyQuery = (composer: string | undefined, title: string) => [composer, title].filter(Boolean).join(' ')

async function cycle(ref: WorkRef, lang: Lang): Promise<RelatedItem[]> {
  if (!ref.qid || !ref.partOfQid) return []
  const siblings = await cycleSiblings(ref.partOfQid, ref.qid, lang)
  siblings.sort((a, b) => (parseTitle(a.title).number ?? 999) - (parseTitle(b.title).number ?? 999))
  return siblings.map((w) => ({
    title: w.title,
    composer: ref.composerName,
    query: spotifyQuery(ref.composerName, w.title)
  }))
}

async function sameGenreWorks(ref: WorkRef): Promise<RelatedItem[]> {
  if (!ref.openOpusId || !ref.genre) return []
  const mine = normTokens(ref.title).join(' ')
  return sameGenre(await ooWorks(ref.openOpusId), ref.genre)
    .filter((w) => normTokens(parseTitle(w.title).workTitle).join(' ') !== mine)
    .slice(0, 6)
    .map((w) => ({ title: w.title, composer: ref.composerName, query: spotifyQuery(ref.composerName, w.title) }))
}

/**
 * Arrangiamenti e derivazioni (MusicBrainz). Senza filtro escono mashup e trailer: si tengono le opere
 * che somigliano all'originale e il cui compositore ha un item Wikidata (§7).
 */
async function derived(ref: WorkRef): Promise<RelatedItem[]> {
  if (!ref.mbid) return []
  const mb = await getWork(ref.mbid)
  const mine = normTokens(mb.title)
  const seen = new Set<string>()
  const plausible = mb.derived
    .filter((d) => d.title !== mb.title && (parseTitle(d.title).catalog.length > 0 || dice(mine, normTokens(d.title)) >= 0.5))
    .filter((d) => !seen.has(d.title) && !!seen.add(d.title))
    .slice(0, 6)
  const out: RelatedItem[] = []
  for (const d of plausible) {
    const name = await workComposerName(d.mbid).catch(() => undefined)
    if (name && (await findComposers(name).catch(() => [])).length) {
      out.push({ title: d.title, composer: name, query: spotifyQuery(name, d.title) })
    }
  }
  return out
}

async function contemporaries(ref: WorkRef): Promise<RelatedItem[]> {
  if (!ref.epoch) return []
  const peers = (await ooPopularComposers()).filter((c) => c.epoch === ref.epoch && c.id !== ref.openOpusId).slice(0, 3)
  const works = await Promise.all(peers.map((c) => ooPopularWork(c.id).catch(() => undefined)))
  return peers.flatMap((c, i) =>
    works[i] ? [{ title: works[i]!.title, composer: c.complete_name, query: spotifyQuery(c.complete_name, works[i]!.title) }] : []
  )
}

/** Quattro gruppi indipendenti: se una sorgente fallisce, gli altri restano. */
export async function related(ref: WorkRef, lang: Lang): Promise<RelatedGroup[]> {
  const jobs: [RelatedGroup['kind'], Promise<RelatedItem[]>][] = [
    ['cycle', cycle(ref, lang)],
    ['genre', sameGenreWorks(ref)],
    ['derived', derived(ref)],
    ['contemporary', contemporaries(ref)]
  ]
  const done = await Promise.allSettled(jobs.map(([, p]) => p))
  return jobs.flatMap(([kind], i) => {
    const r = done[i]
    return r.status === 'fulfilled' && r.value.length ? [{ kind, items: r.value.slice(0, 6) }] : []
  })
}

// ---------- ricerca manuale (correzione abbinamento) ----------

export async function searchWorks(query: string, composerQid: string | undefined): Promise<WorkCandidate[]> {
  const p = parseTitle(query)
  const cands = await textCandidates(composerQid, [query, normTokens(p.workTitle).join(' ')])
  return toWorkCandidates(rank(p, cands), 8, -1)
}
