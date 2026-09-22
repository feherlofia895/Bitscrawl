import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  GALLERY_COMMENT_PAGE_SIZE,
  type GalleryComment,
  type GalleryCommentPage,
} from '../lib/galleryComments'
import { ProfileAvatar } from './ProfileAvatar'
import { ProfilePreviewButton } from './ProfilePreviewButton'

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('hu-HU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function GalleryComments({
  busy,
  comments: providedComments,
  commentCount,
  isSignedIn,
  artworkAuthor,
  loadComments,
  onSubmit,
  onUpdate,
}: {
  busy: boolean
  comments?: GalleryComment[]
  commentCount?: number
  isSignedIn: boolean
  artworkAuthor: string
  loadComments?: (page: number) => Promise<GalleryCommentPage>
  onSubmit: (content: string) => Promise<void>
  onUpdate: (commentId: number, content: string) => Promise<void>
}) {
  const [content, setContent] = useState('')
  const [open, setOpen] = useState(false)
  const [comments, setComments] = useState<GalleryComment[]>(providedComments ?? [])
  const [totalCount, setTotalCount] = useState(commentCount ?? providedComments?.length ?? 0)
  const [commentLoading, setCommentLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const titleId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const loadVersionRef = useRef(0)
  const loadCommentsRef = useRef(loadComments)
  loadCommentsRef.current = loadComments

  useEffect(() => {
    if (!providedComments) return
    setComments(providedComments)
    setTotalCount(providedComments.length)
  }, [providedComments])

  useEffect(() => {
    if (providedComments) return
    setTotalCount(commentCount ?? 0)
  }, [commentCount, providedComments])

  const loadPage = useCallback(async (page: number, replace: boolean) => {
    const loader = loadCommentsRef.current
    if (!loader) return
    const loadVersion = ++loadVersionRef.current
    setCommentLoading(true)
    setLoadError('')
    try {
      const result = await loader(page)
      if (loadVersion !== loadVersionRef.current) return
      setComments(current => replace ? result.comments : [...current, ...result.comments])
      setTotalCount(result.totalCount)
    } catch {
      if (loadVersion === loadVersionRef.current) setLoadError('A kommenteket most nem sikerült betölteni.')
    } finally {
      if (loadVersion === loadVersionRef.current) setCommentLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    if (loadCommentsRef.current) void loadPage(1, true)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.querySelector('.profile-preview-modal')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setOpen(false)
      window.setTimeout(() => triggerRef.current?.focus(), 0)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [loadPage, open])

  const close = () => {
    setOpen(false)
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }

  const submit = async () => {
    const clean = content.trim()
    if (!clean) return
    try {
      await onSubmit(clean)
      setContent('')
      if (loadCommentsRef.current) await loadPage(1, true)
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
      if (loadCommentsRef.current) await loadPage(1, true)
    } catch {
      // The parent displays the translated error and keeps the text for retrying.
    }
  }

  return <section className="gallery-comments">
    <button aria-expanded={open} aria-haspopup="dialog" className="gallery-comments-toggle" onClick={() => setOpen(true)} ref={triggerRef} type="button">
      Kommentek ({totalCount})
    </button>
    {open ? createPortal(
      <div className="modal-backdrop gallery-comments-backdrop" onMouseDown={event => {
        if (event.target === event.currentTarget) close()
      }}>
        <section aria-labelledby={titleId} aria-modal="true" className="gallery-comments-modal" role="dialog">
          <header className="gallery-comments-heading">
            <div>
              <p className="step-label">{artworkAuthor} rajzához</p>
              <h2 id={titleId}>Kommentek</h2>
            </div>
            <div className="gallery-comments-heading-actions">
              <span>{totalCount} komment</span>
              <button aria-label="Kommentek bezárása" onClick={close} ref={closeRef} type="button">×</button>
            </div>
          </header>
          <div className="gallery-comments-body">
            {commentLoading && comments.length === 0 ? <p className="gallery-comments-empty">Kommentek betöltése…</p> : comments.length ? <ol className="gallery-comment-list">{comments.map(comment => <li key={comment.comment_id}>
              <div className="gallery-comment-author-row">
                <ProfilePreviewButton className="gallery-comment-author" name={comment.author_name} pixels={comment.authorAvatar}>
                  <ProfileAvatar label={`${comment.author_name} profilképe`} pixels={comment.authorAvatar} />
                  <strong>{comment.author_name}</strong>
                </ProfilePreviewButton>
                <time dateTime={comment.created_at}>{dateLabel(comment.created_at)}</time>
              </div>
              {editingId === comment.comment_id ? <form className="gallery-comment-edit" onSubmit={event => { event.preventDefault(); void update() }}>
                <label><span className="visually-hidden">Komment szerkesztése</span><textarea maxLength={280} onChange={event => setEditingContent(event.target.value)} rows={3} value={editingContent} /></label>
                <div><button disabled={busy} onClick={() => { setEditingId(null); setEditingContent('') }} type="button">Mégse</button><button disabled={busy || !editingContent.trim()} type="submit">Mentés</button></div>
              </form> : <><p>{comment.content}</p>{comment.is_own ? <button className="gallery-comment-edit-button" disabled={busy} onClick={() => { setEditingId(comment.comment_id); setEditingContent(comment.content) }} type="button">Szerkesztés</button> : null}</>}
            </li>)}</ol> : <p className="gallery-comments-empty">Még nincs komment. Legyél te az első!</p>}
            {loadError ? <p className="gallery-comments-empty">{loadError} <button disabled={commentLoading} onClick={() => void loadPage(1, true)} type="button">Újrapróbálom</button></p> : null}
            {loadComments && comments.length < totalCount ? <button disabled={commentLoading} onClick={() => void loadPage(Math.floor(comments.length / GALLERY_COMMENT_PAGE_SIZE) + 1, false)} type="button">{commentLoading ? 'Betöltés…' : 'További korábbi kommentek'}</button> : null}
            {isSignedIn ? <form className="gallery-comment-form" onSubmit={event => { event.preventDefault(); void submit() }}>
              <label><span className="visually-hidden">Új komment</span><textarea maxLength={280} onChange={event => setContent(event.target.value)} placeholder="Na mi van?" rows={3} value={content} /></label>
              <div><small>{content.length}/280</small><button disabled={busy || !content.trim()} type="submit">Küldés</button></div>
            </form> : <p className="gallery-comments-login">Kommenteléshez jelentkezz be.</p>}
          </div>
        </section>
      </div>,
      document.body,
    ) : null}
  </section>
}
