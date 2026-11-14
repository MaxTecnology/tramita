import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import * as sound from '@/lib/sla-sound'
import { toast } from 'sonner'
import { alertNewNotification, setInboxSound, inboxSoundOn } from './inbox-alert'

const notice = { id: 'n1', title: 'Novo comentário do escritório', body: 'Falta o extrato', link: '/portal/send?task=t1' }

class FakeNotification {
  static permission: NotificationPermission = 'granted'
  static created: FakeNotification[] = []
  onclick: (() => void) | null = null
  constructor(public title: string, public options: NotificationOptions) { FakeNotification.created.push(this) }
  close() {}
}

let visible = true
beforeEach(() => {
  localStorage.clear()
  FakeNotification.created = []
  FakeNotification.permission = 'granted'
  vi.stubGlobal('Notification', FakeNotification)
  vi.spyOn(sound, 'playSound').mockResolvedValue(undefined)
  vi.spyOn(toast, 'info').mockReturnValue('t')
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => (visible ? 'visible' : 'hidden'))
  vi.spyOn(document, 'hasFocus').mockImplementation(() => visible)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('alerta de notificação nova', () => {
  it('on screen: rings and shows a toast, no browser notification', () => {
    visible = true
    alertNewNotification(notice, vi.fn())
    expect(sound.playSound).toHaveBeenCalledTimes(1)
    expect(toast.info).toHaveBeenCalledWith('Novo comentário do escritório', expect.objectContaining({ description: 'Falta o extrato' }))
    expect(FakeNotification.created).toHaveLength(0)
  })

  it('tab in the background: rings and shows a browser notification that opens the item', () => {
    visible = false
    const navigate = vi.fn()
    alertNewNotification(notice, navigate)
    expect(FakeNotification.created).toHaveLength(1)
    FakeNotification.created[0].onclick?.()
    expect(navigate).toHaveBeenCalledWith('/portal/send?task=t1')
  })

  it('the same notification rings once even with several tabs open', () => {
    alertNewNotification(notice, vi.fn())
    alertNewNotification(notice, vi.fn())
    expect(sound.playSound).toHaveBeenCalledTimes(1)
  })

  it('sound can be turned off (and stays off)', () => {
    visible = true
    setInboxSound(false)
    expect(inboxSoundOn()).toBe(false)
    alertNewNotification(notice, vi.fn())
    expect(sound.playSound).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalled()
  })
})
