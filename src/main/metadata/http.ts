// fetch con User-Agent, coda per host, retry e cache (SPEC §3, §4.1).
import { cacheGet, cacheSet, DAY } from './cache.ts'

// Wikimedia e MusicBrainz esigono un contatto nel User-Agent e limitano duramente chi non lo dà
// (verificato: 429 dopo ~4 richieste). Il contatto è un'impostazione dell'utente (email o URL).
let userAgent = `Muti/0.1.0 (${process.env.MUTI_CONTACT ?? 'contact not set'})`
export const setContact = (contact?: string) => {
  if (contact?.trim()) userAgent = `Muti/0.1.0 (${contact.trim().replace(/[\r\n()]+/g, ' ')})`
}

/** Iniettabile nei test: `fetch` finto e TTL infinito per riprodurre risposte registrate. */
export const net = {
  fetch: (url: string, init?: RequestInit) => globalThis.fetch(url, init),
  ttlOverride: undefined as number | undefined
}

export class HttpError extends Error {
  status: number
  constructor(status: number, url: string) {
    super(`HTTP ${status} ${url}`)
    this.status = status
  }
}

const GAP_MS: Record<string, number> = { 'musicbrainz.org': 1100, 'imslp.org': 600, 'query.wikidata.org': 150, 'www.wikidata.org': 120 }
const tails = new Map<string, Promise<unknown>>()
const lastStart = new Map<string, number>()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Serializza le richieste verso lo stesso host rispettando la pausa minima. */
function enqueue<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const gap = GAP_MS[host] ?? 0
  const run = (tails.get(host) ?? Promise.resolve()).then(async () => {
    const wait = (lastStart.get(host) ?? 0) + gap - Date.now()
    if (wait > 0) await sleep(wait)
    lastStart.set(host, Date.now())
    return fn()
  })
  tails.set(host, run.catch(() => {}))
  return run
}

const DEBUG = !!process.env.MUTI_DEBUG

async function request<T>(url: string, timeoutMs: number): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now()
    try {
      const res = await net.fetch(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs)
      })
      if ((res.status === 429 || res.status === 503) && attempt < 2) {
        await sleep(Math.min(+(res.headers.get('retry-after') ?? 2), 10) * 1000)
        continue
      }
      if (DEBUG) console.log(`[http] ${res.status} ${Date.now() - t0}ms ${decodeURIComponent(url).slice(0, 140)}`)
      if (!res.ok) throw new HttpError(res.status, url)
      return (await res.json()) as T
    } catch (e) {
      if (e instanceof HttpError || attempt >= 2) throw e
      await sleep(500 * (attempt + 1))
    }
  }
}

type FetchOpts = { ttlDays?: number; timeoutMs?: number; cache?: boolean }

export async function fetchJson<T>(url: string, o: FetchOpts = {}): Promise<T> {
  const useCache = o.cache !== false
  const hit = useCache ? await cacheGet<T>(url, net.ttlOverride ?? (o.ttlDays ?? 30) * DAY) : undefined
  if (hit !== undefined) return hit
  const data = await enqueue(new URL(url).host, () => request<T>(url, o.timeoutMs ?? 12000))
  if (useCache) await cacheSet(url, data)
  return data
}

/** Cache di un valore calcolato (es. campi estratti da una pagina troppo grande da tenere intera). */
export async function memo<T>(key: string, ttlDays: number, fn: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key, net.ttlOverride ?? ttlDays * DAY)
  if (hit !== undefined) return hit
  const v = await fn()
  await cacheSet(key, v)
  return v
}

/** Come fetchJson, ma null su 404 (pagina inesistente = risposta normale). */
export async function fetchJsonOrNull<T>(url: string, o?: FetchOpts): Promise<T | null> {
  try {
    return await fetchJson<T>(url, o)
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null
    throw e
  }
}

/** Limite di tempo per sorgente: la richiesta sottostante continua e riempie la cache. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
}

export const q = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')
