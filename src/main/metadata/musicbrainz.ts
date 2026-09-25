// MusicBrainz: gerarchia dei movimenti, derivazioni e link incrociati (SPEC §3.1). 1 req/s garantito da http.ts.
import { fetchJson, q } from './http.ts'
import { parseTitle } from './parse.ts'
import type { Cand } from './score.ts'

const MB = 'https://musicbrainz.org/ws/2'

type MbRel = {
  type: string
  direction: 'forward' | 'backward'
  'ordering-key'?: number
  work?: { id: string; title: string }
  url?: { resource: string }
  artist?: { name: string }
}
type MbWorkResp = {
  id: string
  title: string
  attributes?: { type: string; value: string }[]
  relations?: MbRel[]
}

/** Opere del compositore per testo libero; i movimenti figli compaiono tra i risultati e vanno filtrati a valle. */
export async function searchWorks(composerMbid: string, text: string): Promise<Cand[]> {
  const words = text.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (!words) return []
  const r = await fetchJson<{ works?: { id: string; title: string; aliases?: { name: string }[] }[] }>(
    `${MB}/work?${q({ query: `work:(${words}) AND arid:${composerMbid}`, fmt: 'json', limit: 10 })}`
  )
  return (r.works ?? []).map((w) => ({
    source: 'musicbrainz' as const,
    mbid: w.id,
    titles: [w.title, ...(w.aliases ?? []).map((a) => a.name)]
  }))
}

export type MbWork = {
  mbid: string
  title: string
  key?: string
  parts: { index: number; title: string }[]
  qid?: string
  imslpPage?: string
  derived: { mbid: string; title: string }[]
}

export async function getWork(mbid: string): Promise<MbWork> {
  const w = await fetchJson<MbWorkResp>(`${MB}/work/${mbid}?${q({ inc: 'work-rels+url-rels', fmt: 'json' })}`)
  const rels = w.relations ?? []
  const url = (type: string) => rels.find((r) => r.type === type && r.url)?.url?.resource
  const imslp = rels.map((r) => r.url?.resource).find((u) => u?.includes('imslp.org/wiki/'))
  const parts = rels
    .filter((r) => r.type === 'parts' && r.direction === 'forward' && r.work)
    .map((r, i) => ({ index: r['ordering-key'] ?? i + 1, title: parseTitle(r.work!.title).movement?.title ?? r.work!.title }))
    .sort((a, b) => a.index - b.index)
  return {
    mbid,
    title: w.title,
    key: w.attributes?.find((a) => a.type === 'Key')?.value,
    parts,
    qid: /Q\d+$/.exec(url('wikidata') ?? '')?.[0],
    imslpPage: imslp ? decodeURIComponent(imslp.split('imslp.org/wiki/')[1]) : undefined,
    derived: rels
      .filter((r) => r.direction === 'forward' && ['arrangement', 'orchestration', 'based on'].includes(r.type) && r.work)
      .map((r) => ({ mbid: r.work!.id, title: r.work!.title }))
  }
}

/** Nome del compositore di un'opera, per filtrare i mashup dalle derivazioni. */
export async function workComposerName(mbid: string): Promise<string | undefined> {
  const w = await fetchJson<MbWorkResp>(`${MB}/work/${mbid}?${q({ inc: 'artist-rels', fmt: 'json' })}`)
  return w.relations?.find((r) => r.type === 'composer' && r.artist)?.artist?.name
}
