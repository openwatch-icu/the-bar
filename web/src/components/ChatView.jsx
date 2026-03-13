import { useState, useEffect, useRef } from 'react'
import { MessageLine } from './MessageLine'
import { VirtualizedMessageList } from './VirtualizedMessageList'

function ChatInput({ value, onChange, placeholder, disabled, onKeyDownExtra }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [value])
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      e.target.form?.requestSubmit()
      return
    }
    onKeyDownExtra?.(e)
  }
  return (
    <textarea
      ref={ref}
      rows={1}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      className="input-row-input"
      aria-label={placeholder}
    />
  )
}

const TYPING_EXPIRE_MS = 3000

export function ChatView({
  currentRoom,
  roomsList,
  reconnectTip,
  wsRef,
  isWsOpen,
  dmThreads,
  dmView,
  setDmView,
  dmInputValue,
  setDmInputValue,
  dmTypingFrom,
  dmTypingAt,
  dmMessagesEndRef,
  username,
  messages,
  messagesEndRef,
  inputValue,
  setInputValue,
  roomTyping,
  usersInRoom,
  disconnected,
  handleReconnect,
  sendMessage,
  handleDmSend,
  resendDmKey,
  scheduleRoomTyping,
  scheduleDmTyping,
  onSettings,
  hasE2EWith,
  getPeerFingerprint,
  setPeerVerified,
  acceptNewKey,
  getVerificationStatus,
  roomHasE2EInUse,
  slowmodeRemainingSeconds = 0,
  rateLimitMessage = '',
  sendError = '',
  setSendError,
  welcomeMessages = [],
  setCurrentRoom,
}) {
  const [userListVisible, setUserListVisible] = useState(() =>
    typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 768px)').matches
      ? false
      : true
  )
  const [now, setNow] = useState(() => Date.now())
  const [, setE2eAcceptKey] = useState(0) // bump after acceptNewKey so status re-renders

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (dmView && dmMessagesEndRef?.current)
      dmMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [dmView, dmThreads, dmMessagesEndRef])

  useEffect(() => {
    messagesEndRef?.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, messagesEndRef])

  return (
    <div className="chat-layout">
      <aside className="sidebar">
        <div className="sidebar-section sidebar-header">
          <div className="current-room">
            {currentRoom === 'welcome' ? 'Welcome' : `#${currentRoom}`}
          </div>
          {onSettings && (
            <button
              type="button"
              className="icon-btn settings-btn"
              onClick={onSettings}
              title="Settings (takes effect on next join)"
              aria-label="Settings"
            >
              ⚙
            </button>
          )}
        </div>
        {reconnectTip && (
          <div className="sidebar-section reconnect-tip">
            <div className="sidebar-title">
              Rejoin later (use your password token)
            </div>
            <code className="reconnect-code">{reconnectTip}</code>
            <button
              type="button"
              className="sidebar-action"
              onClick={() => navigator.clipboard?.writeText(reconnectTip)}
            >
              Copy password token
            </button>
          </div>
        )}
        <div className="sidebar-section">
          <div className="sidebar-title">Channels</div>
          <button
            type="button"
            className="sidebar-action"
            onClick={() =>
              wsRef.current?.readyState === WebSocket.OPEN &&
              wsRef.current.send('/rooms')
            }
            disabled={!isWsOpen}
          >
            Refresh rooms
          </button>
          <ul className="room-list" aria-label="Channels">
            <li key="welcome">
              <button
                type="button"
                className={`room room-welcome ${currentRoom === 'welcome' ? 'active' : ''}`}
                onClick={() => {
                  setDmView(null)
                  setCurrentRoom?.('welcome')
                }}
                aria-current={currentRoom === 'welcome' ? 'true' : undefined}
              >
                Welcome
                {welcomeMessages.length > 0
                  ? ` (${welcomeMessages.length})`
                  : ''}
              </button>
            </li>
            {roomsList.map((r) => (
              <li key={r.name}>
                <button
                  type="button"
                  className={currentRoom === r.name ? 'room active' : 'room'}
                  onClick={() => {
                    setDmView(null)
                    setCurrentRoom?.(r.name)
                    if (wsRef.current?.readyState === WebSocket.OPEN)
                      wsRef.current.send(`/join ${r.name}`)
                  }}
                >
                  #{r.name} ({r.count})
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-title">Direct messages</div>
          <ul className="dm-list">
            {Object.keys(dmThreads)
              .filter((u) => u !== (username || '').trim())
              .sort()
              .map((peer) => (
                <li key={peer}>
                  <button
                    type="button"
                    className={dmView === peer ? 'room active' : 'room'}
                    onClick={() => setDmView(peer)}
                  >
                    {peer}
                    {dmThreads[peer]?.length > 0 && (
                      <span className="dm-preview">
                        {' '}
                        ({dmThreads[peer].length})
                      </span>
                    )}
                  </button>
                </li>
              ))}
          </ul>
          {Object.keys(dmThreads).filter((u) => u !== (username || '').trim())
            .length === 0 && (
            <p className="dm-list-empty">
              No conversations yet. Use /msg or message someone from the room.
            </p>
          )}
        </div>
        <div className="sidebar-section sidebar-commands">
          <div className="sidebar-title">Commands</div>
          <ul className="commands-list">
            <li>
              <code>/users</code> — List users in current room
            </li>
            <li>
              <code>/rooms</code> — List all rooms
            </li>
            <li>
              <code>/join {'<room>'}</code> — Join or create a room
            </li>
            <li>
              <code>/history [N]</code> — Last N messages
            </li>
            <li>
              <code>
                /msg {'<user>'} {'<msg>'}
              </code>{' '}
              — Private message
            </li>
            <li>
              <code>/token</code> — Show password token
            </li>
            <li>
              <code>/stats</code> — Show your stats
            </li>
            <li>
              <code>/commands</code> — Show commands in chat
            </li>
            <li>
              <code>/quit</code> — Leave
            </li>
          </ul>
        </div>
      </aside>
      <div className="chat-panel">
        <div className="chat-panel-header">
          {dmView ? (
            <>
              <span className="chat-panel-room">DM with {dmView}</span>
              <button
                type="button"
                className="sidebar-action chat-panel-back"
                onClick={() => setDmView(null)}
              >
                Back to{' '}
                {currentRoom === 'welcome' ? 'Welcome' : `#${currentRoom}`}
              </button>
            </>
          ) : (
            <span className="chat-panel-room">
              {currentRoom === 'welcome' ? 'Welcome' : `#${currentRoom}`}
            </span>
          )}
          {!dmView &&
            currentRoom !== 'welcome' &&
            roomHasE2EInUse?.(currentRoom) && (
              <span
                className="secure-badge"
                title="End-to-end encrypted; the server cannot read messages."
              >
                Secure
              </span>
            )}
          <button
            type="button"
            className="user-list-toggle"
            onClick={() => setUserListVisible((v) => !v)}
            title={userListVisible ? 'Hide user list' : 'Show user list'}
            aria-expanded={userListVisible}
            aria-label={userListVisible ? 'Hide user list' : 'Show user list'}
          >
            {userListVisible ? 'Hide users' : `Users (${usersInRoom.length})`}
          </button>
        </div>
        {disconnected && (
          <div className="banner disconnected">
            Disconnected. Refresh to reconnect.
            <button
              type="button"
              className="reconnect-btn"
              onClick={handleReconnect}
            >
              Reconnect
            </button>
          </div>
        )}
        {dmView ? (
          <>
            <div className="e2e-verification" role="status">
              {hasE2EWith?.(dmView) ? (
                <>
                  <span className="secure-badge" title="End-to-end encrypted.">
                    Secure
                  </span>
                  <span className="e2e-fingerprint-label">
                    Key fingerprint:{' '}
                  </span>
                  <code className="e2e-fingerprint">
                    {getPeerFingerprint?.(dmView) ?? '…'}
                  </code>
                  {getVerificationStatus?.(dmView) === 'key_mismatch' && (
                    <>
                      <span
                        className="e2e-status e2e-status-insecure"
                        title="Key changed since you verified (e.g. they reconnected). Accept the new key and re-verify once."
                      >
                        Insecure — key mismatch
                      </span>
                      <button
                        type="button"
                        className="e2e-accept-key-btn"
                        onClick={() => {
                          acceptNewKey?.(dmView)
                          setE2eAcceptKey((k) => k + 1)
                        }}
                        title="Accept this key and clear the mismatch so you can re-verify with the other person (e.g. after they refreshed)"
                      >
                        Accept new key
                      </button>
                    </>
                  )}
                  {getVerificationStatus?.(dmView) === 'unverified' && (
                    <>
                      <span className="e2e-status e2e-status-unverified">
                        Unverified
                      </span>
                      <button
                        type="button"
                        className="e2e-verify-btn"
                        onClick={() => setPeerVerified?.(dmView)}
                        title="Mark as verified after comparing this fingerprint with the other person out-of-band"
                      >
                        Mark as verified
                      </button>
                    </>
                  )}
                  {getVerificationStatus?.(dmView) === 'verified' && (
                    <span className="e2e-status e2e-status-verified">
                      Verified
                    </span>
                  )}
                  <button
                    type="button"
                    className="e2e-resend-key-btn"
                    onClick={() => resendDmKey?.(dmView)}
                    title='Send my encryption key to this user again (use if they see "Could not decrypt" or after they refreshed)'
                  >
                    Resend my key
                  </button>
                </>
              ) : (
                <>
                  <span className="e2e-status e2e-status-unverified">
                    Keys not exchanged yet
                  </span>
                  <button
                    type="button"
                    className="e2e-resend-key-btn"
                    onClick={() => resendDmKey?.(dmView)}
                    title="Send my encryption key to this user so they can encrypt messages to you"
                  >
                    Send my key
                  </button>
                </>
              )}
            </div>
            <div className="messages messages-dm" role="log">
              {(dmThreads[dmView] || []).length === 0 ? (
                <div className="dm-empty">No messages yet. Say hi below.</div>
              ) : (
                (dmThreads[dmView] || []).map((msg, i) => (
                  <div
                    key={i}
                    className={`dm-line ${msg.outgoing ? 'dm-outgoing' : 'dm-incoming'}`}
                  >
                    {!msg.outgoing && (
                      <span className="dm-from">{msg.from}:</span>
                    )}
                    <span className="dm-content">{msg.content}</span>
                  </div>
                ))
              )}
              <div ref={dmMessagesEndRef} />
            </div>
            <div className="typing-strip" aria-live="polite">
              {dmTypingFrom === dmView &&
                now - dmTypingAt < TYPING_EXPIRE_MS && (
                  <span className="typing-indicator">{dmView} is typing…</span>
                )}
            </div>
            {sendError && (
              <div className="send-error" role="alert">
                {sendError}
                {setSendError && (
                  <button
                    type="button"
                    className="send-error-dismiss"
                    onClick={() => setSendError('')}
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                )}
              </div>
            )}
            <form className="input-row" onSubmit={handleDmSend}>
              <ChatInput
                value={dmInputValue}
                onChange={(v) => {
                  setDmInputValue(v)
                  scheduleDmTyping()
                  setSendError?.('')
                }}
                placeholder={`Message @${dmView}…`}
                disabled={!isWsOpen}
              />
              <button type="submit" disabled={!isWsOpen}>
                Send
              </button>
            </form>
          </>
        ) : currentRoom === 'welcome' ? (
          <>
            <div
              className="welcome-channel"
              role="log"
              aria-label="Welcome channel"
            >
              <p className="welcome-channel-intro">
                Read-only — new guests joining this server.
              </p>
              <ul className="welcome-messages">
                {welcomeMessages.length === 0 ? (
                  <li className="welcome-empty">No joins yet.</li>
                ) : (
                  welcomeMessages.map((text, i) => (
                    <li key={i} className="welcome-line">
                      {text}
                    </li>
                  ))
                )}
              </ul>
            </div>
          </>
        ) : (
          <>
            <VirtualizedMessageList
              messages={messages}
              now={now}
              messagesEndRef={messagesEndRef}
            />
            <div className="typing-strip" aria-live="polite">
              {(() => {
                const who = Object.keys(roomTyping).filter(
                  (u) => roomTyping[u] && now - roomTyping[u] < TYPING_EXPIRE_MS
                )
                return who.length > 0 ? (
                  <span className="typing-indicator">
                    {who.length === 1
                      ? `${who[0]} is typing…`
                      : `${who.join(', ')} are typing…`}
                  </span>
                ) : null
              })()}
            </div>
            {(slowmodeRemainingSeconds > 0 || rateLimitMessage) && (
              <div className="slowmode-banner" role="status">
                {slowmodeRemainingSeconds > 0
                  ? `You can send again in ${slowmodeRemainingSeconds}s`
                  : rateLimitMessage}
              </div>
            )}
            {sendError && (
              <div className="send-error" role="alert">
                {sendError}
                {setSendError && (
                  <button
                    type="button"
                    className="send-error-dismiss"
                    onClick={() => setSendError('')}
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                )}
              </div>
            )}
            <form className="input-row" onSubmit={sendMessage}>
              <ChatInput
                value={inputValue}
                onChange={(v) => {
                  setInputValue(v)
                  scheduleRoomTyping()
                  setSendError?.('')
                }}
                placeholder="Message or /command"
                disabled={!isWsOpen}
              />
              <button
                type="submit"
                disabled={
                  !isWsOpen ||
                  slowmodeRemainingSeconds > 0 ||
                  !!rateLimitMessage
                }
              >
                Send
              </button>
            </form>
          </>
        )}
      </div>
      <aside
        className={`sidebar sidebar-right${userListVisible ? '' : ' sidebar-right--hidden'}`}
        aria-hidden={!userListVisible}
      >
        <div className="sidebar-section">
          <div className="sidebar-title">In this room</div>
          <button
            type="button"
            className="sidebar-action"
            onClick={() =>
              wsRef.current?.readyState === WebSocket.OPEN &&
              wsRef.current.send('/users')
            }
            disabled={!isWsOpen}
          >
            Refresh
          </button>
          <ul className="user-list">
            {usersInRoom.length === 0 ? (
              <li className="user-list-empty">No users yet</li>
            ) : (
              usersInRoom.map((u) => (
                <li key={u.name} className={u.idle ? 'user idle' : 'user'}>
                  <span className="user-name">{u.name}</span>
                  <span className="user-actions">
                    {u.name !== (username || '').trim() && (
                      <>
                        <button
                          type="button"
                          className="user-dm-btn"
                          onClick={() => {
                            setDmView(u.name)
                            if (!dmThreads[u.name]) setDmView(u.name)
                          }}
                          title={`Message ${u.name}`}
                        >
                          Message
                        </button>
                      </>
                    )}
                    {u.idle && <span className="user-status">idle</span>}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      </aside>
    </div>
  )
}
