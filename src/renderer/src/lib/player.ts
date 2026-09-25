// Controller di riproduzione via Spotify Connect (SPEC §8.2): polling di /me/player + comandi /me/player/*.
// Stato di riproduzione solo in memoria (policy Spotify, §2.3).
import { useCallback, useEffect, useRef, useState } from 'react'
import * as sp from './spotify.ts'
import type { SpDevice, SpTrack } from './spotify.ts'

export type NowPlaying = { track: SpTrack; playing: boolean; positionMs: number; at: number }
export type PlayerError = { message: string }

export function usePlayer() {
  const [now, setNow] = useState<NowPlaying>()
  const [next, setNext] = useState<SpTrack>()
  const [chosenDevice, setChosenDevice] = useState<string>()
  const [volume, setVolumeState] = useState(0.7)
  const [error, setError] = useState<PlayerError>()

  // ---------- Connect: polling ----------
  const refresh = useCallback(async () => {
    try {
      const s = await sp.currentlyPlaying()
      if (s?.item) setNow({ track: s.item, playing: s.is_playing, positionMs: s.progress_ms ?? 0, at: Date.now() })
      if (s?.device?.volume_percent != null) setVolumeState(s.device.volume_percent / 100)
      setError(undefined)
    } catch (e) {
      setError({ message: (e as Error).message })
    }
  }, [])

  const playingRef = useRef(false)
  playingRef.current = !!now?.playing
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let stopped = false
    const tick = async () => {
      // finestra nascosta: polling sospeso
      if (!document.hidden) await refresh()
      if (!stopped) timer = setTimeout(tick, playingRef.current ? 5000 : 15000)
    }
    const onVisible = () => !document.hidden && (clearTimeout(timer), void tick())
    void tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  // in Connect il brano successivo si legge dalla coda
  const trackId = now?.track.id
  useEffect(() => {
    if (!trackId) return
    void sp.queue().then((q) => setNext(q[0]), () => setNext(undefined))
  }, [trackId])

  // ---------- comandi ----------
  const target = chosenDevice
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn()
        setTimeout(() => void refresh(), 400)
      } catch (e) {
        setError({ message: (e as Error).message })
      }
    },
    [refresh]
  )

  const commands = {
    play: (body?: sp.PlayBody) => run(() => sp.play(target, body)),
    toggle: () =>
      run(async () => {
        const playing = now?.playing
        setNow((n) => n && { ...n, playing: !playing, positionMs: n.positionMs + (playing ? Date.now() - n.at : 0), at: Date.now() })
        await (playing ? sp.pause(target) : sp.play(target))
      }),
    next: () => run(() => sp.next(target)),
    previous: () => run(() => sp.previous(target)),
    seek: (ms: number) =>
      run(async () => {
        setNow((n) => n && { ...n, positionMs: ms, at: Date.now() })
        await sp.seek(ms, target)
      }),
    setVolume: (v: number) => {
      setVolumeState(v)
      return run(() => sp.volume(v * 100, target))
    },
    enqueue: (uri: string) => run(() => sp.addToQueue(uri, target)),
    transferTo: (d: SpDevice) => run(() => sp.transfer(d.id, !!now?.playing)),
    chooseDevice: setChosenDevice,
    dismissError: () => setError(undefined),
    refresh
  }

  return { now, next, chosenDevice, volume, error, commands }
}

/** Posizione interpolata tra un evento e il successivo. */
export function usePosition(now?: NowPlaying): number {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!now?.playing) return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [now?.playing, now?.at])
  if (!now) return 0
  const pos = now.positionMs + (now.playing ? Date.now() - now.at : 0)
  return Math.min(pos, now.track.duration_ms)
}
