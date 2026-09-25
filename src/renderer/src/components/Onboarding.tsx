import { useState } from 'react'
import type { Settings } from '../../../shared/types.ts'
import { openExternal } from '../lib/hooks.ts'
import { useT } from '../lib/i18n.tsx'

/** Primo avvio: guida per creare la propria app Spotify (modello BYO Client ID, SPEC §5.2, §9.1). */
export function Onboarding({ settings, onDone }: { settings: Settings; onDone: () => void }) {
  const t = useT()
  const [clientId, setClientId] = useState(settings.clientId)
  const [contact, setContact] = useState(settings.contact)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const connect = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await window.muti.settings.set({ contact: contact.trim() })
      await window.muti.auth.login(clientId)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="onboarding">
      <h1>Muti</h1>
      <p className="muted">{t('appTagline')}</p>
      <h2>{t('connectTitle')}</h2>
      <p>{t('connectIntro')}</p>
      <ol>
        <li>
          {t('step1')}{' '}
          <button className="link" onClick={() => openExternal('https://developer.spotify.com/dashboard')}>developer.spotify.com ↗</button>
        </li>
        <li>{t('step2')}</li>
        <li>{t('step3')}</li>
        <li>{t('step4')}</li>
      </ol>
      <form onSubmit={connect}>
        <label>
          {t('clientId')}
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} required minLength={32} maxLength={32} spellCheck={false} autoComplete="off" />
        </label>
        <label>
          {t('contact')}
          <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="you@example.com" />
          <small className="muted">{t('contactHelp')}</small>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary wide" disabled={busy}>{busy ? t('connecting') : t('connect')}</button>
      </form>
    </main>
  )
}
