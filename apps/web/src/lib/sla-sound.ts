const SOUND_FILES: Record<string, string> = {
  CHIME: '/sounds/chime.mp3',
  BELL: '/sounds/bell.mp3',
  SOFT_PING: '/sounds/soft-ping.mp3',
}

export async function playSound(soundKey: string, volume: number, orgCustomUrl: string | null) {
  if (soundKey === 'MUTE') return
  const src = soundKey === 'ORG_CUSTOM' ? orgCustomUrl : SOUND_FILES[soundKey]
  if (!src) return
  try {
    const audio = new Audio(src)
    audio.volume = Math.min(Math.max(volume, 0), 100) / 100
    await audio.play()
  } catch {
    // Autoplay bloqueado ou arquivo ausente — não deve quebrar o alerta visual/toast.
  }
}
