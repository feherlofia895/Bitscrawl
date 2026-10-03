import { useEffect, useState } from 'react'
import { loadModeratorAccess } from '../lib/moderation'

export function useModeratorAccess(userId: string | null | undefined) {
  const [access, setAccess] = useState<{ userId: string; allowed: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    setAccess(null)
    if (!userId) return () => { cancelled = true }
    void loadModeratorAccess()
      .then(value => { if (!cancelled) setAccess({ userId, allowed: value }) })
      .catch(() => { if (!cancelled) setAccess(null) })
    return () => { cancelled = true }
  }, [userId])

  return Boolean(userId && access?.userId === userId && access.allowed)
}
