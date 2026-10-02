import { useEffect, useRef, useState } from 'react'

type MusicTrack = {
  artist: string
  src: string
  title: string
}
const musicTracks: MusicTrack[] = [
  {
    artist: 'Bëlga',
    src: '/audio/belga-maci.mp3',
    title: 'Maci',
  },
]

export function MusicPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackRequested, setPlaybackRequested] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const currentTrack = musicTracks[currentTrackIndex]

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    if (!playbackRequested) {
      audio.pause()
      return
    }

    void audio.play().catch(() => {
      setPlaybackRequested(false)
      setIsPlaying(false)
      setErrorMessage('A zenét most nem sikerült elindítani.')
    })
  }, [currentTrackIndex, playbackRequested])

  const selectTrack = (direction: -1 | 1) => {
    setErrorMessage('')
    setCurrentTrackIndex((current) =>
      (current + direction + musicTracks.length) % musicTracks.length,
    )
  }

  const togglePlayback = () => {
    setErrorMessage('')
    setPlaybackRequested((requested) => !requested)
  }

  return (
    <section className="music-player" aria-label="Zenelejátszó">
      <div className="music-player-copy">
        <span>Zene · {currentTrackIndex + 1}/{musicTracks.length}</span>
        <strong>{currentTrack.artist} – {currentTrack.title}</strong>
        {errorMessage ? <small role="status">{errorMessage}</small> : null}
      </div>
      <div className="music-player-controls">
        <button
          aria-label="Előző szám"
          disabled={musicTracks.length < 2}
          onClick={() => selectTrack(-1)}
          type="button"
        >
          ‹
        </button>
        <button
          aria-label={isPlaying ? 'Zene szüneteltetése' : 'Zene lejátszása'}
          className="music-player-toggle"
          onClick={togglePlayback}
          type="button"
        >
          {isPlaying ? 'Szünet' : 'Lejátszás'}
        </button>
        <button
          aria-label="Következő szám"
          disabled={musicTracks.length < 2}
          onClick={() => selectTrack(1)}
          type="button"
        >
          ›
        </button>
      </div>
      <audio
        key={currentTrack.src}
        loop={musicTracks.length === 1}
        onError={() => {
          setPlaybackRequested(false)
          setErrorMessage('A zenefájl nem tölthető be.')
        }}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        preload="metadata"
        ref={audioRef}
        src={currentTrack.src}
      />
    </section>
  )
}
