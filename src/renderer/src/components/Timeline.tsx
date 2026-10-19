import { useEffect, useMemo, useRef, useState } from 'react'
import type { Lang, TimelineComposer, TimelineWork } from '../../../shared/types.ts'
import { epochName, useT } from '../lib/i18n.tsx'

type Props = {
  lang: Lang
  /** id Open Opus del compositore in ascolto: evidenziato e già selezionato. */
  currentId?: string
  onSearch: (query: string) => void
  onClose: () => void
}

const NOW = new Date().getFullYear()
const EPOCH_ORDER = ['Medieval', 'Renaissance', 'Baroque', 'Classical', 'Early Romantic', 'Romantic', 'Late Romantic', '20th Century', 'Post-War', '21st Century']
// tinte distribuite sull'arco delle epoche; luminosità fissa per restare leggibili
const epochColor = (e: string) => `hsl(${(EPOCH_ORDER.indexOf(e) * 36 + 20) % 360} 55% 62%)`

export function Timeline({ lang, currentId, onSearch, onClose }: Props) {
  const t = useT()
  const [composers, setComposers] = useState<TimelineComposer[]>()
  const [error, setError] = useState<string>()
  const [selected, setSelected] = useState<Set<string>>(new Set(currentId ? [currentId] : []))
  const [works, setWorks] = useState<Record<string, TimelineWork[] | 'loading'>>({})
  const currentRow = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.muti.metadata.timeline().then(setComposers, (e: Error) => setError(e.message))
  }, [])
  // porta l'autore in ascolto al centro, in verticale e in orizzontale (anche se il brano cambia a timeline aperta)
  useEffect(() => {
    const row = currentRow.current
    const box = body.current
    const bar = row?.querySelector('.tl-bar')
    if (!row || !box || !bar) return
    const b = bar.getBoundingClientRect()
    const c = box.getBoundingClientRect()
    box.scrollTo({
      top: box.scrollTop + row.getBoundingClientRect().top - c.top - c.height / 2,
      left: box.scrollLeft + b.left - c.left - c.width / 3,
      behavior: 'smooth'
    })
  }, [composers, currentId])

  const [min, max] = useMemo(() => {
    // prima del 1550 i compositori si troncano al bordo: sono pochi e sprecherebbero spazio
    return [1550, Math.ceil(NOW / 50) * 50]
  }, [composers])
  const pos = (y: number) => `${(Math.max(0, y - min) / (max - min)) * 100}%`
  const trackWidth = (max - min) * 5
  const ticks = useMemo(() => Array.from({ length: Math.floor((max - min) / 50) + 1 }, (_, i) => min + i * 50), [min, max])

  // le opere si caricano alla selezione (una richiesta per compositore, poi in cache)
  useEffect(() => {
    for (const id of selected) {
      const c = composers?.find((x) => x.id === id)
      if (!c || works[id]) continue
      setWorks((w) => ({ ...w, [id]: 'loading' }))
      window.muti.metadata.composerWorks(c.fullName, c.birth, lang).then(
        (list) =>
          setWorks((w) => ({
            ...w,
            // scarta date fuori dalla vita dell'autore (dati sporchi in Wikidata)
            [id]: list.filter((x) => x.year >= c.birth! + 5 && x.year <= (c.death ?? NOW))
          })),
        () => setWorks((w) => ({ ...w, [id]: [] }))
      )
    }
  }, [selected, composers, lang])

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  return (
    <div className="timeline" role="dialog" aria-label={t('timeline')}>
      <header className="tl-head">
        <h2>{t('timeline')}</h2>
        <p className="muted">{t('timelineHint')}</p>
        <button aria-label={t('close')} onClick={onClose}>×</button>
      </header>

      {error && <p className="error">{error}</p>}
      {!composers && !error && <p className="muted">{t('loading')}</p>}

      {composers && (
        <div className="tl-body" ref={body} style={{ ['--tl-w' as string]: `${trackWidth}px` }}>
          <div className="tl-axis">
            <span className="tl-name" />
            <div className="tl-track">
              {ticks.map((y) => (
                <span key={y} className="tl-tick" style={{ left: pos(y) }}>{y}</span>
              ))}
            </div>
          </div>
          {composers.filter((c) => (c.death ?? NOW) >= min).map((c) => {
            const isSel = selected.has(c.id)
            const list = works[c.id]
            const end = c.death ?? NOW
            return (
              <div key={c.id} ref={c.id === currentId ? currentRow : undefined} className={'tl-row' + (c.id === currentId ? ' current' : '') + (isSel ? ' sel' : '')}>
                <button className="tl-name" onClick={() => (onSearch(c.fullName), onClose())} aria-current={c.id === currentId ? 'true' : undefined} title={epochName(lang, c.epoch)}>
                  {c.id === currentId && <span aria-hidden>▶ </span>}
                  {c.name}
                </button>
                <div className="tl-track">
                  {ticks.map((y) => <i key={y} className="tl-grid" style={{ left: pos(y) }} />)}
                  <button
                    className="tl-bar"
                    onClick={() => toggle(c.id)}
                    aria-label={`${c.fullName} ${c.birth}–${c.death ?? ''}`}
                    style={{ left: pos(c.birth!), width: `calc(${pos(end)} - ${pos(c.birth!)})`, background: c.id === currentId ? undefined : epochColor(c.epoch) }}
                  />
                  {isSel && list === 'loading' && <span className="tl-loading" style={{ left: pos(c.birth!) }}>{t('loading')}</span>}
                  {isSel && Array.isArray(list) && list.map((w) => (
                    <button
                      key={w.title + w.year}
                      className="tl-dot"
                      style={{ left: pos(w.year) }}
                      title={`${w.title} · ${w.year}`}
                      aria-label={`${w.title}, ${w.year}`}
                      onClick={() => (onSearch(`${c.fullName} ${w.title}`), onClose())}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
