// Handler IPC tipizzati (SPEC §4). Il renderer non è fidato: si validano i parametri.
import { ipcMain, shell } from 'electron'
import type { Lang, Settings, TrackCtx, WorkRef } from '../shared/types.ts'
import * as auth from './auth.ts'
import { setContact } from './metadata/http.ts'
import { resolveTrack } from './metadata/resolve.ts'
import { composerText, related, searchWorks, workText } from './metadata/text.ts'
import { isQid } from './metadata/wikidata.ts'
import { getOverride, getSettings, setOverride, setSettings } from './store.ts'

const lang = (l: unknown): Lang => (l === 'en' ? 'en' : 'it')
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '')

function track(t: TrackCtx): TrackCtx {
  return {
    trackId: str(t?.trackId, 64), uri: str(t?.uri, 128), name: str(t?.name, 400),
    artists: (Array.isArray(t?.artists) ? t.artists : []).slice(0, 10).map((a) => ({ id: str(a?.id, 64), name: str(a?.name, 200) })),
    albumId: str(t?.albumId, 64), albumName: str(t?.albumName, 400),
    durationMs: Number(t?.durationMs) || 0, trackNumber: t?.trackNumber ? Number(t.trackNumber) : undefined
  }
}

function workRef(w: WorkRef): WorkRef {
  const id = (v: unknown) => (typeof v === 'string' && isQid(v) ? v : undefined)
  return {
    qid: id(w?.qid), partOfQid: id(w?.partOfQid), composerQid: id(w?.composerQid),
    mbid: /^[0-9a-f-]{36}$/i.test(str(w?.mbid, 40)) ? w.mbid : undefined,
    title: str(w?.title, 400), genre: str(w?.genre, 40) || undefined,
    composerName: str(w?.composerName, 200) || undefined,
    openOpusId: /^\d+$/.test(str(w?.openOpusId, 10)) ? w.openOpusId : undefined,
    epoch: str(w?.epoch, 40) || undefined
  }
}

export function registerIpc() {
  const h = ipcMain.handle.bind(ipcMain)
  setContact(getSettings().contact)

  h('auth:status', () => auth.status())
  h('auth:login', (_e, clientId: string) => auth.login(str(clientId, 64)))
  h('auth:logout', () => auth.logout())
  h('auth:token', () => auth.getToken())

  h('settings:get', () => getSettings())
  h('settings:set', (_e, patch: Partial<Settings>) => {
    const clean: Partial<Settings> = {}
    if (patch.lang) clean.lang = lang(patch.lang)
    if (typeof patch.panelWidth === 'number') clean.panelWidth = Math.min(560, Math.max(320, patch.panelWidth))
    if (typeof patch.panelCollapsed === 'boolean') clean.panelCollapsed = patch.panelCollapsed
    if (typeof patch.contact === 'string') (clean.contact = str(patch.contact, 200)), setContact(clean.contact)
    if (typeof patch.clientId === 'string') clean.clientId = str(patch.clientId, 64)
    return setSettings(clean)
  })

  h('meta:resolve', (_e, t: TrackCtx, l: Lang) => resolveTrack(track(t), lang(l), { override: getOverride }))
  h('meta:prefetch', async (_e, t: TrackCtx, l: Lang) => void (await resolveTrack(track(t), lang(l), { override: getOverride }).catch(() => {})))
  h('meta:workText', (_e, w: WorkRef, l: Lang) => workText(workRef(w), lang(l)))
  h('meta:composerText', (_e, qid: string, l: Lang) => (isQid(qid) ? composerText(qid, lang(l)) : Promise.reject(new Error('QID non valido'))))
  h('meta:related', (_e, w: WorkRef, l: Lang) => related(workRef(w), lang(l)))
  h('meta:search', (_e, query: string, composerQid: string | undefined, _l: Lang) =>
    searchWorks(str(query, 200), composerQid && isQid(composerQid) ? composerQid : undefined))
  h('meta:setOverride', (_e, key: string, qid: string | null) => {
    if (!/^[0-9a-f]{40}$/.test(str(key, 40)) || (qid !== null && !isQid(String(qid)))) throw new Error('Parametri non validi')
    setOverride(key, qid)
  })

  h('app:openExternal', (_e, url: string) => {
    const u = new URL(str(url, 2000))
    if (u.protocol !== 'https:') throw new Error('Solo URL https')
    return shell.openExternal(u.toString())
  })
}
