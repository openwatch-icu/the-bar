import { getBarUserMinutes, setBarUserMinutes } from '../utils/settings'

const BAR_OPTIONS = [
  { value: 0, label: 'Use session default only' },
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '60 minutes' },
]

export function Settings({
  onClose,
  inChat,
  sessionInfo,
  hasRoomKey,
  currentRoom,
  onForgetSession,
}) {
  const barMinutes = getBarUserMinutes()
  const roomEncrypted = inChat && hasRoomKey?.(currentRoom)

  const handleBarChange = (e) => {
    const v = Number(e.target.value)
    setBarUserMinutes(Number.isFinite(v) && v >= 0 ? v : 0)
  }

  return (
    <div className="login-panel settings-panel">
      <header className="settings-panel-header">
        <h1>Settings</h1>
        <button
          type="button"
          onClick={onClose}
          className="settings-panel-close"
        >
          Done
        </button>
      </header>
      <div className="settings-panel-scroll">
        {inChat && (
          <section
            className="settings-section"
            aria-label="Connection security"
          >
            <h2>Connection security</h2>
            <p className="settings-connection-security" role="status">
              {roomEncrypted ? (
                <>
                  <span className="secure-badge">Secure</span> Room: End-to-end
                  encrypted. The server cannot read your messages.
                </>
              ) : (
                <>
                  Connect and join a room with the access code to use end-to-end
                  encryption.
                </>
              )}
            </p>
          </section>
        )}
        {sessionInfo && (
          <section
            className="settings-section server-reports-section"
            aria-label="Server-reported settings"
          >
            <h2>This server reports</h2>
            <ul className="server-reports-list">
              <li>
                Message body logging:{' '}
                <strong>{sessionInfo.log_broadcast_body ? 'on' : 'off'}</strong>
              </li>
              <li>
                Message history:{' '}
                <strong>
                  {sessionInfo.messages_persisted
                    ? 'persisted'
                    : 'not persisted'}
                </strong>
              </li>
              <li>
                User BAR allowed:{' '}
                <strong>{sessionInfo.bar_user_allowed ? 'yes' : 'no'}</strong>
              </li>
              <li>
                Server BAR (session):{' '}
                <strong>
                  {sessionInfo.session_bar_minutes > 0
                    ? `${sessionInfo.session_bar_minutes} minutes`
                    : 'off'}
                </strong>
              </li>
              {sessionInfo.bar_user_allowed && (
                <li>
                  User BAR cap:{' '}
                  <strong>
                    {sessionInfo.user_bar_max_minutes ?? 2880} minutes
                  </strong>
                </li>
              )}
            </ul>
            <p className="settings-hint server-reports-disclaimer">
              This is what the server reports. When connecting to a third-party
              server, you are trusting that operator. See{' '}
              <a
                href="https://the-b4r.netlify.app/wiki/privacy"
                target="_blank"
                rel="noopener noreferrer"
              >
                PRIVACY
              </a>{' '}
              for the trust model.
            </p>
            <p className="settings-hint server-reports-disclaimer">
              <strong>All chat is end-to-end encrypted.</strong> The server
              never sees message content. <strong>Rooms</strong> — you get the
              room key when you join with the access code. <strong>DMs</strong>{' '}
              — open a DM to exchange keys; compare the key fingerprint with the
              other person and click &quot;Mark as verified&quot;.
            </p>
            <p className="settings-hint" role="status" aria-live="polite">
              <strong>Verification status:</strong> In each DM thread the app
              shows <strong>Verified</strong>, <strong>Unverified</strong>, or{' '}
              <strong>Insecure — key mismatch</strong>. If a message was altered
              in transit, that message shows &quot;Verification failed — message
              may have been tampered&quot;. See{' '}
              <a
                href="https://the-b4r.netlify.app/wiki/e2e_and_tamper"
                target="_blank"
                rel="noopener noreferrer"
              >
                E2E and tamper design
              </a>
              .
            </p>
          </section>
        )}
        {onForgetSession && (
          <section className="settings-section" aria-label="Forget session">
            <h2>Forget my session</h2>
            <p className="settings-hint">
              Clear your saved reconnect token. Next time you join, use your
              username and access code; if the server allows join without token,
              you will receive a new token.
            </p>
            <button
              type="button"
              className="settings-forget-session-btn"
              onClick={() => {
                onForgetSession()
                onClose?.()
              }}
            >
              Forget my session
            </button>
          </section>
        )}
        <section className="settings-section" aria-label="What we store">
          <h2>What we store on your device</h2>
          <p className="settings-hint">
            The app stores only: reconnect token, BAR preference, last-join URL,
            and (if you use E2E) verified key fingerprints in localStorage. No
            message content is stored. When the server is age-restricted, your
            age confirmation is stored only on this device (best effort). See{' '}
            <a
              href="https://the-b4r.netlify.app/wiki/privacy"
              target="_blank"
              rel="noopener noreferrer"
            >
              PRIVACY
            </a>
            .
          </p>
        </section>
        <section className="settings-section">
          <h2>BAR (Burn after reading)</h2>
          <p className="settings-hint">
            How long your own messages stay in the session before they are
            burned (deleted for everyone). Capped by the session owner&apos;s
            limit when you join.
          </p>
          <label className="form-row">
            <span>My BAR</span>
            <select
              value={barMinutes}
              onChange={handleBarChange}
              aria-label="BAR retention in minutes"
            >
              {BAR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <p className="settings-note">
            Takes effect on next join. It cannot be changed during a session.
          </p>
          {inChat && (
            <p className="settings-note settings-note-warning">
              You are currently in a session. Changes will apply the next time
              you join.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
