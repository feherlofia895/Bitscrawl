import { useState } from 'react'
import type { GalleryComment } from '../lib/galleryComments'
import { ProfileAvatar } from './ProfileAvatar'

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('hu-HU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function GalleryComments({
  busy,
  comments,
  isSignedIn,
  onSubmit,
  onUpdate,
}: {
  busy: boolean
  comments: GalleryComment[]
  isSignedIn: boolean
  onSubmit: (content: string) => Promise<void>
  onUpdate: (commentId: number, content: string) => Promise<void>
}) {
  const [content, setContent] = useState('')
  const [open, setOpen] = useState(comments.length > 0)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingContent, setEditingContent] = useState('')

  const submit = async () => {
    const clean = content.trim()
    if (!clean) return
    try {
      await onSubmit(clean)
      setContent('')
      setOpen(true)
    } catch {
      // The parent displays the translated error and keeps the text for retrying.
    }
  }

  const update = async () => {
    if (editingId === null || !editingContent.trim()) return
    try {
      await onUpdate(editingId, editingContent.trim())
      setEditingId(null)
      setEditingContent('')
    } catch {
      // The parent displays the translated error and keeps the text for retrying.
    }
  }

  return <section className="gallery-comments">
    <button aria-expanded={open} className="gallery-comments-toggle" onClick={() => setOpen(current => !current)} type="button">
      Kommentek ({comments.length})
    </button>
    {open ? <div className="gallery-comments-body">
      {comments.length ? <ol className="gallery-comment-list">{comments.map(comment => <li key={comment.comment_id}>
        <div className="gallery-comment-author">
          <ProfileAvatar label={`${comment.author_name} profilképe`} pixels={comment.authorAvatar} />
          <strong>{comment.author_name}</strong>
          <time dateTime={comment.created_at}>{dateLabel(comment.created_at)}</time>
        </div>
        {editingId === comment.comment_id ? <form className="gallery-comment-edit" onSubmit={event => { event.preventDefault(); void update() }}>
          <label><span className="visually-hidden">Komment szerkesztése</span><textarea maxLength={280} onChange={event => setEditingContent(event.target.value)} rows={3} value={editingContent} /></label>
          <div><button disabled={busy} onClick={() => { setEditingId(null); setEditingContent('') }} type="button">Mégse</button><button disabled={busy || !editingContent.trim()} type="submit">Mentés</button></div>
        </form> : <><p>{comment.content}</p>{comment.is_own ? <button className="gallery-comment-edit-button" disabled={busy} onClick={() => { setEditingId(comment.comment_id); setEditingContent(comment.content) }} type="button">Szerkesztés</button> : null}</>}
      </li>)}</ol> : <p className="gallery-comments-empty">Még nincs komment. Legyél te az első!</p>}
      {isSignedIn ? <form className="gallery-comment-form" onSubmit={event => { event.preventDefault(); void submit() }}>
        <label><span className="visually-hidden">Új komment</span><textarea maxLength={280} onChange={event => setContent(event.target.value)} placeholder="Na mi van?" rows={3} value={content} /></label>
        <div><small>{content.length}/280</small><button disabled={busy || !content.trim()} type="submit">Küldés</button></div>
      </form> : <p className="gallery-comments-login">Kommenteléshez jelentkezz be.</p>}
    </div> : null}
  </section>
}
