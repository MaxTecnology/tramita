import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { mensagemDeErro } from '@/lib/utils'
import { registerProcessDelayReason } from '@/components/shared/task-documents/delayReason'

// A process that finished after its deadline with no reason recorded (closed by itself: robot,
// client approval): the office records why, like an OS finished late
export function ProcessDelayReason({ boardId, pending }: { boardId: string; pending: boolean }) {
  const qc = useQueryClient()
  const register = useMutation({
    mutationFn: () => registerProcessDelayReason(boardId),
    onSuccess: (done) => {
      if (!done) return
      toast.success('Motivo registrado')
      qc.invalidateQueries({ queryKey: ['board', boardId] })
      qc.invalidateQueries({ queryKey: ['boards'] })
    },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao registrar o motivo')),
  })
  if (!pending) return null
  return (
    <button type="button" onClick={() => register.mutate()} disabled={register.isPending}
      className="text-xs font-medium text-danger-text hover:underline flex-shrink-0">
      Processo concluído com atraso — registrar o motivo
    </button>
  )
}
