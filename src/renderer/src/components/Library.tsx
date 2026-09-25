import { useEffect, useState } from 'react'
import { useAsync } from '../lib/hooks.ts'
import { useT } from '../lib/i18n.tsx'
import * as sp from '../lib/spotify.ts'
import type { SpPlaylist, SpTrack } from '../lib/spotify.ts'

type View = { kind: 'playlists' } | { kind: 'playlist'; playlist: SpPlaylist } | { kind: 'saved' } | { kind: 'recent' } | { kind: 'search'; q: string }

type Props = {
  recent: SpTrack[]
  /** `contextUri` = playlist di provenienza; altrimenti si suona nel contesto dell'album (gapless, §8.4). */
  onPlay: (track: SpTrack, contextUri?: string) => void
  searchRequest?: { q: string; n: number }
}

export function Library({ recent, onPlay, searchRequest }: Props) {
  const t = useT()
  const [view, setView] = useState<View>({ kind: 'playlists' })

  // ricerche avviate dal pannello (opere correlate)
  useEffect(() => {
    if (searchRequest) {
      setView({ kind: 'search', q: searchRequest.q })
    }
  }, [searchRequest])

  const nav = (kind: 'playlists' | 'saved' | 'recent', label: string) => (
    <button className={view.kind === kind || (kind === 'playlists' && view.kind === 'playlist') ? 'tab active' : 'tab'} onClick={() => setView({ kind } as View)}>
      {label}
    </button>
  )

  return (
    <aside className="library" aria-label="Libreria">
      <nav className="tabs">
        {nav('playlists', t('playlists'))}
        {nav('saved', t('saved'))}
        {nav('recent', t('recent'))}
      </nav>
      <div className="scroll">
        {view.kind === 'playlists' && <Playlists onOpen={(playlist) => setView({ kind: 'playlist', playlist })} />}
        {view.kind === 'recent' && <TrackList tracks={recent} onPlay={(tr) => onPlay(tr)} />}
        {view.kind === 'saved' && <Paged key="saved" load={sp.savedTracks} onPlay={(tr) => onPlay(tr)} />}
        {view.kind === 'search' && <Paged key={'s' + view.q} load={(o) => sp.searchTracks(view.q, o)} onPlay={(tr) => onPlay(tr)} />}
        {view.kind === 'playlist' && (
          <>
            <button className="link" onClick={() => setView({ kind: 'playlists' })}>
              ← {view.playlist.name}
            </button>
            <Paged
              key={view.playlist.id}
              load={(o) => sp.playlistItems(view.playlist.id, o)}
              onPlay={(tr) => onPlay(tr, view.playlist.uri)}
              lockedMessage={t('playlistLocked')}
            />
          </>
        )}
      </div>
    </aside>
  )
}

function Playlists({ onOpen }: { onOpen: (p: SpPlaylist) => void }) {
  const t = useT()
  const pl = useAsync(() => sp.playlists(), [])
  if (pl.loading) return <p className="muted">{t('loading')}</p>
  if (pl.error) return <p className="error">{pl.error.message}</p>
  return (
    <ul className="cards">
      {pl.data?.items.map((p) => (
        <li key={p.id}>
          <button className="card-btn" onClick={() => onOpen(p)}>
            {p.images?.[0] ? <img src={p.images[0].url} alt="" /> : <span className="ph" />}
            <span className="title">{p.name}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function TrackList({ tracks, onPlay }: { tracks: SpTrack[]; onPlay: (t: SpTrack) => void }) {
  const t = useT()
  if (!tracks.length) return <p className="muted">{t('noItems')}</p>
  return (
    <ul className="rows">
      {tracks.map((tr, i) => (
        <li key={tr.id + i}>
          <button className="row" onDoubleClick={() => onPlay(tr)} onClick={() => onPlay(tr)}>
            {tr.album.images?.length ? <img className="thumb" src={tr.album.images[tr.album.images.length - 1].url} alt="" /> : <span className="thumb" />}
            <span className="meta">
              <span className="title">{tr.name}</span>
              <span className="sub">{tr.artists.map((a) => a.name).join(', ')}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Lista paginata (offset). Le playlist altrui tornano senza brani: messaggio dedicato. */
function Paged({ load, onPlay, lockedMessage }: { load: (offset: number) => Promise<sp.Page<SpTrack>>; onPlay: (t: SpTrack) => void; lockedMessage?: string }) {
  const t = useT()
  const [tracks, setTracks] = useState<SpTrack[]>([])
  const [more, setMore] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const fetchMore = async (offset: number) => {
    setBusy(true)
    try {
      const page = await load(offset)
      setTracks((prev) => (offset === 0 ? page.items : [...prev, ...page.items]))
      setMore(!!page.next)
      setError(undefined)
    } catch (e) {
      setError(lockedMessage && (e as sp.SpotifyError).status === 403 ? lockedMessage : (e as Error).message)
      setMore(false)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => void fetchMore(0), [])

  return (
    <>
      {error && <p className="error">{error}</p>}
      {!error && !busy && !tracks.length && <p className="muted">{lockedMessage && !more ? lockedMessage : t('noItems')}</p>}
      <TrackList tracks={tracks} onPlay={onPlay} />
      {busy && <p className="muted">{t('loading')}</p>}
      {more && !busy && (
        <button className="link" onClick={() => void fetchMore(tracks.length)}>
          {t('loadMore')}
        </button>
      )}
    </>
  )
}
