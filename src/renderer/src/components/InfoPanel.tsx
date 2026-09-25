import { useEffect, useState } from 'react'
import type { Composer, Lang, ResolvedTrack, SourceRef, TextBlock, Work, WorkCandidate, WorkRef } from '../../../shared/types.ts'
import type { AlbumMovement } from '../lib/album.ts'
import { openExternal, useAsync, type Async } from '../lib/hooks.ts'
import { epochName, genreName, useT } from '../lib/i18n.tsx'

type Props = {
  lang: Lang
  resolved: Async<ResolvedTrack | undefined>
  albumMovements: AlbumMovement[]
  currentMovement?: number
  onPlayMovement: (index: number) => void
  onSearchSpotify: (query: string) => void
}

type Tab = 'card' | 'history' | 'composer' | 'related'

const dates = (c: Composer) => (c.birth || c.death ? `${c.birth ?? '?'}–${c.death ?? ''}` : '')

export function InfoPanel(p: Props) {
  const t = useT()
  const [tab, setTab] = useState<Tab>('card')
  const [extra, setExtra] = useState<SourceRef[]>([])
  const r = p.resolved.data
  const work = r?.work
  const composer = r?.composer

  // fonti dei testi (Wikipedia) si accumulano accanto a quelle della risoluzione
  useEffect(() => setExtra([]), [r?.work?.qid, r?.composer?.qid])
  const addSources = (s: SourceRef[]) => setExtra((prev) => [...prev, ...s.filter((x) => !prev.some((y) => y.url === x.url))])

  return (
    <aside className="panel" aria-label={t('panel')}>
      {p.resolved.loading && <div className="loadbar" role="progressbar" aria-label={t('loading')} />}
      <div className={p.resolved.loading ? 'scroll busy' : 'scroll'} aria-busy={p.resolved.loading}>
        {p.resolved.loading && !r && <p className="muted">{t('loading')}</p>}
        {p.resolved.error && (
          <p className="error">
            {t('error')}: {p.resolved.error.message} <button className="link" onClick={p.resolved.reload}>{t('retry')}</button>
          </p>
        )}

        {r && !work && !composer && (
          <>
            <p className="muted">{t('notClassical')}</p>
            <FixMatch resolved={r} lang={p.lang} onDone={p.resolved.reload} />
          </>
        )}

        {r && composer && (
          <Header work={work} composer={composer} lang={p.lang} confidence={r.confidence}>
            <FixMatch resolved={r} lang={p.lang} onDone={p.resolved.reload} />
          </Header>
        )}

        {r && !work && composer && <p className="muted">{t('composerOnly')}</p>}

        {work && (
          <>
            <Structure work={work} albumMovements={p.albumMovements} current={p.currentMovement} onPlay={p.onPlayMovement} />
            <nav className="tabs" role="tablist">
              {(['card', 'history', 'composer', 'related'] as Tab[]).map((k) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>
                  {t(k === 'card' ? 'tabCard' : k === 'history' ? 'tabHistory' : k === 'composer' ? 'tabComposer' : 'tabRelated')}
                </button>
              ))}
            </nav>
            {tab === 'card' && <Card work={work} lang={p.lang} />}
            {tab === 'history' && <History work={work} lang={p.lang} onSources={addSources} />}
            {tab === 'composer' && composer && <ComposerTab composer={composer} lang={p.lang} onSources={addSources} />}
            {tab === 'related' && <Related work={work} composer={composer} lang={p.lang} onSearch={p.onSearchSpotify} />}
          </>
        )}
        {!work && composer && <ComposerTab composer={composer} lang={p.lang} onSources={addSources} />}

        {r && <Sources sources={[...r.sources, ...extra]} />}
      </div>
    </aside>
  )
}

// ---------- intestazione ----------

function Header({ work, composer, lang, confidence, children }: { work?: Work; composer: Composer; lang: Lang; confidence: ResolvedTrack['confidence']; children?: React.ReactNode }) {
  const t = useT()
  const sub = [work?.catalog, work?.key].filter(Boolean).join(' · ')
  const meta = [work?.composed, epochName(lang, composer.epoch)].filter(Boolean).join(' · ')
  return (
    <header className="work-header">
      {composer.portraitUrl && <img className="portrait" src={composer.portraitUrl} alt="" title={composer.portraitCredit} />}
      <div>
        <h2>
          {work?.title ?? composer.name}
          {confidence === 'probable' && <span className="badge warn" title={t('fixMatch')}>{t('probable')}</span>}
        </h2>
        {sub && <p className="sub">{sub}</p>}
        <p>
          {work ? composer.name : dates(composer)} {work && <span className="muted">{dates(composer)}</span>}
        </p>
        {meta && <p className="muted">{meta}</p>}
        {children}
      </div>
    </header>
  )
}

// ---------- struttura ----------

function Structure({ work, albumMovements, current, onPlay }: { work: Work; albumMovements: AlbumMovement[]; current?: number; onPlay: (i: number) => void }) {
  const t = useT()
  // catena di ripiego: fonti aperte → tracce dell'album con lo stesso prefisso opera
  const list = work.movements.length ? work.movements : albumMovements.map((m) => ({ index: m.index, title: m.title }))
  if (!list.length) return null
  const playable = new Set(albumMovements.map((m) => m.index))
  return (
    <section className="structure" aria-label={t('structure')}>
      <h3>{t('structure')}</h3>
      <ol>
        {list.map((m) => (
          <li key={m.index} className={m.index === current ? 'current' : undefined} aria-current={m.index === current ? 'true' : undefined}>
            <button disabled={!playable.has(m.index)} onClick={() => onPlay(m.index)}>
              <span className="num">{m.index === current ? '▶' : toRoman(m.index)}</span> {m.title}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

const toRoman = (n: number) => {
  const map: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let out = ''
  for (const [v, s] of map) while (n >= v) ((out += s), (n -= v))
  return n === 0 && out ? out + '.' : ''
}

// ---------- scheda ----------

function Card({ work, lang }: { work: Work; lang: Lang }) {
  const t = useT()
  const fmtDate = (s?: string) => {
    if (!s) return s
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : undefined
    return d ? d.toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' }) : s
  }
  const rows: [string, React.ReactNode][] = [
    [t('catalog'), work.catalog],
    [t('key'), work.key],
    [t('composed'), work.composed],
    [t('premiere'), [fmtDate(work.premiere?.date), work.premiere?.place].filter(Boolean).join(' — ') || undefined],
    [t('dedicatee'), work.dedicatee?.join(', ')],
    [t('instrumentation'), work.instrumentation],
    [t('duration'), work.avgDurationMin ? `${work.avgDurationMin} ${t('minutes')}` : undefined],
    [t('genre'), genreName(lang, work.genre)],
    [t('partOf'), work.partOf?.title]
  ]
  return (
    <div className="card">
      <dl>
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {work.imslpUrl && (
        <button className="link" onClick={() => openExternal(work.imslpUrl!)}>
          {t('score')} ↗
        </button>
      )}
    </div>
  )
}

// ---------- testi (Wikipedia) ----------

function TextView({ block, lang }: { block: TextBlock; lang: Lang }) {
  const t = useT()
  return (
    <div className="prose">
      {block.lang !== lang && <span className="badge" title={t('fallbackEn')}>EN</span>}
      {block.summary && <p>{block.summary}</p>}
      {block.sections.map((s) => (
        <details key={s.heading}>
          <summary>{s.heading}</summary>
          <p className="pre">{s.text}</p>
        </details>
      ))}
    </div>
  )
}

function useText(load: () => Promise<TextBlock>, deps: unknown[], onSources: (s: SourceRef[]) => void) {
  const a = useAsync(load, deps)
  useEffect(() => a.data && onSources(a.data.sources), [a.data])
  return a
}

function History({ work, lang, onSources }: { work: Work; lang: Lang; onSources: (s: SourceRef[]) => void }) {
  const t = useT()
  const a = useText(() => window.muti.metadata.workText(refOf(work), lang), [work.qid, lang], onSources)
  if (a.loading) return <p className="muted">{t('loading')}</p>
  if (a.error) return <p className="error">{t('sectionFailed')}</p>
  if (!a.data?.summary && !a.data?.sections.length) return <p className="muted">{t('noText')}</p>
  return <TextView block={a.data!} lang={lang} />
}

function ComposerTab({ composer, lang, onSources }: { composer: Composer; lang: Lang; onSources: (s: SourceRef[]) => void }) {
  const t = useT()
  const [full, setFull] = useState(false)
  const a = useText(() => window.muti.metadata.composerText(composer.qid, lang), [composer.qid, lang], onSources)
  if (a.loading) return <p className="muted">{t('loading')}</p>
  if (a.error) return <p className="error">{t('sectionFailed')}</p>
  const b = a.data!
  const bio = b.sections.find((s) => /biograf|biography|^life|vita|early life/i.test(s.heading)) ?? b.sections[0]
  const rest = b.sections.filter((s) => s !== bio)
  return (
    <div className="prose">
      {b.lang !== lang && <span className="badge" title={t('fallbackEn')}>EN</span>}
      {b.summary && <p>{b.summary}</p>}
      {bio && (
        <>
          <button className="link" onClick={() => setFull(!full)} aria-expanded={full}>
            {full ? t('readLess') : t('readFull')}
          </button>
          {full && <p className="pre">{bio.text}</p>}
        </>
      )}
      {full && rest.map((s) => (
        <details key={s.heading}>
          <summary>{s.heading}</summary>
          <p className="pre">{s.text}</p>
        </details>
      ))}
    </div>
  )
}

// ---------- opere correlate ----------

function Related({ work, composer, lang, onSearch }: { work: Work; composer?: Composer; lang: Lang; onSearch: (q: string) => void }) {
  const t = useT()
  const a = useAsync(() => window.muti.metadata.related(refOf(work, composer), lang), [work.qid, work.mbid, lang])
  if (a.loading) return <p className="muted">{t('loading')}</p>
  if (a.error) return <p className="error">{t('sectionFailed')}</p>
  if (!a.data?.length) return <p className="muted">{t('noRelated')}</p>
  const label = { cycle: t('cycle'), genre: t('genreGroup'), derived: t('derived'), contemporary: t('contemporary') }
  return (
    <div className="related">
      {a.data.map((g) => (
        <section key={g.kind}>
          <h4>{label[g.kind]}</h4>
          <ul>
            {g.items.map((it) => (
              <li key={it.query}>
                <span>
                  {it.title}
                  {it.composer && g.kind !== 'cycle' && g.kind !== 'genre' && <span className="muted"> — {it.composer}</span>}
                </span>
                <button className="link" onClick={() => onSearch(it.query)}>
                  {t('searchOnSpotify')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function refOf(work: Work, composer?: Composer): WorkRef {
  return {
    qid: work.qid,
    mbid: work.mbid,
    title: work.title,
    genre: work.genre,
    partOfQid: work.partOf?.qid,
    composerQid: composer?.qid,
    composerName: composer?.name,
    openOpusId: composer?.openOpusId,
    epoch: composer?.epoch
  }
}

// ---------- correzione abbinamento ----------

function FixMatch({ resolved, lang, onDone }: { resolved: ResolvedTrack; lang: Lang; onDone: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [submitted, setSubmitted] = useState('')
  const found = useAsync(
    () => (submitted ? window.muti.metadata.search(submitted, resolved.composer?.qid, lang) : Promise.resolve<WorkCandidate[]>([])),
    [submitted, resolved.composer?.qid, lang]
  )
  const choose = async (qid: string | null) => {
    await window.muti.metadata.setOverride(resolved.overrideKey, qid)
    setOpen(false)
    onDone()
  }
  const list = submitted ? (found.data ?? []) : (resolved.candidates ?? [])
  return (
    <div className="fix">
      <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
        {resolved.work ? t('fixMatch') : t('searchWork')}
      </button>
      {open && (
        <div className="popover">
          <ul>
            {list.map((c) => (
              <li key={(c.qid ?? c.mbid ?? c.title) + c.source}>
                <button disabled={!c.qid} onClick={() => void choose(c.qid!)}>
                  {c.title} {c.catalog && <span className="muted">· {c.catalog}</span>}
                  <span className="score">{Math.round(c.score * 100)}%</span>
                </button>
              </li>
            ))}
            {found.loading && submitted && <li className="muted">{t('loading')}</li>}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setSubmitted(q.trim())
            }}
          >
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('fixSearch')} aria-label={t('fixSearch')} />
          </form>
          <button className="link" onClick={() => void choose(null)}>
            {t('fixReset')}
          </button>
        </div>
      )}
    </div>
  )
}

// ---------- fonti ----------

function Sources({ sources }: { sources: SourceRef[] }) {
  const t = useT()
  const uniq = [...new Map(sources.map((s) => [s.name, s])).values()]
  if (!uniq.length) return null
  return (
    <footer className="sources">
      <h4>{t('sources')}</h4>
      <ul>
        {uniq.map((s) => (
          <li key={s.name}>
            <button className="link" onClick={() => openExternal(s.url)}>{s.name}</button> <span className="muted">{s.license}</span>
          </li>
        ))}
      </ul>
    </footer>
  )
}
