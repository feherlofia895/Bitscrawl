import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { emptyDrawing } from '../lib/drawing'
import {
  addDailyFeedComment,
  deleteOwnDailyFeedPost,
  FEED_DESCRIPTION_MAX_LENGTH,
  FEED_DESCRIPTION_MAX_LINES,
  limitFeedDescription,
  loadDailyFeed,
  loadDailyFeedAccountState,
  parseFeedPixels,
  publishDailyFeedPost,
  setDailyFeedLike,
  updateDailyFeedComment,
  type DailyFeedAccountState,
  type DailyFeedPost,
} from '../lib/feed'
import { getWeeklyUser } from '../lib/weekly'
import { GalleryComments } from './GalleryComments'
import { GalleryPagination } from './GalleryPagination'
import { ConfirmModal } from './ConfirmModal'
import { PixelCanvas } from './PixelCanvas'
import { ProfileAvatar } from './ProfileAvatar'
import { ProfilePreviewButton } from './ProfilePreviewButton'
import { WeeklyArtwork } from './WeeklyArtwork'

const draftPrefix = 'bitscrawl-feed-draft:'

type LocalFeedDraft = { description: string; pixels: string[] }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'A hírfolyam művelete nem sikerült.'
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('hu-HU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function loadLocalDraft(userId: string): LocalFeedDraft | null {
  try {
    const stored = localStorage.getItem(`${draftPrefix}${userId}`)
    if (!stored) return null
    const parsed = JSON.parse(stored)
    const legacyPixels = parseFeedPixels(parsed)
    if (legacyPixels) return { description: '', pixels: legacyPixels }
    if (!parsed || typeof parsed !== 'object') return null
    const pixels = parseFeedPixels(parsed.pixels)
    return pixels ? { description: limitFeedDescription(String(parsed.description ?? '')), pixels } : null
  } catch {
    return null
  }
}

function saveLocalDraft(userId: string, pixels: string[], description: string) {
  try {
    localStorage.setItem(`${draftPrefix}${userId}`, JSON.stringify({ description, pixels }))
    return true
  } catch {
    return false
  }
}

export function DailyFeed({
  onBack,
  onSelectMonthly,
  onSelectWeekly,
}: {
  onBack: () => void
  onSelectMonthly: () => void
  onSelectWeekly: () => void
}) {
  const [posts, setPosts] = useState<DailyFeedPost[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [user, setUser] = useState<User | null>(null)
  const [account, setAccount] = useState<DailyFeedAccountState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingPostId, setEditingPostId] = useState<number | null>(null)
  const [description, setDescription] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DailyFeedPost | null>(null)
  const [revision, setRevision] = useState(0)
  const [status, setStatus] = useState('A hírfolyam betöltése…')
  const pixelsRef = useRef(emptyDrawing())

  const refresh = useCallback(async (requestedPage: number, knownUser?: User | null) => {
    const currentUser = knownUser === undefined ? await getWeeklyUser() : knownUser
    const [feedPage, nextAccount] = await Promise.all([
      loadDailyFeed(requestedPage),
      currentUser ? loadDailyFeedAccountState() : Promise.resolve(null),
    ])
    setUser(currentUser)
    setPosts(feedPage.posts)
    setTotalCount(feedPage.totalCount)
    setAccount(nextAccount)
  }, [])

  useEffect(() => {
    let cancelled = false
    void refresh(1).then(() => {
      if (!cancelled) setStatus('A hírfolyam naprakész.')
    }).catch(error => {
      if (!cancelled) setStatus(errorMessage(error))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [refresh])

  const changePage = async (nextPage: number) => {
    setLoading(true)
    setPage(nextPage)
    try {
      await refresh(nextPage, user)
      setStatus('A hírfolyamoldal betöltve.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const handleDrawingChange = useCallback((pixels: string[]) => {
    pixelsRef.current = pixels
    const saved = user ? saveLocalDraft(user.id, pixels, description) : false
    setStatus(saved ? 'A rajz helyben mentve. Közzétételre vár.' : 'A rajz még nincs közzétéve.')
  }, [description, user])

  const handleDescriptionChange = (value: string) => {
    const nextDescription = limitFeedDescription(value)
    setDescription(nextDescription)
    if (user) saveLocalDraft(user.id, pixelsRef.current, nextDescription)
  }

  const publish = async () => {
    setBusy(true)
    try {
      await publishDailyFeedPost(pixelsRef.current, editingPostId, description)
      if (user) localStorage.removeItem(`${draftPrefix}${user.id}`)
      setPage(1)
      await refresh(1, user)
      setEditorOpen(false)
      setEditingPostId(null)
      setDescription('')
      pixelsRef.current = emptyDrawing()
      setRevision(value => value + 1)
      setStatus(editingPostId ? 'A képed frissítve.' : 'A mai képed megjelent a hírfolyamban!')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const startNewPost = () => {
    if (!user || (account?.todayPostCount ?? 0) >= 2) return
    const draft = loadLocalDraft(user.id)
    pixelsRef.current = draft?.pixels ?? emptyDrawing()
    setDescription(draft?.description ?? '')
    setEditingPostId(null)
    setRevision(value => value + 1)
    setEditorOpen(true)
    setStatus(`Ma még ${2 - (account?.todayPostCount ?? 0)} képet tehetsz közzé.`)
  }

  const startEditingPost = (post: DailyFeedPost) => {
    pixelsRef.current = [...post.pixels]
    setDescription(post.description)
    setEditingPostId(post.post_id)
    setRevision(value => value + 1)
    setEditorOpen(true)
    setStatus('A kiválasztott saját képedet szerkeszted.')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (post: DailyFeedPost) => {
    setBusy(true)
    const deletedToday = account?.postDate === post.post_date
    try {
      await deleteOwnDailyFeedPost(post.post_id)
      if (deletedToday && user) {
        saveLocalDraft(user.id, post.pixels, post.description)
        pixelsRef.current = [...post.pixels]
        setDescription(post.description)
        setEditingPostId(null)
        setRevision(value => value + 1)
        setEditorOpen(true)
      }
      setPage(1)
      await refresh(1, user)
      setStatus(deletedToday
        ? 'A képed törölve. A napi hely felszabadult, a rajzot piszkozatként megtartottuk.'
        : 'A saját képed törölve.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const handleLike = async (post: DailyFeedPost) => {
    setBusy(true)
    try {
      await setDailyFeedLike(post.post_id, !post.has_liked)
      await refresh(page, user)
      setStatus(post.has_liked ? 'A kedvelést visszavontad.' : 'Kedvelés elmentve.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const handleComment = async (postId: number, content: string) => {
    setBusy(true)
    try {
      await addDailyFeedComment(postId, content)
      await refresh(page, user)
      setStatus('A hozzászólásod megmaradt a kép alatt.')
    } catch (error) {
      setStatus(errorMessage(error))
      throw error
    } finally {
      setBusy(false)
    }
  }

  const handleCommentUpdate = async (commentId: number, content: string) => {
    setBusy(true)
    try {
      await updateDailyFeedComment(commentId, content)
      await refresh(page, user)
      setStatus('A hozzászólás módosításai elmentve.')
    } catch (error) {
      setStatus(errorMessage(error))
      throw error
    } finally {
      setBusy(false)
    }
  }

  return <section className="weekly-page daily-feed-page" aria-labelledby="daily-feed-title">
    <header className="weekly-header">
      <div>
        <p className="step-label">Közösségi rajzok</p>
        <h1 id="daily-feed-title">Hírfolyam</h1>
        <p>Naponta két saját 32×32-es képet tehetsz közzé.</p>
      </div>
      <button disabled={busy} onClick={onBack} type="button">Vissza a főmenübe</button>
    </header>

    <nav className="challenge-period-switch" aria-label="Galéria típusa">
      <button disabled={busy} onClick={onSelectWeekly} type="button">Heti galéria</button>
      <button disabled={busy} onClick={onSelectMonthly} type="button">Havi galéria</button>
      <button aria-pressed="true" type="button">Hírfolyam</button>
    </nav>

    {!loading && !user ? <section className="weekly-account-card">
      <div><p className="step-label">Saját kép</p><h2>Jelentkezz be a közzétételhez</h2><p>A képeket fiók nélkül is megnézheted. Megosztani, kedvelni és hozzászólni bejelentkezve lehet.</p></div>
    </section> : null}

    {user && account ? <section className={`feed-composer${editorOpen ? ' is-editor-open' : ''}`}>
      <div className="feed-composer-heading">
        <div>
          <p className="step-label">A mai képed</p>
          <h2>Ma {account.todayPostCount}/2 képet tettél közzé</h2>
          <p>{account.todayPostCount >= 2 ? 'A két napi hely betelt. Töröld az egyik saját képet, ha újat szeretnél feltölteni.' : `Még ${2 - account.todayPostCount} képet oszthatsz meg ma.`}</p>
        </div>
        <div className="feed-composer-actions">
          {editorOpen ? <button disabled={busy} onClick={() => setEditorOpen(false)} type="button">Rajzoló bezárása</button> : null}
          <button className="primary-button" disabled={busy || account.todayPostCount >= 2} onClick={startNewPost} type="button">Új kép rajzolása</button>
        </div>
      </div>
      <div className="profile-feed-stats">
        <span><strong>{account.receivedLikeCount}</strong> kapott kedvelés</span>
      </div>
      {editorOpen ? <div className="feed-composer-canvas">
        <PixelCanvas
          canDraw={!busy}
          chosenWord={null}
          drawingEndsAt={null}
          events={[]}
          localDrawing={{ initialPixels: pixelsRef.current, onChange: handleDrawingChange }}
          onError={error => setStatus(errorMessage(error))}
          onSubmit={publish}
          paletteSize={32}
          roundId={revision}
          serverNow=""
        />
        <label className="feed-description-field">
          <span>Képleírás <small>(nem kötelező)</small></span>
          <textarea
            maxLength={FEED_DESCRIPTION_MAX_LENGTH}
            onChange={event => handleDescriptionChange(event.target.value)}
            placeholder="Írj legfeljebb három rövid sort a képedről…"
            rows={FEED_DESCRIPTION_MAX_LINES}
            value={description}
          />
          <small>{description.length}/{FEED_DESCRIPTION_MAX_LENGTH} karakter · legfeljebb {FEED_DESCRIPTION_MAX_LINES} sor</small>
        </label>
        <button className="primary-button feed-publish-button" disabled={busy || !pixelsRef.current.some(pixel => pixel !== 'transparent')} onClick={() => void publish()} type="button">
          {busy ? 'Mentés…' : editingPostId ? 'Kép frissítése' : 'Közzététel'}
        </button>
      </div> : null}
    </section> : null}

    <section className="weekly-gallery" aria-labelledby="feed-gallery-title">
      <div className="weekly-section-heading">
        <div><p className="step-label">Legújabb rajzok</p><h2 id="feed-gallery-title">Hírfolyam</h2></div>
      </div>
      {posts.length ? <>
        <div className="weekly-gallery-grid">{posts.map(post => <article className="weekly-entry feed-entry" key={post.post_id}>
          <WeeklyArtwork label={`${post.author_name} hírfolyamképe`} pixels={post.pixels} />
          <div className="weekly-entry-meta">
            <ProfilePreviewButton className="weekly-entry-author" name={post.author_name} pixels={post.authorAvatar} receivedLikes={post.author_received_likes}>
              <ProfileAvatar label={`${post.author_name} profilképe`} pixels={post.authorAvatar} />
              <strong>{post.author_name}</strong>
            </ProfilePreviewButton>
            <span>{post.like_count} kedvelés</span>
          </div>
          <time className="feed-entry-date" dateTime={post.updated_at}>{dateLabel(post.updated_at)}</time>
          {post.description ? <p className="feed-entry-description">{post.description}</p> : null}
          <div className="feed-entry-actions">
            {post.is_own ? <>
              <button disabled={busy} onClick={() => startEditingPost(post)} type="button">Szerkesztés</button>
              <button className="feed-delete-button" disabled={busy} onClick={() => setDeleteTarget(post)} type="button">Törlés</button>
            </> : null}
            <button
              aria-label={post.is_own ? 'A saját képedet nem kedvelheted' : post.has_liked ? 'Kedvelés visszavonása' : 'Kép kedvelése'}
              aria-pressed={post.has_liked}
              className={`feed-like-button${post.has_liked ? ' is-liked' : ''}`}
              disabled={busy || !user || post.is_own}
              onClick={() => void handleLike(post)}
              title={post.is_own ? 'A saját képedet nem kedvelheted' : post.has_liked ? 'Kedvelés visszavonása' : 'Kedvelem'}
              type="button"
            >❤</button>
          </div>
          <GalleryComments artworkAuthor={post.author_name} busy={busy} comments={post.comments} isSignedIn={Boolean(user && account)} onSubmit={content => handleComment(post.post_id, content)} onUpdate={handleCommentUpdate} />
        </article>)}</div>
        <GalleryPagination currentPage={page} onPageChange={nextPage => void changePage(nextPage)} totalItems={totalCount} />
      </> : <p className="weekly-empty">Még nincs kép a hírfolyamban. Lehetsz te az első!</p>}
    </section>
    <p className="status-message weekly-message" aria-live="polite">{status}</p>
    {deleteTarget ? <ConfirmModal
      confirmLabel="Kép törlése"
      isBusy={busy}
      message="A kép a kedveléseivel és a kommentjeivel együtt végleg törlődik. Ha ez egy mai kép, a napi hely azonnal felszabadul."
      onCancel={() => setDeleteTarget(null)}
      onConfirm={() => {
        const target = deleteTarget
        setDeleteTarget(null)
        void handleDelete(target)
      }}
      title="Törlöd a saját képedet?"
    /> : null}
  </section>
}
