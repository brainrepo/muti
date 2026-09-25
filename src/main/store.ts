// Impostazioni e override manuali in userData/settings.json. Solo ID: nessun metadato Spotify (SPEC §5.4, §2.3).
import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Settings } from '../shared/types.ts'

type Data = { settings: Settings; overrides: Record<string, string> }

const DEFAULTS: Settings = {
  clientId: '',
  contact: '',
  lang: app.getLocale().startsWith('it') ? 'it' : 'en',
  panelWidth: 400,
  panelCollapsed: false
}

const file = () => join(app.getPath('userData'), 'settings.json')
let data: Data | undefined

function load(): Data {
  if (data) return data
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Data>
    data = { settings: { ...DEFAULTS, ...raw.settings }, overrides: raw.overrides ?? {} }
  } catch {
    data = { settings: { ...DEFAULTS }, overrides: {} }
  }
  return data
}

function save() {
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmp = file() + '.tmp'
  writeFileSync(tmp, JSON.stringify(load()))
  renameSync(tmp, file())
}

export const getSettings = () => load().settings

export function setSettings(patch: Partial<Settings>): Settings {
  const d = load()
  d.settings = { ...d.settings, ...patch }
  save()
  return d.settings
}

export const getOverride = (key: string) => load().overrides[key]

export function setOverride(key: string, qid: string | null) {
  const d = load()
  if (qid) d.overrides[key] = qid
  else delete d.overrides[key]
  save()
}
