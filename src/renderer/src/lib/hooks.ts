import { useEffect, useState } from 'react'
import type { TrackCtx } from '../../../shared/types.ts'
import type { SpTrack } from './spotify.ts'

export type Async<T> = { data?: T; error?: Error; loading: boolean; reload: () => void }

/** Esegue `fn` a ogni cambio di `deps`; il risultato di una richiesta superata viene scartato. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, set] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true })
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    set((s) => ({ data: s.data, loading: true })) // i dati precedenti restano finché arrivano i nuovi (niente sfarfallio tra movimenti)
    fn().then(
      (data) => alive && set({ data, loading: false }),
      (error: Error) => alive && set({ error, loading: false })
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  return { ...state, reload: () => setN((x) => x + 1) }
}

export const toTrackCtx = (t: SpTrack): TrackCtx => ({
  trackId: t.id,
  uri: t.uri,
  name: t.name,
  artists: t.artists.map((a) => ({ id: a.id, name: a.name })),
  albumId: t.album.id,
  albumName: t.album.name,
  durationMs: t.duration_ms,
  trackNumber: t.track_number
})

export const openExternal = (url: string) => void window.muti.app.openExternal(url)

export const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
