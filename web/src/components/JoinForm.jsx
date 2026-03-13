export function JoinForm({
  joinFormUrl,
  setJoinFormUrl,
  joinFormSlug,
  setJoinFormSlug,
  joinFormAccessCode,
  setJoinFormAccessCode,
  joinFormError,
  onSubmit,
  onBack,
}) {
  return (
    <div className="login-panel">
      <h1>Join a session</h1>
      <form onSubmit={onSubmit}>
        {joinFormError && (
          <p className="login-error" role="alert">
            {joinFormError}
          </p>
        )}
        <input
          type="text"
          placeholder="Server URL (e.g. https://chat.example.com)"
          value={joinFormUrl}
          onChange={(e) => setJoinFormUrl(e.target.value)}
        />
        <input
          type="text"
          placeholder="Instance slug (e.g. bar or default)"
          value={joinFormSlug}
          onChange={(e) => setJoinFormSlug(e.target.value)}
        />
        <input
          type="text"
          placeholder="Access code (optional)"
          value={joinFormAccessCode}
          onChange={(e) => setJoinFormAccessCode(e.target.value)}
        />
        <div className="form-row">
          <button type="submit">Connect</button>
          <button type="button" onClick={onBack}>
            Back
          </button>
        </div>
      </form>
    </div>
  )
}
