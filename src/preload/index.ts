import { contextBridge, ipcRenderer } from 'electron'
import type { MutiApi } from '../shared/types.ts'

const call = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: MutiApi = {
  auth: {
    status: () => call('auth:status'),
    login: (clientId) => call('auth:login', clientId),
    logout: () => call('auth:logout'),
    getToken: () => call('auth:token')
  },
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch)
  },
  metadata: {
    resolve: (t, lang) => call('meta:resolve', t, lang),
    prefetch: (t, lang) => call('meta:prefetch', t, lang),
    workText: (w, lang) => call('meta:workText', w, lang),
    composerText: (qid, lang) => call('meta:composerText', qid, lang),
    related: (w, lang) => call('meta:related', w, lang),
    search: (query, composerQid, lang) => call('meta:search', query, composerQid, lang),
    setOverride: (key, qid) => call('meta:setOverride', key, qid),
    timeline: () => call('meta:timeline'),
    composerWorks: (name, birth, lang) => call('meta:composerWorks', name, birth, lang)
  },
  app: {
    openExternal: (url) => call('app:openExternal', url)
  }
}

contextBridge.exposeInMainWorld('muti', api)
