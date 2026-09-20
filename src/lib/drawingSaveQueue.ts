export type DrawingSaveTask<Key> = {
  key: Key
  pixels: string[]
  version: number
}

type DrawingSaveQueueOptions<Key> = {
  delay?: number
  onError?: (error: unknown, task: DrawingSaveTask<Key>) => void
  onSaved?: (task: DrawingSaveTask<Key>) => void
  save: (key: Key, pixels: string[]) => Promise<unknown>
}

export type DrawingSaveQueue<Key> = {
  flush: () => Promise<void>
  hasUnsavedChanges: () => boolean
  schedule: (key: Key, pixels: string[]) => void
}

export function createDrawingSaveQueue<Key>({
  delay = 800,
  onError,
  onSaved,
  save,
}: DrawingSaveQueueOptions<Key>): DrawingSaveQueue<Key> {
  let latestVersion = 0
  let pending: DrawingSaveTask<Key> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let tail: Promise<void> = Promise.resolve()
  let unsavedChanges = false

  const enqueuePending = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }

    const task = pending
    pending = null
    if (!task) return tail

    const previous = tail.catch(() => undefined)
    const current = previous.then(async () => {
      await save(task.key, [...task.pixels])
      if (task.version === latestVersion) {
        unsavedChanges = false
        onSaved?.(task)
      }
    })
    current.catch(error => {
      if (task.version === latestVersion) {
        pending ??= task
        onError?.(error, task)
      }
    })
    tail = current
    return current
  }

  return {
    flush: async () => {
      await enqueuePending()
    },
    hasUnsavedChanges: () => unsavedChanges,
    schedule: (key, pixels) => {
      latestVersion += 1
      unsavedChanges = true
      pending = { key, pixels: [...pixels], version: latestVersion }
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => { void enqueuePending() }, delay)
    },
  }
}
