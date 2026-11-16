import { api } from '@/lib/api'
import { askChoice } from '@/components/ui/app-dialogs'
import type { DelayReason } from '@/types'

export interface DelayFields {
  delayReasonId?: string
  delayNote?: string
  processDelayReasonId?: string
  processDelayNote?: string
}

const TASK_MISSING = 'Informe o motivo do atraso'
const PROCESS_MISSING = 'Informe o motivo do atraso do processo'

function apiMessage(err: unknown): string | null {
  const e = err as { response?: { status?: number; data?: { message?: string } } }
  return e?.response?.status === 422 ? e.response.data?.message ?? null : null
}

async function askReason(title: string, description: string, confirmLabel = 'Concluir'): Promise<{ id: string; note?: string } | null> {
  const reasons = (await api.get<DelayReason[]>('/delay-reasons')).data.filter((r) => r.isActive)
  const answer = await askChoice({
    title, description, label: 'Motivo', confirmLabel,
    choices: reasons.map((r) => ({ value: r.id, label: r.name, requiresNote: r.requiresNote })),
  })
  return answer ? { id: answer.value, note: answer.note } : null
}

// Finishing an OS after its deadline: the API answers 422 asking for the reason (of the OS, then of
// the process it closes). Asks for it and sends again; null when the person gives up.
export async function withDelayReason<T>(send: (extra: DelayFields) => Promise<T>): Promise<T | null> {
  const extra: DelayFields = {}
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await send({ ...extra })
    } catch (err) {
      const message = apiMessage(err)
      if (message === TASK_MISSING && !extra.delayReasonId) {
        const r = await askReason('Motivo do atraso', 'Esta OS passou do prazo interno (já descontada a espera pelo cliente). O motivo fica no histórico.')
        if (!r) return null
        extra.delayReasonId = r.id
        if (r.note) extra.delayNote = r.note
      } else if (message === PROCESS_MISSING && !extra.processDelayReasonId) {
        const r = await askReason('Motivo do atraso do processo', 'Esta é a última etapa e o processo passou do prazo.')
        if (!r) return null
        extra.processDelayReasonId = r.id
        if (r.note) extra.processDelayNote = r.note
      } else {
        throw err
      }
    }
  }
  return null
}

// Registers the reason of an OS (before finishing, or one finished late by itself)
export async function registerDelayReason(taskId: string): Promise<boolean> {
  const r = await askReason('Motivo do atraso', 'Fica no histórico da OS e nos indicadores de atraso.', 'Registrar')
  if (!r) return false
  await api.patch(`/tasks/${taskId}/delay-reason`, { delayReasonId: r.id, ...(r.note ? { delayNote: r.note } : {}) })
  return true
}
