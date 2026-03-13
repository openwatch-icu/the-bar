import { useState } from 'react'
import { getEnv } from '../config/env'
import {
  DESKTOP_STORAGE_LAST_JOIN,
  DESKTOP_STORAGE_LAST_JOIN_SLUG,
  getDefaultWsBaseUrl,
  getDefaultPort,
} from '../utils/sessionUrl'

const isTauri =
  typeof window !== 'undefined' &&
  (window.__TAURI_INTERNALS__ != null || window.__TAURI__ != null)

export function useDesktopSession() {
  const [desktopView, setDesktopView] = useState(() =>
    isTauri ? 'home' : null
  )
  const [desktopOrigin, setDesktopOrigin] = useState(null)
  const [sessionParams, setSessionParams] = useState(null)
  const [joinFormUrl, setJoinFormUrl] = useState(() => {
    const stored = (() => {
      try {
        return localStorage.getItem(DESKTOP_STORAGE_LAST_JOIN)
      } catch {
        return null
      }
    })()
    // Desktop app: no default URL; user enters any server they want. Browser: allow env/default for deployed instances.
    if (isTauri) return stored || ''
    const envBase = getEnv('VITE_WS_URL', '')
    return envBase || stored || getDefaultWsBaseUrl()
  })
  const [joinFormSlug, setJoinFormSlug] = useState(() => {
    if (!isTauri) return 'default'
    try {
      const slug = localStorage.getItem(DESKTOP_STORAGE_LAST_JOIN_SLUG)
      return slug != null && slug !== '' ? slug : ''
    } catch {
      return ''
    }
  })
  const [joinFormAccessCode, setJoinFormAccessCode] = useState('')
  const [joinFormError, setJoinFormError] = useState('')
  const [launchStep, setLaunchStep] = useState(1)
  const [launchLicenseKey, setLaunchLicenseKey] = useState('')
  const [launchLicenseServerUrl, setLaunchLicenseServerUrl] = useState(
    getEnv('VITE_LICENSE_SERVER_URL', '')
  )
  const [launchValidated, setLaunchValidated] = useState(false)
  const [launchDataDir, setLaunchDataDir] = useState('')
  const [launchPort, setLaunchPort] = useState(() => getDefaultPort())
  const [launchSlug, setLaunchSlug] = useState('default')
  const [launchAccessCode, setLaunchAccessCode] = useState('')
  const [launchBarUserAllowed, setLaunchBarUserAllowed] = useState(true)
  const [launchSessionBarMinutes, setLaunchSessionBarMinutes] = useState(0)
  const [launchMinimumAge, setLaunchMinimumAge] = useState(0)
  const [launchLogBroadcastBody, setLaunchLogBroadcastBody] = useState(false)
  const [launchPersistMessages, setLaunchPersistMessages] = useState(true)
  const [launchInactivityMinutes, setLaunchInactivityMinutes] = useState(5)
  const [launchError, setLaunchError] = useState('')
  const [launchStarting, setLaunchStarting] = useState(false)

  return {
    isTauri,
    desktopView,
    setDesktopView,
    desktopOrigin,
    setDesktopOrigin,
    sessionParams,
    setSessionParams,
    joinFormUrl,
    setJoinFormUrl,
    joinFormSlug,
    setJoinFormSlug,
    joinFormAccessCode,
    setJoinFormAccessCode,
    joinFormError,
    setJoinFormError,
    launchStep,
    setLaunchStep,
    launchLicenseKey,
    setLaunchLicenseKey,
    launchLicenseServerUrl,
    setLaunchLicenseServerUrl,
    launchValidated,
    setLaunchValidated,
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
    launchError,
    setLaunchError,
    launchStarting,
    setLaunchStarting,
  }
}
