// Wikipedia (it, en): riassunto e testo a sezioni in plaintext (SPEC §3.1).
// Il testo non contiene HTML e viene mostrato come testo: niente da sanificare.
import type { Lang, TextSection } from '../../shared/types.ts'
import { fetchJsonOrNull, q } from './http.ts'

export type WikiSummary = { extract: string; url: string; thumbnail?: string }

export async function wikiSummary(lang: Lang, title: string): Promise<WikiSummary | null> {
  const r = await fetchJsonOrNull<{
    extract?: string
    thumbnail?: { source: string }
    content_urls?: { desktop?: { page: string } }
  }>(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`)
  if (!r?.extract) return null
  return {
    extract: r.extract,
    thumbnail: r.thumbnail?.source,
    url: r.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
  }
}

const SKIP =
  /^(note|notes|bibliografia|bibliography|voci correlate|see also|altri progetti|collegamenti esterni|external links|discografia|discography|references|further reading|sources|riferimenti|fonti|footnotes|citations)$/i
const MAX = 5000

/** Sezioni di primo livello; le sotto-sezioni restano nel testo come righe di titolo. */
export function splitSections(text: string): { intro: string; sections: TextSection[] } {
  const parts = text.split(/^==\s*([^=][^\n]*?)\s*==\s*$/m)
  const tidy = (s: string) =>
    s
      .replace(/^={3,}\s*(.*?)\s*={3,}\s*$/gm, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  const sections: TextSection[] = []
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i].trim()
    let body = tidy(parts[i + 1] ?? '')
    if (!body || SKIP.test(heading)) continue
    if (body.length > MAX) body = body.slice(0, body.lastIndexOf('\n', MAX) > 0 ? body.lastIndexOf('\n', MAX) : MAX) + ' …'
    sections.push({ heading, text: body })
  }
  return { intro: tidy(parts[0] ?? ''), sections }
}

export async function wikiText(lang: Lang, title: string) {
  const r = await fetchJsonOrNull<{ query: { pages: Record<string, { extract?: string }> } }>(
    `https://${lang}.wikipedia.org/w/api.php?${q({
      action: 'query', prop: 'extracts', explaintext: 1, exsectionformat: 'wiki', titles: title, redirects: 1, format: 'json'
    })}`
  )
  const extract = r && Object.values(r.query.pages)[0]?.extract
  return extract ? splitSections(extract) : null
}
