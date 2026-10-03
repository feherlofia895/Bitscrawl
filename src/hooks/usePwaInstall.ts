import { useCallback, useEffect, useState } from 'react'

type InstallOutcome = 'accepted' | 'dismissed'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: InstallOutcome; platform: string }>
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean
}

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as NavigatorWithStandalone).standalone === true
}

function isAppleMobile() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

export function usePwaInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandaloneApp)
  const [status, setStatus] = useState('')
  const [appleMobile] = useState(isAppleMobile)

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent
      promptEvent.preventDefault()
      setInstallPrompt(promptEvent)
      setStatus('')
    }
    const handleInstalled = () => {
      setInstallPrompt(null)
      setInstalled(true)
      setStatus('A Bitscrawl telepítve.')
    }

    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    setInstallPrompt(null)
    setStatus(choice.outcome === 'accepted'
      ? 'A telepítés elindult.'
      : 'A telepítést most kihagytad; később a böngésző menüjéből újra elindíthatod.')
  }, [installPrompt])

  return {
    appleMobile,
    canInstall: Boolean(installPrompt),
    install,
    installed,
    status,
  }
}
