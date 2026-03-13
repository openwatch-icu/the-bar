import './App.css'
import { useParams } from 'react-router-dom'
import { useConnection } from './hooks/useConnection'
import { useDesktopSession } from './hooks/useDesktopSession'
import { useSessionInfo } from './hooks/useSessionInfo'
import { DesktopHome } from './components/DesktopHome'
import { JoinForm } from './components/JoinForm'
import { LaunchWizard } from './components/LaunchWizard'
import { LoginForm } from './components/LoginForm'
import { ChatView } from './components/ChatView'
import { Settings } from './components/Settings'
import { getEnv } from './config/env'
import {
  DESKTOP_STORAGE_LAST_JOIN,
  DESKTOP_STORAGE_LAST_JOIN_SLUG,
  getInstanceSlug,
  getDefaultWsBaseUrl,
  getDefaultScheme,
  getWsUrl,
  getSessionInfoUrl,
} from './utils/sessionUrl'
import { useState, useEffect, useMemo } from 'react'

export function ChatApp() {
  const { instanceSlug: routeSlug } = useParams()
  const effectiveSlug =
    routeSlug?.trim() && routeSlug.trim() !== 'default'
      ? routeSlug.trim()
      : getInstanceSlug(null)

  const [showSettings, setShowSettings] = useState(false)
  const desktop = useDesktopSession()

  const effectiveSessionParams = useMemo(
    () => ({
      ...desktop.sessionParams,
      slug: desktop.sessionParams?.slug ?? effectiveSlug,
    }),
    [desktop.sessionParams, effectiveSlug]
  )

  // Desktop: restore session params from last-join URL + slug so session info fetches on load (Settings can show "This server reports" before connecting).
  // Only restore when we have a stored slug so we don't fetch e.g. /default/session-info when the instance is "bar".
  const {
    isTauri,
    joinFormUrl,
    joinFormSlug,
    sessionParams: desktopSessionParams,
    setSessionParams,
  } = desktop
  useEffect(() => {
    const slug = joinFormSlug?.trim()
    if (
      isTauri &&
      joinFormUrl?.trim() &&
      slug &&
      !desktopSessionParams?.wsBaseUrl
    ) {
      setSessionParams({
        wsBaseUrl: joinFormUrl.trim(),
        slug,
      })
    }
  }, [
    isTauri,
    joinFormUrl,
    joinFormSlug,
    desktopSessionParams?.wsBaseUrl,
    setSessionParams,
  ])

  const { sessionInfo, sessionInfoError } = useSessionInfo(
    effectiveSessionParams,
    {
      skip: desktop.isTauri && !desktop.sessionParams?.wsBaseUrl,
    }
  )

  const conn = useConnection(effectiveSessionParams, sessionInfo)
  const {
    phase,
    username,
    setUsername,
    reconnectToken,
    setReconnectToken,
    inviteCode,
    setInviteCode,
    loginError,
    connecting,
    messages,
    inputValue,
    setInputValue,
    disconnected,
    currentRoom,
    roomsList,
    usersInRoom,
    reconnectTip,
    dmThreads,
    dmView,
    setDmView,
    dmInputValue,
    setDmInputValue,
    roomTyping,
    dmTypingFrom,
    dmTypingAt,
    wsRef,
    messagesEndRef,
    dmMessagesEndRef,
    handleLogin,
    sendMessage,
    handleDmSend,
    resendDmKey,
    handleReconnect,
    scheduleRoomTyping,
    scheduleDmTyping,
    TYPING_EXPIRE_MS,
    isWsOpen,
    hasE2EWith,
    getPeerFingerprint,
    setPeerVerified,
    acceptNewKey,
    getVerificationStatus,
    hasRoomKey,
    generateRoomKey,
    sendRoomKeyToUser,
    roomHasE2EInUse,
    slowmodeRemainingSeconds,
    rateLimitMessage,
    sendError,
    setSendError,
    welcomeMessages,
    setCurrentRoom,
    forgetSession,
  } = conn

  const handleJoinSubmit = (e) => {
    e.preventDefault()
    desktop.setJoinFormError('')
    const trimmed = desktop.joinFormUrl.trim()
    // Desktop app: require URL and instance slug so session-info and WS use the correct instance.
    if (desktop.isTauri && !trimmed) {
      desktop.setJoinFormError('Please enter a server URL.')
      return
    }
    const slugTrimmed = desktop.joinFormSlug.trim()
    if (desktop.isTauri && !slugTrimmed) {
      desktop.setJoinFormError('Please enter instance slug (e.g. bar).')
      return
    }
    const defaultUrl = getDefaultWsBaseUrl()
    const url = trimmed || defaultUrl
    const slug = slugTrimmed || 'default'
    desktop.setSessionParams({ wsBaseUrl: url, slug })
    desktop.setDesktopOrigin('join')
    desktop.setDesktopView(null)
    setInviteCode(desktop.joinFormAccessCode.trim())
    try {
      localStorage.setItem(DESKTOP_STORAGE_LAST_JOIN, url)
      if (desktop.isTauri) {
        localStorage.setItem(DESKTOP_STORAGE_LAST_JOIN_SLUG, slug)
      }
    } catch {
      // ignore (e.g. localStorage disabled or quota exceeded)
    }
  }

  const handleLaunchSkipLicense = () => {
    desktop.setLaunchError('')
    desktop.setLaunchStep(2)
  }

  const handleLaunchValidate = async (e) => {
    e.preventDefault()
    desktop.setLaunchError('')
    const url = (desktop.launchLicenseServerUrl || '').trim().replace(/\/$/, '')
    const key = desktop.launchLicenseKey.trim()
    if (!url || !key) {
      desktop.setLaunchError(
        'License validation URL and license key are required.'
      )
      return
    }
    try {
      const res = await fetch(`${url}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      const raw = await res.text()
      let data
      try {
        data = raw ? JSON.parse(raw) : {}
      } catch {
        desktop.setLaunchError(
          'Server returned an invalid response. Use the license validation URL provided with your license, not the chat server.'
        )
        return
      }
      if (data.valid) {
        desktop.setLaunchValidated(true)
        desktop.setLaunchStep(2)
      } else {
        desktop.setLaunchError(data.error || 'Invalid or expired license key.')
      }
    } catch (err) {
      desktop.setLaunchError(
        err.message || 'Could not reach license validation service.'
      )
    }
  }

  const handleLaunchStart = async (e) => {
    e.preventDefault()
    if (!desktop.isTauri) {
      desktop.setLaunchError(
        'Starting the server is only available in the desktop app.'
      )
      return
    }
    desktop.setLaunchError('')
    desktop.setLaunchStarting(true)
    const port = desktop.launchPort.trim() || '8080'
    const slug = desktop.launchSlug.trim() || 'default'
    const dataDir = desktop.launchDataDir.trim() || './chatdata'
    const licenseKey = desktop.launchLicenseKey.trim()
    const licenseServerUrl = (desktop.launchLicenseServerUrl || '')
      .trim()
      .replace(/\/$/, '')
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('spawn_server', {
        licenseKey,
        licenseServerUrl,
        dataDir,
        httpAddr: `:${port}`,
        instanceSlug: slug,
        accessCode: desktop.launchAccessCode.trim(),
        barUserAllowed: desktop.launchBarUserAllowed,
        sessionBarMinutes: desktop.launchSessionBarMinutes || 0,
        minimumAge:
          typeof desktop.launchMinimumAge === 'number'
            ? desktop.launchMinimumAge
            : 0,
        logBroadcastBody: !!desktop.launchLogBroadcastBody,
        persistMessages: !!desktop.launchPersistMessages,
        inactivityMinutes:
          typeof desktop.launchInactivityMinutes === 'number' &&
          desktop.launchInactivityMinutes >= 1
            ? desktop.launchInactivityMinutes
            : 5,
      })
      desktop.setSessionParams({
        wsBaseUrl: `${getDefaultScheme()}://localhost:${port}`,
        slug,
      })
      desktop.setDesktopOrigin('launch')
      desktop.setDesktopView(null)
    } catch (err) {
      desktop.setLaunchError(err?.toString() || 'Failed to start server.')
    } finally {
      desktop.setLaunchStarting(false)
    }
  }

  const showDesktopHome = desktop.isTauri && desktop.desktopView === 'home'
  const showDesktopJoin = desktop.isTauri && desktop.desktopView === 'join'
  const showDesktopLaunch = desktop.isTauri && desktop.desktopView === 'launch'
  const showLogin =
    !(
      desktop.isTauri &&
      (desktop.desktopView === 'home' ||
        desktop.desktopView === 'join' ||
        desktop.desktopView === 'launch')
    ) && phase === 'login'
  const showChat =
    !(
      desktop.isTauri &&
      (desktop.desktopView === 'home' ||
        desktop.desktopView === 'join' ||
        desktop.desktopView === 'launch')
    ) && phase === 'chat'

  if (showSettings) {
    return (
      <div className={`app ${phase !== 'chat' ? 'app--login' : ''}`}>
        <Settings
          onClose={() => setShowSettings(false)}
          inChat={phase === 'chat'}
          sessionInfo={sessionInfo}
          hasRoomKey={hasRoomKey}
          currentRoom={currentRoom}
          onForgetSession={forgetSession}
        />
      </div>
    )
  }

  const showEntryUI =
    showLogin || showDesktopHome || showDesktopJoin || showDesktopLaunch
  const useMarketingTheme = showEntryUI || (showSettings && phase !== 'chat')
  return (
    <div className={`app ${useMarketingTheme ? 'app--login' : ''}`}>
      {showEntryUI && (
        <div className="app-entry-scroll">
          {showDesktopHome && (
            <DesktopHome
              onJoin={() => desktop.setDesktopView('join')}
              onLaunch={() => desktop.setDesktopView('launch')}
              onSettings={() => setShowSettings(true)}
            />
          )}
          {showDesktopJoin && (
            <JoinForm
              joinFormUrl={desktop.joinFormUrl}
              setJoinFormUrl={desktop.setJoinFormUrl}
              joinFormSlug={desktop.joinFormSlug}
              setJoinFormSlug={desktop.setJoinFormSlug}
              joinFormAccessCode={desktop.joinFormAccessCode}
              setJoinFormAccessCode={desktop.setJoinFormAccessCode}
              joinFormError={desktop.joinFormError}
              onSubmit={handleJoinSubmit}
              onBack={() => desktop.setDesktopView('home')}
            />
          )}
          {showDesktopLaunch && (
            <LaunchWizard
              launchStep={desktop.launchStep}
              launchLicenseKey={desktop.launchLicenseKey}
              setLaunchLicenseKey={desktop.setLaunchLicenseKey}
              launchLicenseServerUrl={desktop.launchLicenseServerUrl}
              setLaunchLicenseServerUrl={desktop.setLaunchLicenseServerUrl}
              launchError={desktop.launchError}
              launchDataDir={desktop.launchDataDir}
              setLaunchDataDir={desktop.setLaunchDataDir}
              launchPort={desktop.launchPort}
              setLaunchPort={desktop.setLaunchPort}
              launchSlug={desktop.launchSlug}
              setLaunchSlug={desktop.setLaunchSlug}
              launchAccessCode={desktop.launchAccessCode}
              setLaunchAccessCode={desktop.setLaunchAccessCode}
              launchBarUserAllowed={desktop.launchBarUserAllowed}
              setLaunchBarUserAllowed={desktop.setLaunchBarUserAllowed}
              launchSessionBarMinutes={desktop.launchSessionBarMinutes}
              setLaunchSessionBarMinutes={desktop.setLaunchSessionBarMinutes}
              launchMinimumAge={desktop.launchMinimumAge}
              setLaunchMinimumAge={desktop.setLaunchMinimumAge}
              launchLogBroadcastBody={desktop.launchLogBroadcastBody}
              setLaunchLogBroadcastBody={desktop.setLaunchLogBroadcastBody}
              launchPersistMessages={desktop.launchPersistMessages}
              setLaunchPersistMessages={desktop.setLaunchPersistMessages}
              launchInactivityMinutes={desktop.launchInactivityMinutes}
              setLaunchInactivityMinutes={desktop.setLaunchInactivityMinutes}
              launchStarting={desktop.launchStarting}
              onValidate={handleLaunchValidate}
              onSkipLicense={handleLaunchSkipLicense}
              onStart={handleLaunchStart}
              onBackToHome={() => {
                desktop.setDesktopView('home')
                desktop.setLaunchStep(1)
                desktop.setLaunchError('')
              }}
              onBackToStep1={() => desktop.setLaunchStep(1)}
            />
          )}
          {showLogin && (
            <LoginForm
              sessionParams={effectiveSessionParams}
              sessionInfoUrl={getSessionInfoUrl(effectiveSessionParams)}
              wsUrl={
                effectiveSessionParams != null || getEnv('VITE_WS_URL', '')
                  ? getWsUrl(effectiveSessionParams)
                  : null
              }
              sessionInfo={sessionInfo}
              sessionInfoError={sessionInfoError}
              username={username}
              setUsername={setUsername}
              reconnectToken={reconnectToken}
              setReconnectToken={setReconnectToken}
              inviteCode={inviteCode}
              setInviteCode={setInviteCode}
              loginError={loginError}
              connecting={connecting}
              handleLogin={handleLogin}
              isTauri={desktop.isTauri}
              desktopOrigin={desktop.desktopOrigin}
              onBack={() => desktop.setDesktopView(desktop.desktopOrigin)}
              onSettings={() => setShowSettings(true)}
            />
          )}
        </div>
      )}
      {showChat && (
        <ChatView
          currentRoom={currentRoom}
          roomsList={roomsList}
          reconnectTip={reconnectTip}
          wsRef={wsRef}
          isWsOpen={isWsOpen}
          dmThreads={dmThreads}
          dmView={dmView}
          setDmView={setDmView}
          dmInputValue={dmInputValue}
          setDmInputValue={setDmInputValue}
          dmTypingFrom={dmTypingFrom}
          dmTypingAt={dmTypingAt}
          dmMessagesEndRef={dmMessagesEndRef}
          username={username}
          messages={messages}
          messagesEndRef={messagesEndRef}
          inputValue={inputValue}
          setInputValue={setInputValue}
          roomTyping={roomTyping}
          usersInRoom={usersInRoom}
          disconnected={disconnected}
          handleReconnect={handleReconnect}
          sendMessage={sendMessage}
          handleDmSend={handleDmSend}
          resendDmKey={resendDmKey}
          scheduleRoomTyping={scheduleRoomTyping}
          scheduleDmTyping={scheduleDmTyping}
          onSettings={() => setShowSettings(true)}
          hasE2EWith={hasE2EWith}
          getPeerFingerprint={getPeerFingerprint}
          setPeerVerified={setPeerVerified}
          acceptNewKey={acceptNewKey}
          getVerificationStatus={getVerificationStatus}
          hasRoomKey={hasRoomKey}
          generateRoomKey={generateRoomKey}
          sendRoomKeyToUser={sendRoomKeyToUser}
          roomHasE2EInUse={roomHasE2EInUse}
          slowmodeRemainingSeconds={slowmodeRemainingSeconds}
          rateLimitMessage={rateLimitMessage}
          sendError={sendError}
          setSendError={setSendError}
          welcomeMessages={welcomeMessages}
          setCurrentRoom={setCurrentRoom}
        />
      )}
    </div>
  )
}
