const SOUND_FILES: Record<string, string> = {
  CHIME: '/sounds/chime.mp3',
  BELL: '/sounds/bell.mp3',
  SOFT_PING: '/sounds/soft-ping.mp3',
}

// fallbackSoundKey é usado quando soundKey === 'ORG_CUSTOM' mas a organização removeu o som
// customizado depois do usuário já ter salvo essa preferência — cai pro som padrão do nível
// (BELL/SOFT_PING) em vez de ficar silenciosamente mudo sem o usuário entender por quê.
export async function playSound(
  soundKey: string,
  volume: number,
  orgCustomUrl: string | null,
  fallbackSoundKey?: string,
) {
  if (soundKey === 'MUTE') return
  const effectiveKey = soundKey === 'ORG_CUSTOM' && !orgCustomUrl ? fallbackSoundKey : soundKey
  if (!effectiveKey || effectiveKey === 'MUTE') return
  const src = effectiveKey === 'ORG_CUSTOM' ? orgCustomUrl : SOUND_FILES[effectiveKey]
  if (!src) return
  try {
    const audio = new Audio(src)
    audio.volume = Math.min(Math.max(volume, 0), 100) / 100
    await audio.play()
  } catch {
    // Autoplay bloqueado ou arquivo ausente — não deve quebrar o alerta visual/toast.
  }
}
