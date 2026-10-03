import { useCallback, useEffect, useRef, useState } from 'react'

interface BuildInfo {
  buildId: string
}

function isBuildInfo(value: unknown): value is BuildInfo {
  return typeof value === 'object' &&
    value !== null &&
    'buildId' in value &&
    typeof value.buildId === 'string'
}

export function usePwaUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const checkingRef = useRef(false)

  const checkForUpdate = useCallback(async () => {
    if (!import.meta.env.PROD || checkingRef.current || updateAvailable) return

    checkingRef.current = true
    try {
      const response = await fetch(`/build-info.json?t=${Date.now()}`, {
        cache: 'no-store',
      })
      if (!response.ok) return

      const buildInfo: unknown = await response.json()
      if (isBuildInfo(buildInfo) && buildInfo.buildId !== __BITSCRAWL_BUILD_ID__) {
        setUpdateAvailable(true)
      }
    } catch {
      // A frissítés ellenőrzése nem zavarhatja meg a játékot offline vagy gyenge hálózaton.
    } finally {
      checkingRef.current = false
    }
  }, [updateAvailable])

  useEffect(() => {
    void checkForUpdate()

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkForUpdate()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [checkForUpdate])

  const reload = useCallback(() => {
    window.location.reload()
  }, [])

  return {
    buildId: __BITSCRAWL_BUILD_ID__,
    reload,
    updateAvailable,
  }
}
