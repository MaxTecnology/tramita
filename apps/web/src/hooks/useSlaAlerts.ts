import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useSlaConfig } from '@/hooks/useSlaConfig'
import { computeSlaLevel } from '@/lib/sla'
import { playSound } from '@/lib/sla-sound'

interface SlaTask {
  id: string
  title: string
  targetDate: string | null
  dueDate: string | null
  status: string
}

interface SlaPreference {
  targetWarningSound: string
  targetWarningVolume: number
  dueCriticalSound: string
  dueCriticalVolume: number
}

export function useSlaAlerts(): { permissionNeeded: boolean; requestPermission: () => void } {
  const { user } = useAuth()
  const slaConfig = useSlaConfig()
  const [permissionNeeded, setPermissionNeeded] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'default',
  )
  const isOrgRole = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'].includes(user?.role ?? '')

  const { data: tasks = [] } = useQuery<SlaTask[]>({
    queryKey: ['sla-alert-tasks', user?.role],
    queryFn: () => api.get('/tasks', {
      params: {
        boardType: 'OS',
        openOnly: true,
        ...(user?.role === 'ORG_MEMBER' ? { assigneeId: user.id } : {}),
      },
    }).then((r) => r.data.items ?? r.data),
    enabled: isOrgRole,
    refetchInterval: 60_000,
  })

  const { data: preference } = useQuery<SlaPreference>({
    queryKey: ['sla-preference'],
    queryFn: () => api.get('/sla/preferences').then((r) => r.data),
    enabled: isOrgRole,
    staleTime: 5 * 60 * 1000,
  })

  const { data: customSound } = useQuery<{ url: string | null }>({
    queryKey: ['sla-custom-sound-url'],
    queryFn: () => api.get('/sla/custom-sound-url').then((r) => r.data),
    enabled: isOrgRole,
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (!isOrgRole || !preference) return

    for (const task of tasks) {
      const level = computeSlaLevel(
        task.targetDate ? new Date(task.targetDate) : null,
        task.dueDate ? new Date(task.dueDate) : null,
        new Date(),
        slaConfig,
      )
      if (level === 'NONE') continue

      const key = `sla:${task.id}:${level}`
      if (sessionStorage.getItem(key)) continue
      sessionStorage.setItem(key, '1')

      const isCritical = level === 'DUE_CRITICAL'
      const label = isCritical ? 'Prazo crítico' : 'Meta se aproximando'
      toast(label, { description: task.title })

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(label, { body: task.title })
      }

      const soundKey = isCritical ? preference.dueCriticalSound : preference.targetWarningSound
      const volume = isCritical ? preference.dueCriticalVolume : preference.targetWarningVolume
      void playSound(soundKey, volume, customSound?.url ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, preference, customSound, isOrgRole])

  function requestPermission() {
    if (typeof Notification === 'undefined') return
    Notification.requestPermission().then(() => setPermissionNeeded(false))
  }

  return { permissionNeeded, requestPermission }
}
