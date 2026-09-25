// Cache su disco: un file JSON per chiave, in <dir>/<sha1(chiave)>.json (SPEC §4.1).
// La chiave non viene scritta nel file: alcune derivano da stringhe Spotify (§2.3).
// ponytail: file JSON, passare a node:sqlite se la cache supera ~10k voci o servono query.
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

let dir = ''
export const setCacheDir = (d: string) => (dir = d)

const file = (key: string) => join(dir, createHash('sha1').update(key).digest('hex') + '.json')

export async function cacheGet<T>(key: string, ttlMs: number): Promise<T | undefined> {
  if (!dir) return undefined
  try {
    const e = JSON.parse(await readFile(file(key), 'utf8')) as { fetchedAt: number; value: T }
    return Date.now() - e.fetchedAt <= ttlMs ? e.value : undefined
  } catch {
    return undefined
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  if (!dir) return
  try {
    await mkdir(dir, { recursive: true })
    const tmp = file(key) + '.tmp' + process.pid
    await writeFile(tmp, JSON.stringify({ fetchedAt: Date.now(), value }))
    await rename(tmp, file(key))
  } catch {
    // la cache è un'ottimizzazione: un errore di scrittura non deve rompere la richiesta
  }
}

export const DAY = 864e5
