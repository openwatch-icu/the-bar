export function DesktopHome({ onJoin, onLaunch, onSettings }) {
  return (
    <div className="login-panel desktop-home">
      <div className="desktop-home-header">
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
      <p className="desktop-home-sub">Choose how to continue</p>
      <div className="desktop-home-actions">
        <button type="button" className="desktop-home-btn" onClick={onJoin}>
          Join a session
        </button>
        <button type="button" className="desktop-home-btn" onClick={onLaunch}>
          Launch my instance
        </button>
      </div>
    </div>
  )
}
