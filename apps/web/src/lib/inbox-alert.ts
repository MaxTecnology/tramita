import { toast } from 'sonner'
import { playSound } from '@/lib/sla-sound'

export interface NewNotice { id: string; title: string; body: string; link: string }

const SOUND_KEY = 'inbox-sound'
const SEEN_PREFIX = 'inbox-alert:'

// Browser storage can be blocked (private mode): every access is guarded, and the alert still works
function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}

export function inboxSoundOn(): boolean {
  return read(SOUND_KEY) !== 'off'
}

export function setInboxSound(on: boolean): void {
  write(SOUND_KEY, on ? 'on' : 'off')
}

export function browserNoticePermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

export async function askBrowserNoticePermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.requestPermission()
}

// A new notice: one sound (once per notice, even with several tabs open), a toast when the person is
// looking at the app, a browser notification when the tab is in the background
export function alertNewNotification(notice: NewNotice, navigate: (link: string) => void): void {
  const seenKey = `${SEEN_PREFIX}${notice.id}`
  if (read(seenKey)) return
  write(seenKey, '1')

  if (inboxSoundOn()) void playSound('CHIME', 60, null)

  const onScreen = document.visibilityState === 'visible' && document.hasFocus()
  if (onScreen) {
    toast.info(notice.title, { description: notice.body || undefined, action: { label: 'Abrir', onClick: () => navigate(notice.link) } })
    return
  }
  if (browserNoticePermission() !== 'granted') return
  try {
    const n = new Notification(notice.title, { body: notice.body, tag: notice.id })
    n.onclick = () => {
      window.focus()
      navigate(notice.link)
      n.close()
    }
  } catch {
    // Some browsers (Chrome Android) only allow notifications through a service worker
  }
}
