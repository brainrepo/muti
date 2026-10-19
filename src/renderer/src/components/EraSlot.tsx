import { useMemo } from 'react'
import type { Composer, TimelineComposer, Work } from '../../../shared/types.ts'
import { useAsync } from '../lib/hooks.ts'
import { useT } from '../lib/i18n.tsx'

const SPAN = 100
const NOW = new Date().getFullYear()

/** Striscia di 100 anni centrata sull'anno di composizione: l'opera e i compositori in vita in quel periodo. */
export function EraSlot({ work, composer, onSearch }: { work?: Work; composer?: Composer; onSearch: (query: string) => void }) {
  const t = useT()
  const all = useAsync(() => window.muti.metadata.timeline(), [])
  const composed = Number(/^\d{4}/.exec(work?.composed ?? '')?.[0]) || undefined
  // senza anno di composizione (o senza opera) ci si centra su metà della vita del compositore
  const birth = Number(composer?.birth) || undefined
  const death = Number(composer?.death) || undefined
  const year = composed ?? (birth ? Math.round((birth + (death ?? Math.min(NOW, birth + 70))) / 2) : undefined)
  const start = year ? Math.round((year - SPAN / 2) / 10) * 10 : 0
  const end = start + SPAN

  const rows = useMemo(() => {
    if (!year || !all.data) return []
    const alive = all.data.filter((c) => c.birth! <= end && (c.death ?? NOW) >= start)
    const mine = (c: TimelineComposer) => c.id === composer?.openOpusId
    // il compositore dell'opera sempre, poi chi era vivo nell'anno di composizione
    return alive
      .sort((a, b) => Number(mine(b)) - Number(mine(a)) || Number(b.birth! <= year && (b.death ?? NOW) >= year) - Number(a.birth! <= year && (a.death ?? NOW) >= year) || a.birth! - b.birth!)
      .slice(0, 9)
      .sort((a, b) => a.birth! - b.birth!)
  }, [all.data, year, start, end, composer?.openOpusId])

  if (!year) return null
  const pos = (y: number) => `${Math.min(100, Math.max(0, ((y - start) / SPAN) * 100))}%`
  const ticks = [0, 25, 50, 75, 100].map((d) => start + d)

  return (
    <section className="era" aria-label={t('era')}>
      <h4>{t('era')}</h4>
      {all.loading && !all.data ? (
        <p className="muted">{t('loading')}</p>
      ) : (
        <div className="era-chart">
          <div className="era-axis">
            {ticks.map((y) => <span key={y} style={{ left: pos(y) }}>{y}</span>)}
          </div>
          <div className="era-rows">
            {ticks.map((y) => <i key={y} className="era-grid" style={{ left: pos(y) }} />)}
            <i className="era-mark" style={{ left: pos(year) }} title={`${work?.title ?? composer?.name ?? ''} · ${year}`} />
            {rows.map((c) => (
              <div key={c.id} className={c.id === composer?.openOpusId ? 'era-row cur' : 'era-row'}>
                <button className={(c.death ?? NOW) > start + 70 ? 'era-bar late' : 'era-bar'} onClick={() => onSearch(c.fullName)} title={`${c.fullName} ${c.birth}–${c.death ?? ''}`} style={{ left: pos(c.birth!), width: `calc(${pos(c.death ?? NOW)} - ${pos(c.birth!)})` }}>
                  <span>{c.name}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
