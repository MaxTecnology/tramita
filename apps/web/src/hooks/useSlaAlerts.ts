import { useEffect, useRef, useState } from 'react'
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

const TICK_INTERVAL_MS = 60_000
const FALLBACK_SOUND: Record<'TARGET_WARNING' | 'DUE_CRITICAL', string> = {
  TARGET_WARNING: 'SOFT_PING',
  DUE_CRITICAL: 'BELL',
}

// Sempre filtra pelo usuário logado — inclusive ORG_ADMIN/ORG_MANAGER. Sem isso, um admin com
// muitas OS atrasadas na org toda recebe um toast/som por tarefa de qualquer colaborador assim
// que abre o app. Tarefas sem responsável ainda aparecem pro admin/manager via o resumo diário
// (que já cai pro fallback de admins) — o alerta em tempo real fica consistente "assignee
// primeiro", igual ao digest.
export function buildSlaTasksParams(userId: string): { boardType: 'OS'; openOnly: true; assigneeId: string } {
  return { boardType: 'OS', openOnly: true, assigneeId: userId }
}

export function useSlaAlerts(): { permissionNeeded: boolean; requestPermission: () => void } {
  const { user } = useAuth()
  const slaConfig = useSlaConfig()
  const [permissionNeeded, setPermissionNeeded] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'default',
  )
  const [tick, setTick] = useState(0)
  const isOrgRole = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'].includes(user?.role ?? '')

  // O nível de alerta é derivado da passagem do tempo, não de uma mutação de dados — sem esse
  // tick, uma task que cruza o threshold enquanto a aba já está aberta (dados em cache
  // inalterados) nunca dispara o alerta até algo mais forçar um re-render.
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), TICK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  const { data: tasks = [] } = useQuery<SlaTask[]>({
    queryKey: ['sla-alert-tasks', user?.id],
    queryFn: () => api.get('/tasks', { params: buildSlaTasksParams(user!.id) }).then((r) => r.data.items ?? r.data),
    enabled: isOrgRole,
    refetchInterval: TICK_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })

  const { data: preference } = useQuery<SlaPreference>({
    queryKey: ['sla-preference'],
    queryFn: () => api.get('/sla/preferences').then((r) => r.data),
    enabled: isOrgRole,
    staleTime: 5 * 60 * 1000,
  })

  const seenRef = useRef<Set<string>>(new Set())

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
      if (seenRef.current.has(key)) continue
      // localStorage (não sessionStorage) — "uma vez por nível" vale pro dispositivo, não só pra
      // aba atual; abrir uma segunda aba não deve repetir o alerta que já disparou na primeira.
      if (localStorage.getItem(key)) {
        seenRef.current.add(key)
        continue
      }
      localStorage.setItem(key, '1')
      seenRef.current.add(key)

      const isCritical = level === 'DUE_CRITICAL'
      const label = isCritical ? 'Prazo crítico' : 'Meta se aproximando'
      toast(label, { description: task.title })

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification(label, { body: task.title })
        } catch {
          // Alguns navegadores (ex: Chrome Android) não suportam o construtor direto e exigem
          // ServiceWorkerRegistration.showNotification — degrada pro toast/som, que já disparou.
        }
      }

      const soundKey = isCritical ? preference.dueCriticalSound : preference.targetWarningSound
      const volume = isCritical ? preference.dueCriticalVolume : preference.targetWarningVolume
      const fallback = FALLBACK_SOUND[level]

      if (soundKey === 'ORG_CUSTOM') {
        // Busca a URL assinada só na hora de tocar (ela expira em 1h) — nunca fica em cache
        // esperando, que é justamente o caso de uso de uma aba aberta por muito tempo.
        api.get<{ url: string | null }>('/sla/custom-sound-url')
          .then((r) => void playSound(soundKey, volume, r.data.url, fallback))
          .catch(() => void playSound(soundKey, volume, null, fallback))
      } else {
        void playSound(soundKey, volume, null, fallback)
      }
    }
  }, [tasks, preference, isOrgRole, slaConfig, tick])

  function requestPermission() {
    if (typeof Notification === 'undefined') return
    Notification.requestPermission().then(() => setPermissionNeeded(false))
  }

  return { permissionNeeded, requestPermission }
}
