(function () {
  const SOUND_URL = 'assets/sounds/lingxistudio.wav'
  let audio = null
  let lastPlayedAt = 0
  const MIN_INTERVAL_MS = 1200

  function getAudio() {
    if (!audio) {
      audio = new Audio(SOUND_URL)
      audio.preload = 'auto'
      audio.volume = 0.72
    }
    return audio
  }

  function play() {
    const now = Date.now()
    if (now - lastPlayedAt < MIN_INTERVAL_MS) return
    lastPlayedAt = now
    const player = getAudio()
    try {
      player.pause()
      player.currentTime = 0
      const result = player.play()
      if (result && typeof result.catch === 'function') {
        result.catch(() => {})
      }
    } catch (error) {
      // Audio playback may be blocked before the renderer has user activation.
    }
  }

  function init() {
    if (!window.api?.onBackgroundReplySound) return
    window.api.onBackgroundReplySound(() => play())
  }

  window.BackgroundReplySound = {
    init,
    play
  }
})()
