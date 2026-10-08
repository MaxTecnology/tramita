import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { playSound } from './sla-sound'

describe('playSound', () => {
  let playSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })

  afterEach(() => {
    playSpy.mockRestore()
  })

  it('não toca nada quando o som é MUTE', async () => {
    await playSound('MUTE', 50, null)
    expect(playSpy).not.toHaveBeenCalled()
  })

  it('cai pro som padrão quando ORG_CUSTOM está selecionado mas a org não tem som configurado', async () => {
    await playSound('ORG_CUSTOM', 50, null, 'BELL')
    expect(playSpy).toHaveBeenCalledTimes(1)
  })

  it('não toca nada quando ORG_CUSTOM não tem URL e não foi passado fallback', async () => {
    await playSound('ORG_CUSTOM', 50, null)
    expect(playSpy).not.toHaveBeenCalled()
  })

  it('toca a URL customizada da org quando ela existe', async () => {
    await playSound('ORG_CUSTOM', 50, 'https://signed.example/sound.mp3', 'BELL')
    expect(playSpy).toHaveBeenCalledTimes(1)
  })
})
