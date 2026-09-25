// IMSLP: solo campi strutturati del template, più il link alla partitura (SPEC §3.1).
// Nessun CORS → main process. Si memorizza solo il risultato estratto, non l'intera pagina wiki.
import { fetchJson, memo, q } from './http.ts'

export type ImslpInfo = {
  url: string
  composed?: string
  premiere?: string
  dedication?: string
  instrumentation?: string
  avgDurationMin?: number
  style?: string
  movements: string[]
}

export const imslpUrl = (page: string) => `https://imslp.org/wiki/${encodeURIComponent(page)}`

function clean(s: string): string {
  return s
    .replace(/\{\{LinkDed\|([^|}]*)\|([^|}]*)[^}]*\}\}/g, '$1 $2')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/'''?/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(?:,\s*)+$/, '')
    .trim()
}

/** Campi `|Chiave=valore` del blocco WORK INFO; le righe successive fino al prossimo `|` sono continuazione. */
function fields(wikitext: string): Record<string, string> {
  const start = wikitext.indexOf('WORK INFO')
  const out: Record<string, string> = {}
  let key: string | undefined
  for (const line of wikitext.slice(start < 0 ? 0 : start).split('\n')) {
    const m = /^\|\s*([^=|]+?)\s*=(.*)$/.exec(line)
    if (m) {
      key = m[1]
      if (!(key in out)) out[key] = m[2]
      else key = undefined
    } else if (key && !line.startsWith('|')) out[key] += '\n' + line
    else key = undefined
  }
  return out
}

export function parseImslp(wikitext: string, page: string): ImslpInfo {
  const f = fields(wikitext)
  const val = (k: string) => (f[k] ? clean(f[k]) || undefined : undefined)
  const movements = (f['Number of Movements/Sections'] ?? '')
    .split('\n')
    .filter((l) => l.startsWith('#'))
    .map((l) => clean(l.replace(/^#+/, '').replace(/\([^)]*\)/g, '')).replace(/[\s-]+$/, ''))
    .filter(Boolean)
  const dur = /(\d+)/.exec(val('Average Duration') ?? '')?.[1]
  return {
    url: imslpUrl(page),
    composed: val('Year/Date of Composition'),
    premiere: val('First Performance')?.split(/\s:/)[0],
    dedication: val('Dedication'),
    instrumentation: val('Instrumentation'),
    avgDurationMin: dur ? +dur : undefined,
    style: val('Piece Style'),
    movements
  }
}

export function imslpInfo(page: string): Promise<ImslpInfo | undefined> {
  return memo(`imslp:${page}`, 30, async () => {
    const r = await fetchJson<{ parse?: { wikitext?: { '*': string } } }>(
      `https://imslp.org/api.php?${q({ action: 'parse', page, prop: 'wikitext', format: 'json' })}`,
      { cache: false }
    )
    const text = r.parse?.wikitext?.['*']
    return text ? parseImslp(text, page) : undefined
  })
}
