import type { PixelChange } from './game'

type PixelSendTask = {
  changes: PixelChange[]
  submit: (changes: PixelChange[]) => Promise<unknown>
  onError: (error: unknown, retryChanges: PixelChange[]) => void
}

// Keep a revision even after a newer write has left the pending buffer.
// Otherwise retrying an older failed request can undo a successful newer one.
export function createPixelSendQueue() {
  const latestRevision = new Map<string, number>()
  let revision = 0
  let generation = 0
  let tail: Promise<void> = Promise.resolve()

  return {
    reset() {
      generation += 1
      latestRevision.clear()
    },
    enqueue({ changes, submit, onError }: PixelSendTask) {
      const taskGeneration = generation
      const taskRevision = ++revision
      const snapshot = changes.map(change => ({ ...change }))
      for (const { x, y } of snapshot) latestRevision.set(`${x},${y}`, taskRevision)

      tail = tail.then(async () => {
        if (generation !== taskGeneration) return
        try {
          // Capture the sender at enqueue time, including its round ID.
          await submit(snapshot)
        } catch (error) {
          if (generation !== taskGeneration) return
          onError(error, snapshot.filter(({ x, y }) =>
            latestRevision.get(`${x},${y}`) === taskRevision))
        }
      })
      return tail
    },
  }
}
