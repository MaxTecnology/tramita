import { useQueryClient } from '@tanstack/react-query'
import { useEventStream } from './useEventStream'

export function useRequestsBadgeStream(): void {
  const queryClient = useQueryClient()
  useEventStream('/requests/stream', {
    'request:changed': () => {
      queryClient.invalidateQueries({ queryKey: ['requests-pending-count'] })
      // Cobre aprovar/rejeitar/cancelar e o auto-revert de NEEDS_INFO quando o cliente
      // responde — sem isso a lista de Solicitações (e qualquer painel de comentários aberto)
      // só atualiza no próximo refetch espontâneo, não quando o evento realmente acontece.
      // O evento não carrega o id da request afetada, então 'request-comments' sem id
      // invalida por prefixo — qualquer painel de comentários aberto, de qualquer request.
      queryClient.invalidateQueries({ queryKey: ['requests'] })
      queryClient.invalidateQueries({ queryKey: ['request-comments'] })
    },
  })
}
