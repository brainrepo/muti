// Client Web API Spotify (SPEC §4.1, §8). Isolato qui: se Spotify restringe ancora la Dev Mode si tocca solo questo file.
// Endpoint usati: Player, GET /tracks/{id}, search, /me/*, playlist items, /me/library.
const BASE = 'https://api.spotify.com/v1'

export type SpArtist = { id: string; name: string }
export type SpAlbum = { id: string; name: string; uri: string; images: { url: string }[] }
export type SpTrack = {
  id: string
  uri: string
  name: string
  duration_ms: number
  track_number?: number
  artists: SpArtist[]
  album: SpAlbum
}
export type SpDevice = { id: string; name: string; type: string; is_active: boolean; volume_percent: number | null }
export type SpPlaylist = { id: string; uri: string; name: string; images?: { url: string }[] }
export type Page<T> = { items: T[]; total: number; next: string | null }

export class SpotifyError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function api<T = void>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const token = await window.muti.auth.getToken()
  const res = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers }
  })
  // 429: si rispetta Retry-After (SPEC §8.2); 401: un nuovo tentativo con token rinnovato
  if (res.status === 429 && attempt < 2) {
    await sleep(Math.min(+(res.headers.get('retry-after') ?? 2), 30) * 1000)
    return api<T>(path, init, attempt + 1)
  }
  if (res.status === 401 && attempt < 1) return api<T>(path, init, attempt + 1)
  if (res.status === 204) return undefined as T
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new SpotifyError(res.status, body.error?.message ?? `Spotify HTTP ${res.status}`)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')

// ---------- libreria e ricerca ----------

export const playlists = (offset = 0) => api<Page<SpPlaylist>>(`/me/playlists?${qs({ limit: 30, offset })}`)

/** Le playlist di altri non espongono i brani (Dev Mode): la pagina torna senza `items`. */
export async function playlistItems(id: string, offset = 0): Promise<Page<SpTrack>> {
  const r = await api<{ items: { item?: SpTrack; track?: SpTrack }[]; total: number; next: string | null }>(
    `/playlists/${id}/items?${qs({ limit: 50, offset })}`
  )
  return { ...r, items: (r.items ?? []).map((i) => i.item ?? i.track).filter((t): t is SpTrack => !!t?.id) }
}

export async function savedTracks(offset = 0): Promise<Page<SpTrack>> {
  const r = await api<{ items: { track: SpTrack }[]; total: number; next: string | null }>(`/me/tracks?${qs({ limit: 50, offset })}`)
  return { ...r, items: r.items.map((i) => i.track).filter((t) => !!t?.id) }
}

/** limit massimo 10 in Dev Mode: si pagina con offset. */
export async function searchTracks(query: string, offset = 0): Promise<Page<SpTrack>> {
  const r = await api<{ tracks: { items: SpTrack[]; total: number; next: string | null } }>(
    `/search?${qs({ type: 'track', q: query, limit: 10, offset })}`
  )
  return { ...r.tracks, items: r.tracks.items.filter((t) => !!t?.id) }
}

/** Tracce dell'album, con l'album agganciato a ciascuna. */
export async function albumTracks(album: SpAlbum): Promise<SpTrack[]> {
  const out: SpTrack[] = []
  for (let offset = 0; offset < 300; offset += 50) {
    const r = await api<{ items: Omit<SpTrack, 'album'>[]; next: string | null }>(`/albums/${album.id}/tracks?${qs({ limit: 50, offset })}`)
    out.push(...r.items.map((t) => ({ ...t, album })))
    if (!r.next) break
  }
  return out
}

export const saveTrack = (uri: string) => api(`/me/library?${qs({ uris: uri })}`, { method: 'PUT' })

// ---------- player (identico per SDK integrato e Connect: cambia solo il device_id) ----------

export type PlaybackState = {
  is_playing: boolean
  progress_ms: number | null
  item: SpTrack | null
  device?: SpDevice
  context?: { uri: string } | null
}

export async function currentlyPlaying(): Promise<PlaybackState | undefined> {
  return api<PlaybackState | undefined>('/me/player/currently-playing?additional_types=track').then((s) => s ?? undefined)
}
export const devices = () => api<{ devices: SpDevice[] }>('/me/player/devices').then((r) => r.devices)
export const queue = () => api<{ queue: SpTrack[] }>('/me/player/queue').then((r) => r.queue ?? [])

export const transfer = (deviceId: string, play: boolean) =>
  api('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play }) })

export type PlayBody = { context_uri?: string; uris?: string[]; offset?: { uri?: string; position?: number }; position_ms?: number }
export const play = (deviceId: string | undefined, body: PlayBody = {}) =>
  api(`/me/player/play?${qs({ device_id: deviceId })}`, { method: 'PUT', body: Object.keys(body).length ? JSON.stringify(body) : undefined })
export const pause = (deviceId?: string) => api(`/me/player/pause?${qs({ device_id: deviceId })}`, { method: 'PUT' })
export const next = (deviceId?: string) => api(`/me/player/next?${qs({ device_id: deviceId })}`, { method: 'POST' })
export const previous = (deviceId?: string) => api(`/me/player/previous?${qs({ device_id: deviceId })}`, { method: 'POST' })
export const seek = (ms: number, deviceId?: string) =>
  api(`/me/player/seek?${qs({ position_ms: Math.round(ms), device_id: deviceId })}`, { method: 'PUT' })
export const volume = (percent: number, deviceId?: string) =>
  api(`/me/player/volume?${qs({ volume_percent: Math.round(percent), device_id: deviceId })}`, { method: 'PUT' })
export const addToQueue = (uri: string, deviceId?: string) =>
  api(`/me/player/queue?${qs({ uri, device_id: deviceId })}`, { method: 'POST' })
