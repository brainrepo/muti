import { useEffect, useMemo, useState } from 'react'
import type { AuthStatus, Settings } from '../../shared/types.ts'
import { InfoPanel } from './components/InfoPanel.tsx'
import { Library } from './components/Library.tsx'
import { Timeline } from './components/Timeline.tsx'
import { Onboarding } from './components/Onboarding.tsx'
import { DeviceSelect, Player } from './components/Player.tsx'
import { SettingsDialog } from './components/SettingsDialog.tsx'
import { albumMovements } from './lib/album.ts'
import { toTrackCtx, useAsync } from './lib/hooks.ts'
import { LangContext, useT } from './lib/i18n.tsx'
import { applyPalette, extractPalette } from './lib/palette.ts'
import { usePlayer } from './lib/player.ts'
import * as sp from './lib/spotify.ts'

type Boot = { settings: Settings; auth: AuthStatus }

export default function App() {
  const [boot, setBoot] = useState<Boot>()
  useEffect(() => {
    void Promise.all([window.muti.settings.get(), window.muti.auth.status()]).then(([settings, auth]) =>
      setBoot({ settings, auth })
    )
  }, [])
  if (!boot) return <div className="splash">Muti</div>

  const update = (patch: Partial<Boot>) => setBoot((b) => b && { ...b, ...patch })
  return (
    <LangContext.Provider value={boot.settings.lang}>
      {boot.auth.loggedIn ? (
        <Shell
          boot={boot}
          onSettings={(settings) => update({ settings })}
          onLogout={() => void window.muti.auth.logout().then(() => update({ auth: { ...boot.auth, loggedIn: false } }))}
        />
      ) : (
        <Onboarding
          settings={boot.settings}
          onDone={() =>
            void Promise.all([window.muti.settings.get(), window.muti.auth.status()]).then(([settings, auth]) => update({ settings, auth }))
          }
        />
      )}
    </LangContext.Provider>
  )
}

function Shell({ boot, onSettings, onLogout }: { boot: Boot; onSettings: (s: Settings) => void; onLogout: () => void }) {
  const t = useT()
  const { settings } = boot
  const lang = settings.lang
  const api = usePlayer()
  const { now, commands } = api

  const [showSettings, setShowSettings] = useState(false)
  const [libOpen, setLibOpen] = useState(false)
  const [tlOpen, setTlOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<{ q: string; n: number }>()
  const runSearch = (q: string) => (setQuery(q), setSearch({ q, n: Date.now() }), setLibOpen(true))
  const [recent, setRecent] = useState<sp.SpTrack[]>([]) // solo in memoria: vale per la sessione

  const save = (patch: Partial<Settings>) => void window.muti.settings.set(patch).then(onSettings)

  const resolved = useAsync(
    () => (now ? window.muti.metadata.resolve(toTrackCtx(now.track), lang) : Promise.resolve(undefined)),
    [now?.track.id, lang]
  )
  const albumTracks = useAsync(() => (now ? sp.albumTracks(now.track.album) : Promise.resolve([])), [now?.track.album.id])
  const movements = useMemo(() => (now && albumTracks.data ? albumMovements(albumTracks.data, now.track) : []), [albumTracks.data, now?.track.id])
  const currentMovement = resolved.data?.movementIndex ?? movements.find((m) => m.track.id === now?.track.id)?.index

  // palette dalla copertina (la più piccola basta); se non è leggibile resta quella di base
  const images = now?.track.album.images
  const coverUrl = images?.[images.length - 1]?.url
  const artUrl = images?.[0]?.url
  useEffect(() => {
    let alive = true
    if (!coverUrl) return applyPalette(null)
    extractPalette(coverUrl).then(
      (p) => alive && applyPalette(p),
      () => alive && applyPalette(null)
    )
    return () => {
      alive = false
    }
  }, [coverUrl])

  useEffect(() => {
    if (now) setRecent((r) => [now.track, ...r.filter((x) => x.id !== now.track.id)].slice(0, 30))
  }, [now?.track.id])

  // il brano successivo si risolve in anticipo (§6.3)
  useEffect(() => {
    if (api.next) void window.muti.metadata.prefetch(toTrackCtx(api.next), lang)
  }, [api.next?.id, lang])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('input,textarea,select,button,summary,a,[role=tab]')) return
      e.preventDefault()
      commands.toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commands.toggle])

  const playTrack = (track: sp.SpTrack, contextUri?: string) => {
    commands.play({ context_uri: contextUri ?? track.album.uri, offset: { uri: track.uri } })
    setLibOpen(false)
  }
  const playMovement = (index: number) => {
    const m = movements.find((x) => x.index === index)
    if (m && now) playTrack(m.track)
  }

  return (
    <>
    {artUrl && <div key={artUrl} className="art" style={{ backgroundImage: `url(${artUrl})` }} aria-hidden />}
    <div className="app">
      <div className="sr-only" aria-live="polite">{now ? `${t('nowPlaying')}: ${now.track.name}` : ''}</div>

      <header className="topbar">
        <form
          className="topsearch"
          onSubmit={(e) => {
            e.preventDefault()
            if (query.trim()) runSearch(query.trim())
          }}
        >
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')} aria-label={t('search')} />
        </form>
        <button onClick={() => setLibOpen((o) => !o)} aria-expanded={libOpen}>{t('library')}</button>
        <button onClick={() => setTlOpen(true)}>{t('timeline')}</button>
        <DeviceSelect api={api} />
        <button aria-label={t('settings')} title={t('settings')} onClick={() => setShowSettings(true)}>⚙</button>
      </header>

      <div className="center">
        {api.error && (
          <div className="banner" role="alert">
            <span>
              {t('errPlayer')}: {api.error.message}
              {/device/i.test(api.error.message) && ` ${t('noDevice')}`}
            </span>
            <button aria-label={t('close')} onClick={commands.dismissError}>×</button>
          </div>
        )}
        <Player api={api} />
        <footer className="attribution muted">{t('attribution')}</footer>
      </div>

      <InfoPanel
        lang={lang}
        resolved={resolved}
        albumMovements={movements}
        currentMovement={currentMovement}
        onPlayMovement={playMovement}
        onSearchSpotify={runSearch}
      />

      {tlOpen && (
        <Timeline
          lang={lang}
          currentId={resolved.data?.composer?.openOpusId}
          onSearch={runSearch}
          onClose={() => setTlOpen(false)}
        />
      )}

      {libOpen && (
        <>
          <div className="backdrop" onClick={() => setLibOpen(false)} />
          <div className="drawer" role="dialog" aria-label={t('library')}>
            <button className="drawer-close" aria-label={t('close')} onClick={() => setLibOpen(false)}>×</button>
            <Library recent={recent} onPlay={playTrack} searchRequest={search} />
          </div>
        </>
      )}

      {showSettings && (
        <SettingsDialog settings={settings} onChange={save} onLogout={onLogout} onClose={() => setShowSettings(false)} />
      )}
    </div>
    </>
  )
}
