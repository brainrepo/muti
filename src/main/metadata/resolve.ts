// Pipeline brano → opera (SPEC §6). Entry point: resolveTrack().
import { createHash } from 'node:crypto'
import type { Composer, Lang, ResolvedTrack, SourceRef, TrackCtx, Work, WorkCandidate } from '../../shared/types.ts'
import { cacheGet, cacheSet, DAY } from './cache.ts'
import { net, memo, withTimeout } from './http.ts'
import { commonsImage, composerInfo, findComposers, textCandidates, catalogCandidates, workDetails, type ComposerHit } from './wikidata.ts'
import { getWork, searchWorks, type MbWork } from './musicbrainz.ts'
import { ooCandidates, ooComposer } from './openopus.ts'
import { imslpInfo, type ImslpInfo } from './imslp.ts'
import { catalogLabel, dice, normTitle, normTokens, parseTitle, parseTrack, type Parsed } from './parse.ts'
import { AUTO, PROBABLE, isWholeWork, scoreCandidate, type Cand } from './score.ts'

const SOURCE_TIMEOUT = 4000
// soglia per riconoscere, tra i candidati Wikidata, la stessa opera scelta da MusicBrainz/Open Opus
const LINK = 0.5
const NOT_A_PERSON =
  /orchest|philharmon|symphon|quartet|quartett|ensemble|choir|\bchor\b|consort|players|academy|collegium|kammer|sinfonia|camerata|singers|\btrio\b|orkest|filarmon|\bband\b|various/i

export const SRC = {
  wikidata: { name: 'Wikidata', url: 'https://www.wikidata.org', license: 'CC0' },
  wikipedia: { name: 'Wikipedia', url: 'https://www.wikipedia.org', license: 'CC BY-SA 4.0' },
  musicbrainz: { name: 'MusicBrainz', url: 'https://musicbrainz.org', license: 'CC0' },
  openopus: { name: 'Open Opus', url: 'https://openopus.org', license: 'Public domain' },
  imslp: { name: 'IMSLP', url: 'https://imslp.org', license: 'CC BY-SA 4.0' },
  commons: { name: 'Wikimedia Commons', url: 'https://commons.wikimedia.org', license: 'vari' }
} satisfies Record<string, SourceRef>

const catStr = (c: { system: string; number: string; sub?: string }) => `${c.system}${c.number}${c.sub ? '/' + c.sub : ''}`

/** Chiave dell'override: album + prefisso opera. Si conserva solo l'hash (nessun metadato Spotify su disco). */
export function overrideKeyOf(albumId: string, p: Parsed): string {
  return createHash('sha1').update(`${albumId}|${normTitle(p.workTitle)}|${p.catalog.map(catStr).join(',')}`).digest('hex')
}

// ---------- compositore ----------

/** Artisti che risultano compositori (in ordine di apparizione). */
async function composersFor(artists: TrackCtx['artists']): Promise<ComposerHit[]> {
  const found = await Promise.all(
    artists
      .filter((a) => !NOT_A_PERSON.test(a.name))
      .slice(0, 6)
      .map((a) => findComposers(a.name).then((r) => r[0], () => undefined))
  )
  const seen = new Set<string>()
  return found.filter((c): c is ComposerHit => !!c && !seen.has(c.qid) && !!seen.add(c.qid))
}

export function buildComposer(qid: string, lang: Lang): Promise<Composer> {
  return memo(`composer:${lang}:${qid}`, 30, async () => {
    const info = await composerInfo(qid, lang)
    const [oo, img] = await Promise.all([
      ooComposer(info.name, info.birth).catch(() => undefined),
      info.imageFile ? commonsImage(info.imageFile).catch(() => undefined) : undefined
    ])
    const wiki = info.wikiTitle
    const l = lang === 'it' && wiki.it ? 'it' : wiki.en ? 'en' : wiki.it ? 'it' : undefined
    return {
      qid,
      name: info.name,
      birth: info.birth,
      death: info.death,
      mbid: info.mbid,
      epoch: oo?.epoch,
      openOpusId: oo?.id,
      portraitUrl: img?.url ?? oo?.portrait,
      portraitCredit: img ? img.credit : oo?.portrait ? 'Open Opus' : undefined,
      wikiUrl: l ? `https://${l}.wikipedia.org/wiki/${encodeURIComponent((wiki[l] as string).replace(/ /g, '_'))}` : undefined
    }
  })
}

// ---------- candidati ----------

export async function gather(comp: { qid: string; mbid?: string }, p: Parsed, oo?: Promise<Cand[]>): Promise<Cand[]> {
  const core = normTokens(p.workTitle).join(' ')
  const plain = p.workTitle.replace(/\b(?:no|nr|nos)\.?\s+/gi, '')
  const mbText = `${core} ${p.catalog.map((c) => `${c.system} ${c.number}`).join(' ')}`
  const tasks: Promise<Cand[]>[] = [
    withTimeout(catalogCandidates(comp.qid, p.catalog), SOURCE_TIMEOUT),
    withTimeout(textCandidates(comp.qid, [core, plain, p.nickname ?? '']), SOURCE_TIMEOUT),
    comp.mbid ? withTimeout(searchWorks(comp.mbid, mbText), SOURCE_TIMEOUT) : Promise.resolve([]),
    oo ? withTimeout(oo, SOURCE_TIMEOUT) : Promise.resolve([])
  ]
  return (await Promise.allSettled(tasks)).flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

export type Ranked = { cand: Cand; score: number }

export function rank(p: Parsed, cands: Cand[]): Ranked[] {
  return cands
    .filter(isWholeWork)
    .map((cand) => ({ cand, score: scoreCandidate(p, cand) }))
    .sort((a, b) => b.score - a.score)
}

const candTitle = (c: Cand) => c.titles[0] ?? ''
const candCatalog = (c: Cand) => {
  const k = c.catalog?.[0] ?? parseTitle(candTitle(c)).catalog[0]
  return k ? catalogLabel(k) : undefined
}

/** Candidati distinti per la UI (stessa opera da più fonti → una sola riga). */
export function toWorkCandidates(ranked: Ranked[], max = 5, floor = 0.1): WorkCandidate[] {
  const seen = new Set<string>()
  const out: WorkCandidate[] = []
  for (const { cand, score } of ranked) {
    const pt = parseTitle(candTitle(cand))
    const k = `${normTitle(pt.workTitle)}|${candCatalog(cand) ?? ''}`
    if (seen.has(k) || score <= floor) continue
    seen.add(k)
    out.push({ qid: cand.qid, mbid: cand.mbid, title: candTitle(cand), catalog: candCatalog(cand), score: +score.toFixed(2), source: cand.source })
    if (out.length >= max) break
  }
  return out
}

/** Se il vincitore non ha QID (MusicBrainz/Open Opus), cerca lo stesso lavoro tra i candidati Wikidata. */
function linkQid(winner: Cand, all: Cand[]): string | undefined {
  if (winner.qid) return winner.qid
  const asTrack = parseTitle(candTitle(winner))
  const best = rank(asTrack, all.filter((c) => c.qid))[0]
  return best && best.score >= LINK ? best.cand.qid : undefined
}

// ---------- opera ----------

export async function buildWork(
  ref: { qid?: string; mbid?: string; fallbackTitle?: string; genre?: string },
  lang: Lang
): Promise<{ work: Work; composerQid?: string; sources: SourceRef[] }> {
  const sources: SourceRef[] = []
  let { qid, mbid } = ref
  let mbEarly: MbWork | undefined
  if (!qid && mbid) {
    mbEarly = await getWork(mbid).catch(() => undefined)
    qid = mbEarly?.qid
  }
  const wd = qid ? await workDetails(qid, lang).catch(() => undefined) : undefined
  if (wd) sources.push(SRC.wikidata)
  mbid ??= wd?.mbid
  const mb = mbEarly ?? (mbid ? await getWork(mbid).catch(() => undefined) : undefined)
  if (mb) sources.push(SRC.musicbrainz)
  const page = wd?.imslpPage ?? mb?.imslpPage
  const im: ImslpInfo | undefined = page ? await imslpInfo(page).catch(() => undefined) : undefined
  if (im) sources.push(SRC.imslp)

  const fromTitle = parseTitle(mb?.title ?? ref.fallbackTitle ?? '')
  const movements = mb?.parts.length
    ? mb.parts
    : wd?.movements.length
      ? wd.movements
      : (im?.movements ?? []).map((title, i) => ({ index: i + 1, title }))

  const work: Work = {
    qid,
    mbid,
    title: wd?.title ?? (fromTitle.workTitle || ref.fallbackTitle || ''),
    catalog: wd?.catalog ?? (fromTitle.catalog[0] ? catalogLabel(fromTitle.catalog[0]) : undefined),
    key: wd?.key ?? mb?.key ?? fromTitle.key,
    composed: wd?.composed ?? im?.composed,
    // il P136 di Wikidata è spesso generico ("musica classica"): il genere canonico viene dal titolo
    genre: ref.genre ?? parseTitle(wd?.title ?? fromTitle.workTitle).genre,
    instrumentation: wd?.instrumentation ?? im?.instrumentation,
    premiere: wd?.premiere ?? (im?.premiere ? { date: im.premiere } : undefined),
    dedicatee: wd?.dedicatee?.length ? wd.dedicatee : im?.dedication ? [im.dedication] : undefined,
    avgDurationMin: im?.avgDurationMin,
    partOf: wd?.partOf,
    movements,
    imslpUrl: im?.url,
    lang
  }
  return { work, composerQid: wd?.composerQid, sources }
}

/** Indice del movimento: dal titolo, poi per somiglianza con i `parts`. */
export function movementIndexOf(p: Parsed, work?: Work): number | undefined {
  if (p.movement?.index) return p.movement.index
  if (!p.movement?.title || !work?.movements.length) return undefined
  const mine = normTokens(p.movement.title)
  const best = work.movements
    .map((m) => ({ i: m.index, d: dice(mine, normTokens(m.title)) }))
    .sort((a, b) => b.d - a.d)[0]
  return best && best.d >= 0.6 ? best.i : undefined
}

// ---------- entry point ----------

type Core = Omit<ResolvedTrack, 'overrideKey' | 'movementIndex'>
const none: Core = { confidence: 'none', sources: [] }

async function resolveCore(t: TrackCtx, p: Parsed, lang: Lang, override?: string): Promise<Core> {
  if (override) {
    const { work, composerQid, sources } = await buildWork({ qid: override, genre: p.genre }, lang)
    const composer = composerQid ? await buildComposer(composerQid, lang).catch(() => undefined) : undefined
    return { confidence: 'certain', composer, work, sources: [...sources, ...(composer ? [SRC.wikidata] : [])] }
  }

  const comps = await composersFor(t.artists)
  if (!comps.length) return none

  // Ambiguità (es. un direttore che è anche compositore): vince chi ha il corpus più vicino al brano.
  const perComposer = await Promise.all(
    comps.slice(0, 3).map(async (comp) => {
      const composerP = buildComposer(comp.qid, lang).catch(() => undefined)
      const oo = composerP.then((c) => (c?.openOpusId ? ooCandidates(c.openOpusId) : []))
      const [composer, cands] = await Promise.all([composerP, gather(comp, p, oo)])
      return { comp, composer, cands, ranked: rank(p, cands) }
    })
  )
  const best = perComposer.reduce((a, b) => ((b.ranked[0]?.score ?? 0) > (a.ranked[0]?.score ?? 0) ? b : a))
  const top = best.ranked[0]

  if (!top || top.score < PROBABLE) {
    const first = perComposer[0]
    // un "compositore" fuori da Open Opus e senza segnali classici nel titolo è quasi sempre musica leggera
    const classical = first.composer?.openOpusId || p.catalog.length || p.genre
    return first.composer && classical
      ? { confidence: 'composer-only', composer: first.composer, sources: [SRC.wikidata] }
      : none
  }
  const qid = linkQid(top.cand, best.cands)
  const { work, sources } = await buildWork({ qid, mbid: top.cand.mbid, fallbackTitle: candTitle(top.cand), genre: p.genre }, lang)
  return {
    confidence: top.score >= AUTO ? 'certain' : 'probable',
    composer: best.composer,
    work,
    candidates: toWorkCandidates(best.ranked),
    sources: [...new Map([SRC.wikidata, ...sources, ...(best.composer?.epoch ? [SRC.openopus] : [])].map((s) => [s.name, s])).values()]
  }
}

export type ResolveDeps = { override?: (key: string) => string | undefined }

export async function resolveTrack(t: TrackCtx, lang: Lang, deps: ResolveDeps = {}): Promise<ResolvedTrack> {
  const p = parseTrack(t.name, t.albumName)
  const overrideKey = overrideKeyOf(t.albumId, p)
  const ov = deps.override?.(overrideKey)
  const cacheKey = `resolve:${lang}:${overrideKey}:${ov ?? ''}`
  let core = await cacheGet<Core>(cacheKey, net.ttlOverride ?? 7 * DAY)
  if (!core) {
    core = await resolveCore(t, p, lang, ov).catch(() => none)
    // un risultato senza opera può dipendere da un timeout: non lo fissiamo per 7 giorni
    if (core.work) await cacheSet(cacheKey, core)
  }
  return { ...core, overrideKey, movementIndex: movementIndexOf(p, core.work) }
}
