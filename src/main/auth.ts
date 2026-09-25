// Spotify Authorization Code + PKCE con server loopback (SPEC §9). Nessun client secret.
import { safeStorage, shell, app } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { AuthStatus } from '../shared/types.ts'
import { getSettings, setSettings } from './store.ts'

const SCOPES = [
  'user-read-email', 'user-read-private', 'user-read-playback-state', 'user-modify-playback-state',
  'user-read-currently-playing', 'playlist-read-private', 'user-library-read', 'user-library-modify'
].join(' ')
const TOKEN_URL = 'https://accounts.spotify.com/api/token'

type Tokens = { access: string; refresh: string; expiresAt: number }
let tokens: Tokens | undefined
let loaded = false
let refreshing: Promise<Tokens> | undefined

const authFile = () => join(app.getPath('userData'), 'auth.bin')

function persist() {
  // senza cifratura del sistema non scriviamo mai i token in chiaro: restano solo in memoria
  if (!tokens || !safeStorage.isEncryptionAvailable()) return
  writeFileSync(authFile(), safeStorage.encryptString(JSON.stringify(tokens)))
}

function restore() {
  if (loaded) return
  loaded = true
  try {
    if (existsSync(authFile()) && safeStorage.isEncryptionAvailable())
      tokens = JSON.parse(safeStorage.decryptString(readFileSync(authFile()))) as Tokens
  } catch {
    tokens = undefined
  }
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: getSettings().clientId, ...body })
  })
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string }
  if (!res.ok || !j.access_token) throw new Error(j.error_description ?? `Spotify token: HTTP ${res.status}`)
  return {
    access: j.access_token,
    // i refresh token possono ruotare: si salva sempre l'ultimo
    refresh: j.refresh_token ?? tokens?.refresh ?? '',
    expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000
  }
}

export const status = (): AuthStatus => {
  restore()
  return { loggedIn: !!tokens?.refresh, clientId: getSettings().clientId }
}

/** Access token valido; si rinnova 60 s prima della scadenza. */
export async function getToken(): Promise<string> {
  restore()
  if (!tokens) throw new Error('Non autenticato')
  if (Date.now() > tokens.expiresAt - 60_000) {
    refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh })
      .then((t) => ((tokens = t), persist(), t))
      .finally(() => (refreshing = undefined))
    await refreshing
  }
  return tokens.access
}

export function logout() {
  tokens = undefined
  try {
    unlinkSync(authFile())
  } catch {
    // già assente
  }
}

const b64url = (b: Buffer) => b.toString('base64url')
const page = (msg: string) =>
  `<!doctype html><meta charset="utf-8"><title>Muti</title><body style="font:16px system-ui;padding:3rem;text-align:center">${msg}</body>`

export async function login(clientId: string): Promise<AuthStatus> {
  const id = clientId.trim()
  if (!/^[0-9a-f]{32}$/i.test(id)) throw new Error('Il Client ID Spotify è di 32 caratteri esadecimali')
  setSettings({ clientId: id })

  const verifier = b64url(randomBytes(64))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') return void res.writeHead(404).end()
      const err = url.searchParams.get('error')
      const ok = !err && url.searchParams.get('state') === state && url.searchParams.get('code')
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(page(ok ? 'Fatto. Puoi chiudere questa finestra e tornare a Muti.' : 'Accesso non riuscito. Torna a Muti e riprova.'))
      clearTimeout(timer)
      server.close()
      if (ok) resolve({ code: url.searchParams.get('code')!, redirectUri })
      else reject(new Error(err ?? 'Risposta di autorizzazione non valida'))
    })
    const timer = setTimeout(() => (server.close(), reject(new Error('Accesso scaduto'))), 5 * 60_000)
    let redirectUri = ''
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      redirectUri = `http://127.0.0.1:${port}/callback`
      const auth = new URL('https://accounts.spotify.com/authorize')
      auth.search = new URLSearchParams({
        response_type: 'code', client_id: id, scope: SCOPES, redirect_uri: redirectUri,
        code_challenge_method: 'S256', code_challenge: challenge, state
      }).toString()
      // browser di sistema, non una webview (RFC 8252)
      void shell.openExternal(auth.toString())
    })
  })

  tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier })
  persist()
  return status()
}
