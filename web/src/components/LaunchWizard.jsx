const SESSION_BAR_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '60 minutes' },
]

export function LaunchWizard({
  launchStep,
  launchLicenseKey,
  setLaunchLicenseKey,
  launchLicenseServerUrl,
  setLaunchLicenseServerUrl,
  launchError,
  launchDataDir,
  setLaunchDataDir,
  launchPort,
  setLaunchPort,
  launchSlug,
  setLaunchSlug,
  launchAccessCode,
  setLaunchAccessCode,
  launchBarUserAllowed,
  setLaunchBarUserAllowed,
  launchSessionBarMinutes,
  setLaunchSessionBarMinutes,
  launchMinimumAge,
  setLaunchMinimumAge,
  launchLogBroadcastBody,
  setLaunchLogBroadcastBody,
  launchPersistMessages,
  setLaunchPersistMessages,
  launchInactivityMinutes,
  setLaunchInactivityMinutes,
  launchStarting,
  onValidate,
  onSkipLicense,
  onStart,
  onBackToHome,
  onBackToStep1,
}) {
  return (
    <div className="login-panel">
      <h1>Launch my instance</h1>
      {launchStep === 1 ? (
        <>
          <p className="settings-hint">
            Use a license key for corporate or licensed instances. You can skip
            this for personal or public instances.
          </p>
          <form onSubmit={onValidate} noValidate>
            <input
              type="text"
              placeholder="License validation URL"
              value={launchLicenseServerUrl}
              onChange={(e) => setLaunchLicenseServerUrl(e.target.value)}
            />
            <input
              type="text"
              placeholder="License key"
              value={launchLicenseKey}
              onChange={(e) => setLaunchLicenseKey(e.target.value)}
            />
            {launchError && <p className="login-error">{launchError}</p>}
            <div className="form-row">
              <button
                type="submit"
                disabled={
                  !launchLicenseServerUrl?.trim() || !launchLicenseKey?.trim()
                }
              >
                Validate and continue
              </button>
              <button type="button" onClick={onSkipLicense}>
                Start without license (personal/public)
              </button>
              <button type="button" onClick={onBackToHome}>
                Back
              </button>
            </div>
          </form>
        </>
      ) : (
        <form onSubmit={onStart}>
          <input
            type="text"
            placeholder="Data directory (default: ./chatdata)"
            value={launchDataDir}
            onChange={(e) => setLaunchDataDir(e.target.value)}
          />
          <input
            type="text"
            placeholder="HTTP port (default: 8080)"
            value={launchPort}
            onChange={(e) => setLaunchPort(e.target.value)}
          />
          <input
            type="text"
            placeholder="Instance slug (default: default)"
            value={launchSlug}
            onChange={(e) => setLaunchSlug(e.target.value)}
          />
          <input
            type="text"
            placeholder="Access code (optional)"
            value={launchAccessCode}
            onChange={(e) => setLaunchAccessCode(e.target.value)}
          />
          <label className="form-row checkbox-row">
            <input
              type="checkbox"
              checked={launchBarUserAllowed}
              onChange={(e) => setLaunchBarUserAllowed(e.target.checked)}
            />
            <span>
              Allow user BAR (users can set their own burn-after-reading, up to
              session limit)
            </span>
          </label>
          <label className="form-row">
            <span>Session BAR (minutes)</span>
            <select
              value={launchSessionBarMinutes}
              onChange={(e) =>
                setLaunchSessionBarMinutes(Number(e.target.value))
              }
            >
              {SESSION_BAR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-row">
            <span>Minimum age (0 = no restriction)</span>
            <input
              type="number"
              min={0}
              max={120}
              placeholder="18"
              value={launchMinimumAge}
              onChange={(e) => {
                const v = e.target.value
                if (v === '') setLaunchMinimumAge(0)
                else {
                  const n = parseInt(v, 10)
                  if (Number.isFinite(n) && n >= 0) setLaunchMinimumAge(n)
                }
              }}
            />
          </label>
          <div className="form-row settings-hint">
            Privacy and logging (server logs)
          </div>
          <label className="form-row checkbox-row">
            <input
              type="checkbox"
              checked={launchLogBroadcastBody}
              onChange={(e) => setLaunchLogBroadcastBody(e.target.checked)}
            />
            <span>Log message bodies in server logs</span>
          </label>
          <label className="form-row checkbox-row">
            <input
              type="checkbox"
              checked={launchPersistMessages}
              onChange={(e) => setLaunchPersistMessages(e.target.checked)}
            />
            <span>Persist message history to disk</span>
          </label>
          <label className="form-row">
            <span>Disconnect after (minutes of inactivity)</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={launchInactivityMinutes}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                if (Number.isFinite(n) && n >= 1) setLaunchInactivityMinutes(n)
              }}
            />
          </label>
          <p className="settings-note launch-note">
            Session BAR and user BAR allowance cannot be changed until the
            session is restarted.
          </p>
          {launchError && <p className="login-error">{launchError}</p>}
          <div className="form-row">
            <button type="submit" disabled={launchStarting}>
              {launchStarting ? 'Starting…' : 'Start server'}
            </button>
            <button
              type="button"
              onClick={onBackToStep1}
              disabled={launchStarting}
            >
              Back
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
