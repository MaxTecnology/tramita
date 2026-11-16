import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import { toast } from 'sonner'
import { askConfirm } from '@/components/ui/app-dialogs'
import type { DeliveryCheck } from '@/types'

export type RobotCheckOutcome = { proceed: false } | { proceed: true; acceptWarnings: boolean; read: DeliveryCheck['read'] }

// The robot reads a file before it goes into a delivery (new or replacing the sent one): another
// client's document is blocked; divergences ask "Entregar mesmo assim" (the API keeps them in the history).
export async function robotCheckFile(taskId: string, deliverableId: string, file: File): Promise<RobotCheckOutcome> {
  const form = new FormData()
  form.append('file', file)
  let check: DeliveryCheck
  try {
    check = (await api.post(`/tasks/${taskId}/documents/deliveries/${deliverableId}/check`, form)).data as DeliveryCheck
  } catch (err) {
    toast.error(mensagemDeErro(err, 'O robô não conseguiu conferir o arquivo'))
    return { proceed: false }
  }
  if (check.blocked) {
    await askConfirm({ title: 'O robô bloqueou esta entrega', description: check.blocked, confirmLabel: 'Entendi', cancelLabel: 'Fechar' })
    return { proceed: false }
  }
  if (check.warnings.length > 0) {
    const ok = await askConfirm({
      title: `O robô encontrou divergências em ${file.name}`,
      description: `${check.warnings.join(' • ')}. Se entregar, isso fica registrado no histórico.`,
      confirmLabel: 'Entregar mesmo assim', cancelLabel: 'Escolher outro arquivo', danger: true,
    })
    if (!ok) return { proceed: false }
    return { proceed: true, acceptWarnings: true, read: check.read }
  }
  return { proceed: true, acceptWarnings: false, read: check.read }
}
