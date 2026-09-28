import { useState } from 'react'
import {
  loadAdminArtworkReactions,
  type AdminArtworkReaction,
  type ArtworkReactionTargetKind,
} from '../lib/moderation'

type AdminArtworkReactionsProps = {
  count: number
  kind: ArtworkReactionTargetKind
  targetId: number
}

function reactionTime(value: string) {
  return new Intl.DateTimeFormat('hu-HU', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(new Date(value))
}

export function AdminArtworkReactions({ count, kind, targetId }: AdminArtworkReactionsProps) {
  const [reactions, setReactions] = useState<AdminArtworkReaction[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')

  const load = () => {
    if (state !== 'idle') return
    setState('loading')
    void loadAdminArtworkReactions(kind, targetId)
      .then(value => {
        setReactions(value)
        setState('loaded')
      })
      .catch(() => setState('error'))
  }

  if (count < 1) return null

  return <details className="admin-artwork-reactions" onToggle={event => {
    if (event.currentTarget.open) load()
  }}>
    <summary>Admin: kik?</summary>
    <div className="admin-artwork-reactions-panel">
      {state === 'loading' ? <p>Betöltés…</p> : null}
      {state === 'error' ? <p>Nem sikerült betölteni.</p> : null}
      {state === 'loaded' && !reactions.length ? <p>Nincs aktív reakció.</p> : null}
      {state === 'loaded' && reactions.length ? <ul>{reactions.map(reaction => <li key={`${reaction.displayName}-${reaction.reactedAt}`}>
        <strong>{reaction.displayName}</strong>
        <time dateTime={reaction.reactedAt}>{reactionTime(reaction.reactedAt)}</time>
      </li>)}</ul> : null}
    </div>
  </details>
}
