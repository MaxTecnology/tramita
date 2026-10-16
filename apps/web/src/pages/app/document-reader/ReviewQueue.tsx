import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ReceivedDocument } from '@/types'
import { toast } from 'sonner'

export default function ReviewQueue() {
  const queryClient = useQueryClient()
  const [trocandoId, setTrocandoId] = useState<string | null>(null)
  const [novaTaskId, setNovaTaskId] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: fila = [], isLoading } = useQuery<ReceivedDocument[]>({
    queryKey: ['document-reader-fila'],
    queryFn: () => api.get('/document-reader/fila').then((r) => r.data),
  })

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ['document-reader-fila'] })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post('/document-reader/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: () => { toast.success('Documento enviado pra leitura'); invalidar() },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Erro ao enviar documento'),
  })

  const confirmarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/document-reader/${id}/confirmar`),
    onSuccess: () => { toast.success('Documento anexado'); invalidar() },
    onError: () => toast.error('Erro ao confirmar'),
  })

  const trocarMutation = useMutation({
    mutationFn: ({ id, taskId }: { id: string; taskId: string }) => api.post(`/document-reader/${id}/trocar-tarefa`, { taskId }),
    onSuccess: () => { toast.success('Documento anexado na tarefa escolhida'); setTrocandoId(null); setNovaTaskId(''); invalidar() },
    onError: () => toast.error('Erro ao trocar tarefa'),
  })

  const rejeitarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/document-reader/${id}/rejeitar`),
    onSuccess: () => { toast.success('Documento rejeitado'); invalidar() },
    onError: () => toast.error('Erro ao rejeitar'),
  })

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Fila de revisão — documentos fiscais</h1>
        <Button onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
          Enviar PDF
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) uploadMutation.mutate(file)
            e.target.value = ''
          }}
        />
      </div>

      {fila.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum documento pendente.</p>
      ) : (
        <div className="space-y-2">
          {fila.map((doc) => (
            <div key={doc.id} className="rounded-lg border border-border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  {doc.status === 'NOT_IDENTIFIED' ? 'Não identificado' : 'Aguardando revisão'}
                </span>
                {doc.confidence !== null && (
                  <span className="text-xs text-muted-foreground">
                    Confiança: {Math.round(doc.confidence * 100)}%
                  </span>
                )}
              </div>

              {doc.extractedFields && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {Object.entries(doc.extractedFields).map(([campo, v]) => (
                    <p key={campo}>
                      {campo}: {String(v.valor ?? v.bruto)} {!v.valido && <span className="text-danger-text">(inválido)</span>}
                    </p>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                {doc.taskId && (
                  <Button size="sm" onClick={() => confirmarMutation.mutate(doc.id)} disabled={confirmarMutation.isPending}>
                    Confirmar anexo
                  </Button>
                )}
                {trocandoId === doc.id ? (
                  <div className="flex gap-2 items-center">
                    <Input
                      placeholder="ID da tarefa"
                      value={novaTaskId}
                      onChange={(e) => setNovaTaskId(e.target.value)}
                      className="h-8 w-48"
                    />
                    <Button size="sm" variant="outline" onClick={() => trocarMutation.mutate({ id: doc.id, taskId: novaTaskId })}>
                      Anexar nessa tarefa
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setTrocandoId(doc.id)}>
                    Trocar tarefa
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => rejeitarMutation.mutate(doc.id)}>
                  Rejeitar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
