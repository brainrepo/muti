// Wikidata: hub dei dati (SPEC §3.1). Solo dal main process.
import type { Lang } from '../../shared/types.ts'
import { fetchJson, memo, q } from './http.ts'
import { catalogLabel, fold, parseMovement, parseTitle, type Catalog } from './parse.ts'
import type { Cand } from './score.ts'

const SPARQL = 'https://query.wikidata.org/sparql'
const API = 'https://www.wikidata.org/w/api.php'
type Row = Record<string, string>

export const isQid = (s: string) => /^Q\d+$/.test(s)
const esc = (s: string) => s.replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ')

export async function sparql(query: string, timeoutMs = 15000): Promise<Row[]> {
  const r = await fetchJson<{ results: { bindings: Record<string, { value: string }>[] } }>(
    `${SPARQL}?${q({ format: 'json', query })}`,
    { timeoutMs }
  )
  return r.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])))
}

type Snak = { datavalue?: { value: any } }
type Statement = { mainsnak: Snak; qualifiers?: Record<string, Snak[]>; rank?: string }
type Entity = {
  labels?: Record<string, { value: string }>
  claims?: Record<string, Statement[]>
}

const qidOf = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1)
const year = (s?: string) => (s ? /^-?\d+/.exec(s)?.[0].replace(/^0+(?=\d)/, '') : undefined)

// ---------- compositori ----------

export type ComposerHit = { qid: string; name: string; mbid?: string }

const tokens = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1)

/** Il nome dell'artista deve essere contenuto nell'etichetta/alias (o viceversa): esclude omonimi parziali. */
const sameName = (artist: string, names: string[]) => {
  const a = tokens(artist)
  return names.some((n) => {
    const b = tokens(n)
    return a.length > 0 && b.length > 0 && (a.every((t) => b.includes(t)) || b.every((t) => a.includes(t)))
  })
}

/** Cerca per nome un compositore (P106 = compositore) con CirrusSearch: veloce, ordinato per rilevanza. */
export async function findComposers(name: string): Promise<ComposerHit[]> {
  const found = await fetchJson<{ query: { search: { title: string }[] } }>(
    `${API}?${q({ action: 'query', list: 'search', srsearch: `haswbstatement:P106=Q36834 haswbstatement:P31=Q5 ${name}`, srlimit: 3, format: 'json' })}`
  )
  const ids = found.query.search.map((s) => s.title).filter(isQid)
  if (!ids.length) return []
  const r = await fetchJson<{ entities: Record<string, { labels?: Record<string, { value: string }>; aliases?: Record<string, { value: string }[]> }> }>(
    `${API}?${q({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|aliases', languages: 'en', format: 'json' })}`
  )
  const hit = ids
    .map((id) => ({ id, e: r.entities[id] }))
    .find(({ e }) => sameName(name, [e?.labels?.en?.value ?? '', ...(e?.aliases?.en ?? []).map((a) => a.value)]))
  if (!hit) return []
  const c = await fetchJson<{ claims?: { P434?: Snak[] } }>(
    `${API}?${q({ action: 'wbgetclaims', entity: hit.id, property: 'P434', format: 'json' })}`
  )
  return [{ qid: hit.id, name: hit.e.labels?.en?.value ?? name, mbid: c.claims?.P434?.[0]?.datavalue?.value }]
}

export type ComposerInfo = {
  qid: string
  name: string
  birth?: string
  death?: string
  mbid?: string
  imageFile?: string
  wikiTitle: { it?: string; en?: string }
}

export async function composerInfo(qid: string, lang: Lang): Promise<ComposerInfo> {
  if (!isQid(qid)) throw new Error('QID non valido')
  // le affermazioni di un compositore sono molte: si estrae il necessario e si scarta il resto
  const r = await fetchJson<{
    entities: Record<string, Entity & { sitelinks?: Record<string, { title: string }> }>
  }>(
    `${API}?${q({ action: 'wbgetentities', ids: qid, props: 'claims|labels|sitelinks', languages: `${lang}|en`, sitefilter: 'itwiki|enwiki', format: 'json' })}`,
    { cache: false }
  )
  const e = r.entities[qid]
  const first = (p: string) => e.claims?.[p]?.find((s) => s.rank !== 'deprecated')?.mainsnak.datavalue?.value
  return {
    qid,
    name: e.labels?.[lang]?.value ?? e.labels?.en?.value ?? qid,
    birth: fmtTime(first('P569'))?.slice(0, 4),
    death: fmtTime(first('P570'))?.slice(0, 4),
    mbid: first('P434'),
    imageFile: first('P18'),
    wikiTitle: { it: e.sitelinks?.itwiki?.title, en: e.sitelinks?.enwiki?.title }
  }
}

/** Ritratto da Commons con autore e licenza (mostrati al passaggio del mouse). */
export async function commonsImage(file: string): Promise<{ url: string; credit: string } | undefined> {
  const r = await fetchJson<{
    query: { pages: Record<string, { imageinfo?: { thumburl: string; extmetadata?: Record<string, { value: string }> }[] }> }
  }>(
    `https://commons.wikimedia.org/w/api.php?${q({
      action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: 360, format: 'json'
    })}`
  )
  const info = Object.values(r.query.pages)[0]?.imageinfo?.[0]
  if (!info) return undefined
  const strip = (s?: string) => s?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  const artist = strip(info.extmetadata?.Artist?.value)
  const license = strip(info.extmetadata?.LicenseShortName?.value)
  return { url: info.thumburl, credit: [artist, license].filter(Boolean).join(' · ') || 'Wikimedia Commons' }
}

// ---------- link Wikipedia ----------

export type Sitelinks = { it?: string; en?: string; label?: string }
export async function sitelinks(qid: string, lang: Lang): Promise<Sitelinks> {
  if (!isQid(qid)) return {}
  const r = await fetchJson<{
    entities: Record<string, { sitelinks?: Record<string, { title: string }>; labels?: Record<string, { value: string }> }>
  }>(
    `${API}?${q({ action: 'wbgetentities', ids: qid, props: 'sitelinks|labels', sitefilter: 'itwiki|enwiki', languages: `${lang}|en`, format: 'json' })}`
  )
  const e = r.entities[qid]
  return { it: e?.sitelinks?.itwiki?.title, en: e?.sitelinks?.enwiki?.title, label: e?.labels?.[lang]?.value ?? e?.labels?.en?.value }
}

// ---------- candidati opera ----------

// Nome del catalogo (qualificatore P972) → sistema riconosciuto dal parser
const SYSTEM_BY_LABEL: [RegExp, string][] = [
  [/opus/i, 'Op'], [/bach.?werke|bwv|schmieder/i, 'BWV'], [/k[oö]chel/i, 'K'], [/deutsch/i, 'D'],
  [/hoboken/i, 'Hob'], [/ryom|vivaldi/i, 'RV'], [/h[aä]ndel|hwv/i, 'HWV'], [/searle|liszt/i, 'S'], [/lesure|debussy/i, 'L']
]

function parseCode(code: string, cat?: string): Catalog[] {
  const c = parseTitle(code).catalog
  if (c.length) return c
  const m = /^(\d+[a-z]?)(?:\s*[/,]\s*(?:no\.?\s*)?(\d+))?$/i.exec(code.trim())
  if (!m) return []
  // un numero nudo è quasi sempre il numero d'opus, salvo che il qualificatore nomini un altro catalogo
  const system = cat ? SYSTEM_BY_LABEL.find(([re]) => re.test(cat))?.[1] : 'Op'
  return system ? [{ system, number: m[1].toLowerCase(), ...(m[2] ? { sub: m[2] } : {}) }] : []
}

/**
 * Etichette, alias, cataloghi (P528 e qualificatori di P361), tonalità e MBID per un gruppo di opere.
 * Via API e non SPARQL: WDQS ha latenza molto variabile (1–10 s), l'API risponde in ~200 ms.
 */
async function hydrate(input: string[]): Promise<Cand[]> {
  const ids = [...new Set(input.filter(isQid))].slice(0, 20).sort()
  if (!ids.length) return []
  return memo(`hydrate:${ids.join(',')}`, 30, async () => {
    const r = await fetchJson<{ entities: Record<string, Entity & { aliases?: Record<string, { value: string }[]> }> }>(
      `${API}?${q({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|aliases|claims', languages: 'en|it|de|fr', format: 'json' })}`,
      { cache: false }
    )
    const need: string[] = []
    for (const e of Object.values(r.entities)) {
      for (const s of e.claims?.P528 ?? []) need.push(s.qualifiers?.P972?.[0]?.datavalue?.value?.id)
      need.push(...(e.claims?.P826 ?? []).map((s) => s.mainsnak.datavalue?.value?.id))
    }
    const L = await labelsOf(need.filter(Boolean), 'en')
    return ids.flatMap((qid): Cand[] => {
      const e = r.entities[qid]
      if (!e) return []
      const titles = [
        ...Object.values(e.labels ?? {}).map((l) => l.value),
        ...['en', 'it'].flatMap((l) => (e.aliases?.[l] ?? []).slice(0, 4).map((a) => a.value))
      ]
      const catalog = [
        ...(e.claims?.P528 ?? []).flatMap((s) =>
          parseCode(String(s.mainsnak.datavalue?.value ?? ''), s.qualifiers?.P972 ? L[s.qualifiers.P972[0].datavalue?.value?.id] : undefined)
        ),
        ...(e.claims?.P361 ?? []).flatMap((s) => (s.qualifiers?.P528 ?? []).flatMap((c) => parseCode(String(c.datavalue?.value ?? ''))))
      ]
      const keyLabel = L[e.claims?.P826?.[0]?.mainsnak.datavalue?.value?.id]
      return [
        {
          source: 'wikidata',
          qid,
          titles: [...new Set(titles)],
          catalog,
          key: keyLabel ? parseTitle(`x in ${keyLabel}`).key : undefined,
          mbid: e.claims?.P435?.[0]?.mainsnak.datavalue?.value
        }
      ]
    })
  })
}

const search = (srsearch: string, limit = 8) =>
  fetchJson<{ query: { search: { title: string }[] } }>(
    `${API}?${q({ action: 'query', list: 'search', srsearch, srlimit: limit, format: 'json' })}`
  ).then((r) => r.query.search.map((s) => s.title).filter(isQid))

/**
 * Opere del compositore con il numero di catalogo dato. Il formato in P528 varia da item a item
 * ("1048", "K. 550", "Opus 67"): si provano le forme più comuni. Non trova i cataloghi solo nei
 * qualificatori di P361 (es. Quinta di Beethoven): a quelli pensa la ricerca testuale.
 */
export async function catalogCandidates(composerQid: string, catalogs: Catalog[]): Promise<Cand[]> {
  if (!isQid(composerQid) || !catalogs.length) return []
  const forms = catalogs.slice(0, 2).flatMap((c) => {
    const n = c.number.toUpperCase()
    return [n, `${c.system}. ${n}`, `${c.system} ${n}`, ...(c.system === 'Op' ? [`Opus ${n}`] : [])]
  })
  const found = await Promise.all(
    [...new Set(forms)].map((f) => search(`haswbstatement:P86=${composerQid} haswbstatement:"P528=${f}"`, 5))
  )
  return hydrate(found.flat())
}

/** Ricerca full-text (CirrusSearch) tra le opere di un compositore, poi reidratazione. */
export async function textCandidates(composerQid: string | undefined, texts: string[]): Promise<Cand[]> {
  const scope = composerQid && isQid(composerQid) ? `haswbstatement:P86=${composerQid}` : 'haswbprop:P86'
  const uniq = [...new Map(texts.filter((t) => t.trim()).map((t) => [t.trim().toLowerCase(), t.trim()])).values()]
  const found = await Promise.all(uniq.map((t) => search(`${scope} ${t}`)))
  return hydrate(found.flat())
}

// ---------- dettaglio opera ----------

const entity = async (qid: string) =>
  (await fetchJson<{ entities: Record<string, Entity> }>(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`))
    .entities[qid]

async function labelsOf(ids: string[], lang: Lang): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const uniq = [...new Set(ids.filter(isQid))]
  for (let i = 0; i < uniq.length; i += 50) {
    const r = await fetchJson<{ entities: Record<string, Entity> }>(
      `${API}?${q({ action: 'wbgetentities', ids: uniq.slice(i, i + 50).join('|'), props: 'labels', languages: `${lang}|en`, format: 'json' })}`
    )
    for (const [id, e] of Object.entries(r.entities)) out[id] = e.labels?.[lang]?.value ?? e.labels?.en?.value ?? id
  }
  return out
}

function fmtTime(v?: { time: string; precision: number }): string | undefined {
  if (!v) return undefined
  const m = /^[+-](\d+)-(\d\d)-(\d\d)/.exec(v.time)
  if (!m) return undefined
  const y = String(+m[1])
  return v.precision >= 11 ? `${y}-${m[2]}-${m[3]}` : v.precision === 10 ? `${y}-${m[2]}` : y
}

export type WikidataWork = {
  title: string
  catalog?: string
  key?: string
  composed?: string
  instrumentation?: string
  premiere?: { date?: string; place?: string }
  dedicatee?: string[]
  partOf?: { qid: string; title: string }
  movements: { index: number; title: string }[]
  composerQid?: string
  mbid?: string
  imslpPage?: string
}

export async function workDetails(qid: string, lang: Lang): Promise<WikidataWork> {
  if (!isQid(qid)) throw new Error('QID non valido')
  const e = await entity(qid)
  const claims = e.claims ?? {}
  const st = (p: string) => (claims[p] ?? []).filter((s) => s.rank !== 'deprecated')
  const val = (p: string) => st(p).map((s) => s.mainsnak.datavalue?.value)
  const ids = (p: string): string[] => val(p).map((v) => v?.id).filter(Boolean)

  const codeStmt = st('P528')[0]
  const catId = codeStmt?.qualifiers?.P972?.[0]?.datavalue?.value?.id as string | undefined
  const partStmts = [...st('P361'), ...st('P179')]
  // "parte di" utile = ciclo/serie (con ordinale o P179); gli elenchi di opere hanno il catalogo come qualificatore
  const cycle = partStmts.find((s) => s.qualifiers?.P1545) ?? st('P179')[0] ?? partStmts.find((s) => !s.qualifiers?.P528)
  const cycleId = cycle?.mainsnak.datavalue?.value?.id as string | undefined
  const parts = st('P527')
    .map((s) => ({ id: s.mainsnak.datavalue?.value?.id as string, n: +(s.qualifiers?.P1545?.[0]?.datavalue?.value ?? 0) }))
    .filter((p) => p.id)

  const L = await labelsOf(
    [
      ...ids('P826'), ...ids('P825'), ...ids('P870'), ...ids('P4647'), ...(catId ? [catId] : []),
      ...(cycleId ? [cycleId] : []), ...parts.map((p) => p.id)
    ],
    lang
  )

  const rawCode: string | undefined =
    codeStmt?.mainsnak.datavalue?.value ?? partStmts.find((s) => s.qualifiers?.P528)?.qualifiers?.P528?.[0]?.datavalue?.value
  let catalog: string | undefined
  if (rawCode) {
    const c = parseCode(rawCode, catId ? L[catId] : undefined)[0]
    catalog = c ? catalogLabel(c) : rawCode
  }

  const start = fmtTime(val('P571')[0])
  const end = fmtTime(st('P571')[0]?.qualifiers?.P1326?.[0]?.datavalue?.value)
  const place = ids('P4647')[0] ? L[ids('P4647')[0]] : undefined

  const ordered = parts.map((p, i) => ({ ...p, n: p.n || i + 1 })).sort((a, b) => a.n - b.n)
  return {
    title: e.labels?.[lang]?.value ?? e.labels?.en?.value ?? qid,
    catalog,
    key: ids('P826')[0] && L[ids('P826')[0]],
    composed: start && end && end !== start ? `${start}–${end}` : start,
    instrumentation: ids('P870').map((i) => L[i]).join(', ') || undefined,
    premiere: val('P1191')[0] || place ? { date: fmtTime(val('P1191')[0]), place } : undefined,
    dedicatee: ids('P825').map((i) => L[i]),
    partOf: cycleId ? { qid: cycleId, title: L[cycleId] } : undefined,
    movements: ordered.map((p, i) => ({ index: i + 1, title: parseMovement(L[p.id]).title })),
    composerQid: ids('P86')[0],
    mbid: val('P435')[0],
    imslpPage: val('P839')[0]
  }
}

/** Opere dello stesso ciclo/serie (P361, P179), escluso `selfQid`. */
export async function cycleSiblings(cycleQid: string, selfQid: string, lang: Lang): Promise<{ qid: string; title: string }[]> {
  if (!isQid(cycleQid) || !isQid(selfQid)) return []
  const rows = await sparql(`SELECT DISTINCT ?w ?l WHERE {
    { ?w wdt:P361 wd:${cycleQid} } UNION { ?w wdt:P179 wd:${cycleQid} }
    FILTER(?w != wd:${selfQid})
    SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en" . ?w rdfs:label ?l }
  } LIMIT 6`)
  return rows.map((r) => ({ qid: qidOf(r.w), title: r.l }))
}

/** Le opere più note del compositore con anno di composizione (P571), ordinate per notorietà (sitelinks). */
export async function notableWorks(qid: string, lang: Lang): Promise<{ title: string; year: number }[]> {
  if (!isQid(qid)) return []
  const rows = await sparql(`SELECT ?w ?l ?d ?n WHERE {
    ?w wdt:P86 wd:${qid} ; wdt:P571 ?d ; wikibase:sitelinks ?n .
    FILTER(?n >= 4)
    SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en" . ?w rdfs:label ?l }
  } ORDER BY DESC(?n) LIMIT 80`, 30000)
  const seen = new Set<string>()
  return rows
    .filter((r) => !/^\s*(?:[IVX]{1,5}|\d{1,2})[.)]\s/.test(r.l) && !seen.has(r.w) && !!seen.add(r.w))
    .flatMap((r) => {
      const y = year(r.d)
      return y ? [{ title: r.l, year: +y }] : []
    })
    .slice(0, 30)
}
