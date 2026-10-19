// Dati per la timeline: vite dei compositori (Open Opus) e opere principali con anno (Wikidata).
import type { Lang, TimelineComposer, TimelineWork } from '../../shared/types.ts'
import { memo } from './http.ts'
import { ooAllComposers } from './openopus.ts'
import { findComposers, notableWorks } from './wikidata.ts'

const yr = (s?: string) => (s && /^\d{4}/.test(s) ? +s.slice(0, 4) : undefined)

export const timeline = (): Promise<TimelineComposer[]> =>
  memo('timeline:composers', 30, async () =>
    (await ooAllComposers())
      .map((c) => ({ id: c.id, name: c.name, fullName: c.complete_name, birth: yr(c.birth), death: yr(c.death), epoch: c.epoch }))
      .filter((c) => c.birth)
      .sort((a, b) => a.birth! - b.birth!)
  )

export const composerWorks = (fullName: string, lang: Lang): Promise<TimelineWork[]> =>
  memo(`timeline:works:${lang}:${fullName}`, 30, async () => {
    const hit = (await findComposers(fullName))[0]
    return hit ? notableWorks(hit.qid, lang) : []
  })
