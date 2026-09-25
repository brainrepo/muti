import { useState } from 'react'
import type { Settings } from '../../../shared/types.ts'
import { useT } from '../lib/i18n.tsx'

type Props = {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onLogout: () => void
  onClose: () => void
}

export function SettingsDialog({ settings, onChange, onLogout, onClose }: Props) {
  const t = useT()
  const [clientId, setClientId] = useState(settings.clientId)
  const [contact, setContact] = useState(settings.contact)

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t('settings')}>
      <div className="modal-body">
        <h2>{t('settings')}</h2>

        <label>
          {t('language')}
          <select value={settings.lang} onChange={(e) => onChange({ lang: e.target.value as 'it' | 'en' })}>
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select>
        </label>

        <label>
          {t('clientId')}
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} maxLength={32} spellCheck={false} />
        </label>
        <label>
          {t('contact')}
          <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="you@example.com" />
          <small className="muted">{t('contactHelp')}</small>
        </label>

        <div className="actions">
          <button onClick={onLogout}>{t('logout')}</button>
          <span className="spacer" />
          <button className="primary" onClick={() => (onChange({ clientId: clientId.trim(), contact: contact.trim() }), onClose())}>
            {t('save_btn')}
          </button>
          <button onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  )
}
