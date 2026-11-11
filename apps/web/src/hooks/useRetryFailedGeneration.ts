import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import type { BulkGenerationResult, FailedGeneration, RecurringTaskAssignment } from '@/types'

// "Gerar novamente" de uma falha de geração recorrente — usado no console de geração e no alerta
// do Dashboard. Busca o vínculo do cliente no template sob demanda (as telas cruzam vários templates).
export function useRetryFailedGeneration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (failure: FailedGeneration) => {
      const assignments = await api.get<RecurringTaskAssignment[]>(`/recurring-templates/${failure.templateId}/assignments`).then((r) => r.data)
      const assignmentIds = assignments.filter((a) => a.clientId === failure.clientId).map((a) => a.id)
      return api.post<BulkGenerationResult>(`/recurring-templates/${failure.templateId}/assignments/bulk-generate`, {
        dueMonth: failure.dueMonth,
        assignmentIds,
      }).then((r) => r.data)
    },
    onSuccess: (result) => {
      if (result.failed.length > 0) {
        toast.error(`Ainda falhou: ${result.failed[0]?.errorMessage ?? 'motivo desconhecido'}`)
      } else if (result.generated > 0 || result.alreadyExists > 0) {
        toast.success('Tentativa de nova geração enviada')
      } else {
        toast.error('Nenhum vínculo encontrado pra essa falha — verifique se o cliente ainda está vinculado')
      }
      qc.invalidateQueries({ queryKey: ['recurring-failed-generations'] })
    },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao tentar gerar novamente')),
  })
}
