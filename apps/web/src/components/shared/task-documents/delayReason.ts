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

interface Reason { id: string; note?: string }
// Reasons chosen with "use for the next ones" during a batch (e.g. "Concluir prontas" of the robot)
export interface DelayMemory { task?: Reason; process?: Reason }

async function askReason(title: string, description: string, confirmLabel = 'Concluir', rememberLabel?: string): Promise<(Reason & { remember?: boolean }) | null> {
  const reasons = (await api.get<DelayReason[]>('/delay-reasons')).data.filter((r) => r.isActive)
  const answer = await askChoice({
    title, description, label: 'Motivo', confirmLabel, rememberLabel,
    choices: reasons.map((r) => ({ value: r.id, label: r.name, requiresNote: r.requiresNote })),
  })
  return answer ? { id: answer.value, note: answer.note, remember: answer.remember } : null
}

// Asks (or reuses the remembered one) and keeps it for the next ones when the person said so
async function reasonFor(kind: keyof DelayMemory, title: string, description: string, memory?: DelayMemory): Promise<Reason | null> {
  const remembered = memory?.[kind]
  if (remembered) return remembered
  const r = await askReason(title, description, 'Concluir', memory ? `Usar este motivo nas próximas ${kind === 'task' ? 'OS atrasadas' : 'processos atrasados'}` : undefined)
  if (!r) return null
  const reason: Reason = { id: r.id, ...(r.note ? { note: r.note } : {}) }
  if (memory && r.remember) memory[kind] = reason
  return reason
}

// Finishing an OS after its deadline: the API answers 422 asking for the reason (of the OS, then of
// the process it closes). Asks for it and sends again; null when the person gives up. With a shared
// `memory` (a batch), the dialog offers reusing the reason for the next ones.
export async function withDelayReason<T>(send: (extra: DelayFields) => Promise<T>, memory?: DelayMemory): Promise<T | null> {
  const extra: DelayFields = {}
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await send({ ...extra })
    } catch (err) {
      const message = apiMessage(err)
      if (message === TASK_MISSING && !extra.delayReasonId) {
        const r = await reasonFor('task', 'Motivo do atraso', 'Esta OS passou do prazo interno (já descontada a espera pelo cliente). O motivo fica no histórico.', memory)
        if (!r) return null
        extra.delayReasonId = r.id
        if (r.note) extra.delayNote = r.note
      } else if (message === PROCESS_MISSING && !extra.processDelayReasonId) {
        const r = await reasonFor('process', 'Motivo do atraso do processo', 'Esta é a última etapa e o processo passou do prazo.', memory)
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

// Registers the reason of a process that finished late by itself (its last OS closed automatically)
export async function registerProcessDelayReason(boardId: string): Promise<boolean> {
  const r = await askReason('Motivo do atraso do processo', 'O processo terminou depois do prazo. O motivo fica no histórico e nos indicadores de atraso.', 'Registrar')
  if (!r) return false
  await api.patch(`/boards/${boardId}/delay-reason`, { delayReasonId: r.id, ...(r.note ? { delayNote: r.note } : {}) })
  return true
}
