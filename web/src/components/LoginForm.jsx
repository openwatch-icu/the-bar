import { useState } from 'react'
import { isDev } from '../config/env'

export function LoginForm({
  sessionParams,
  sessionInfoUrl,
  wsUrl,
  sessionInfo,
  sessionInfoError,
  username,
  setUsername,
  reconnectToken,
  setReconnectToken,
  inviteCode,
  setInviteCode,
  loginError,
  connecting,
  handleLogin,
  isTauri,
  desktopOrigin,
  onBack,
  onSettings,
}) {
  const [barDisabledConfirm, setBarDisabledConfirm] = useState(false)
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const hasConnectionError = !!sessionInfoError || !!loginError

  const barUserAllowed = sessionInfo?.bar_user_allowed ?? null
  const sessionBarMinutes = sessionInfo?.session_bar_minutes ?? 0
  const minimumAge = sessionInfo?.minimum_age ?? 0
  const barDisabledWithConfirm =
    barUserAllowed === false && sessionBarMinutes > 0
  const sessionInfoLoading =
    sessionParams && sessionInfo === null && !sessionInfoError
  const ageRestricted = minimumAge > 0
  const joinDisabled =
    connecting ||
    (barDisabledWithConfirm && !barDisabledConfirm) ||
    sessionInfoLoading ||
    (ageRestricted && !ageConfirmed)

  return (
    <div className="login-panel">
      <div className="login-panel-header">
        <h1>The Bar</h1>
        {onSettings && (
          <button
            type="button"
            className="icon-btn settings-btn"
            onClick={onSettings}
            title="Settings"
            aria-label="Settings"
          >
            ⚙
          </button>
        )}
      </div>

      {sessionInfoLoading && <p className="login-info">Loading session…</p>}
      {sessionInfoError && (
        <p className="login-error session-info-error">{sessionInfoError}</p>
      )}
      {hasConnectionError &&
        (sessionInfoUrl != null || wsUrl != null) &&
        isDev() && (
          <div className="connection-debug">
            <button
              type="button"
              className="connection-debug-toggle"
              onClick={() => setShowDebug((d) => !d)}
              aria-expanded={showDebug}
            >
              {showDebug ? 'Hide' : 'Show'} connection URLs
            </button>
            {showDebug && (
              <div className="connection-debug-urls">
                {sessionInfoUrl != null && (
                  <p title="Try opening this in a new tab or: curl -k &lt;url&gt;">
                    <strong>Session info:</strong>{' '}
                    <a
                      href={sessionInfoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {sessionInfoUrl}
                    </a>
                  </p>
                )}
                {wsUrl != null && (
                  <p>
                    <strong>WebSocket:</strong> <code>{wsUrl}</code>
                  </p>
                )}
                <p className="connection-debug-tip">
                  If session info fails: check server is running, scheme (http
                  vs https), and ALLOWED_ORIGINS. Try HTTP or run{' '}
                  <code>curl -k &lt;session-info URL&gt;</code> in a terminal to
                  test.
                </p>
                <p className="connection-debug-tip">
                  If WebSocket connects then closes: put the server&apos;s{' '}
                  <strong>access code</strong> in &quot;Invite / access
                  code&quot; (not the password token field). For local Docker,
                  use the same value as <code>ACCESS_CODE</code> in your server{' '}
                  <code>.env</code> or{' '}
                  <code>docker run -e ACCESS_CODE=... </code>.
                </p>
              </div>
            )}
          </div>
        )}
      {sessionParams?.wsBaseUrl?.includes('.i2p') && (
        <p className="login-info i2p-notice">
          Using I2P. Ensure your browser or app is configured to resolve I2P
          addresses (e.g. I2P proxy or extension).
        </p>
      )}
      {sessionInfo && barUserAllowed === true && (
        <p className="bar-notice bar-enabled">
          Bar enabled. Your BAR setting will apply (up to session limit).
        </p>
      )}
      {sessionInfo && barDisabledWithConfirm && (
        <div className="bar-notice bar-disabled">
          <p className="bar-disabled-title">ATTENTION – BAR disabled</p>
          <p>
            You will be held to the session owner&apos;s settings (messages
            purged after {sessionBarMinutes} minutes). Do you wish to confirm
            and log in?
          </p>
          <label className="form-row checkbox-row bar-confirm-row">
            <input
              type="checkbox"
              checked={barDisabledConfirm}
              onChange={(e) => setBarDisabledConfirm(e.target.checked)}
              aria-label="I understand, log in"
            />
            <span>I understand, log in</span>
          </label>
        </div>
      )}

      {sessionInfo && ageRestricted && (
        <label className="form-row checkbox-row age-confirm-row">
          <input
            type="checkbox"
            checked={ageConfirmed}
            onChange={(e) => setAgeConfirmed(e.target.checked)}
            aria-label={`I confirm I am ${minimumAge}+ to use this service`}
          />
          <span>I confirm I am {minimumAge}+ to use this service.</span>
        </label>
      )}

      <p className="login-terms-hint">
        By joining, you agree to this instance&apos;s policies and our{' '}
        <a
          href="https://the-b4r.netlify.app/wiki/terms"
          target="_blank"
          rel="noopener noreferrer"
        >
          Terms
        </a>{' '}
        and{' '}
        <a
          href="https://the-b4r.netlify.app/wiki/privacy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Privacy
        </a>
        .
      </p>

      <form onSubmit={(e) => handleLogin(e, { ageConfirmed })}>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={connecting}
          autoFocus
        />
        <input
          type="text"
          placeholder="Password token (required to rejoin — save it)"
          value={reconnectToken}
          onChange={(e) => setReconnectToken(e.target.value)}
          disabled={connecting}
        />
        <input
          type="text"
          placeholder="Invite / access code (required)"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          disabled={connecting}
        />
        {loginError && <p className="login-error">{loginError}</p>}
        <div className="form-row">
          <button type="submit" disabled={joinDisabled}>
            {connecting
              ? 'Connecting…'
              : sessionInfoLoading
                ? 'Loading session…'
                : 'Join'}
          </button>
          {isTauri && desktopOrigin && (
            <button type="button" onClick={onBack}>
              Back
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
