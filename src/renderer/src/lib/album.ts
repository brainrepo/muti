// Movimenti di un'opera dentro l'album corrente (SPEC §5.3 struttura, §6.2 fase 6).
import { normTitle, parseTrack } from '../../../main/metadata/parse.ts'
import type { SpTrack } from './spotify.ts'

export type AlbumMovement = { track: SpTrack; index: number; title: string }

const workKey = (t: SpTrack) => {
  const p = parseTrack(t.name, t.album.name)
  return `${normTitle(p.workTitle)}|${p.catalog.map((c) => c.system + c.number).join(',')}`
}

/**
 * Tracce consecutive dell'album con lo stesso prefisso opera del brano corrente.
 * L'indice viene dal titolo; se manca, dalla posizione tra le tracce dell'opera.
 */
export function albumMovements(albumTracks: SpTrack[], current: SpTrack): AlbumMovement[] {
  const key = workKey(current)
  return albumTracks
    .filter((t) => workKey(t) === key)
    .map((track, i) => {
      const mv = parseTrack(track.name, track.album.name).movement
      return { track, index: mv?.index ?? i + 1, title: mv?.title || track.name }
    })
}
