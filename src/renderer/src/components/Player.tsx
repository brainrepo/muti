import { useEffect, useState } from 'react'
import { fmtTime, openExternal, useAsync } from '../lib/hooks.ts'
import { useT } from '../lib/i18n.tsx'
import type { NowPlaying, usePlayer } from '../lib/player.ts'
import { usePosition } from '../lib/player.ts'
import * as sp from '../lib/spotify.ts'

type PlayerApi = ReturnType<typeof usePlayer>

type Props = { api: PlayerApi }

export function Player({ api }: Props) {
  const t = useT()
  const { now, volume, commands } = api
  const position = usePosition(now)
  const [drag, setDrag] = useState<number>()
  const [savedUri, setSavedUri] = useState<string>()

  if (!now) {
    return (
      <main className="player empty">
        <p className="muted">{t('nothingPlaying')}</p>
        <DeviceSelect api={api} />
      </main>
    )
  }

  const tr = now.track
  const cover = tr.album.images[0]?.url
  const shown = drag ?? position
  const commit = () => {
    if (drag !== undefined) commands.seek(drag)
    setDrag(undefined)
  }

  return (
    <main className="player">
      <div className="cover">{cover ? <img src={cover} alt="" /> : <div className="cover-ph" />}</div>
      <h1 className="track-title">{tr.name}</h1>
      <p className="track-artists">{tr.artists.map((a) => a.name).join(' · ')}</p>
      <p className="track-album muted">{tr.album.name}</p>
      <button className="link" onClick={() => openExternal(`https://open.spotify.com/track/${tr.id}`)}>
        {t('openInSpotify')} ↗
      </button>

      <div className="transport">
        <button aria-label={t('prev')} onClick={() => commands.previous()}>⏮</button>
        <button className="primary" aria-label={now.playing ? t('pause') : t('play')} onClick={() => commands.toggle()}>
          {now.playing ? '⏸' : '▶'}
        </button>
        <button aria-label={t('nextTrack')} onClick={() => commands.next()}>⏭</button>
        <button
          aria-label={t('save')}
          title={savedUri === tr.uri ? t('saved_ok') : t('save')}
          onClick={() => void sp.saveTrack(tr.uri).then(() => setSavedUri(tr.uri))}
        >
          {savedUri === tr.uri ? '♥' : '♡'}
        </button>
      </div>

      <div className="seek">
        <span>{fmtTime(shown)}</span>
        <input
          type="range" min={0} max={tr.duration_ms} step={1000} value={shown} aria-label={t('seek')}
          onChange={(e) => setDrag(+e.target.value)} onPointerUp={commit} onKeyUp={commit} onBlur={commit}
        />
        <span>{fmtTime(tr.duration_ms)}</span>
      </div>

      <div className="volume">
        <span aria-hidden>🔊</span>
        <input
          type="range" min={0} max={1} step={0.05} value={volume} aria-label={t('volume')}
          onChange={(e) => void commands.setVolume(+e.target.value)}
        />
      </div>

      <Queue next={api.next} now={now} />
      <DeviceSelect api={api} />
    </main>
  )
}

function Queue({ next, now }: { next?: sp.SpTrack; now: NowPlaying }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const q = useAsync(() => (open ? sp.queue() : Promise.resolve([])), [open, now.track.id])
  return (
    <details className="queue" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>{t('queue')}</summary>
      {q.loading ? (
        <p className="muted">{t('loading')}</p>
      ) : (q.data ?? []).length ? (
        <ol>
          {q.data!.slice(0, 15).map((x, i) => (
            <li key={x.id + i}>
              {x.name} <span className="muted">— {x.artists.map((a) => a.name).join(', ')}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">{next ? next.name : t('queueEmpty')}</p>
      )}
    </details>
  )
}

function DeviceSelect({ api }: { api: PlayerApi }) {
  const t = useT()
  const [devices, setDevices] = useState<sp.SpDevice[]>([])
  const load = () => void sp.devices().then(setDevices, () => {})
  useEffect(load, [])
  const active = api.chosenDevice ?? devices.find((d) => d.is_active)?.id ?? ''

  return (
    <label className="device">
      <span>{t('device')}</span>
      <select
        value={active}
        onFocus={load}
        onMouseDown={load}
        onChange={(e) => {
          const d = devices.find((x) => x.id === e.target.value)
          if (!d) return
          api.commands.chooseDevice(d.id)
          void api.commands.transferTo(d)
        }}
      >
        {!devices.length && <option value="">—</option>}
        {devices.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
    </label>
  )
}
