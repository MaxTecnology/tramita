import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ReceivedDocument, RejectedDocument } from '@/types'
import { toast } from 'sonner'
import { mensagemDeErro } from '@/lib/utils'
import { toApiAmount, toInputAmount } from '@/lib/money'
import { ScopeFilter, useScopeFilter, scopeParams } from '@/components/shared/ScopeFilter'
import { useMyScope } from '@/hooks/useMyScope'

function AbaRejeitados() {
  const queryClient = useQueryClient()

  const { data: rejeitados = [], isLoading } = useQuery<RejectedDocument[]>({
    queryKey: ['document-reader-rejeitados'],
    queryFn: () => api.get('/document-reader/rejeitados').then((r) => r.data),
  })

  const reabrirMutation = useMutation({
    mutationFn: (id: string) => api.post(`/document-reader/${id}/reabrir`),
    onSuccess: () => {
      toast.success('Documento reaberto — voltou pra fila de revisão')
      queryClient.invalidateQueries({ queryKey: ['document-reader-rejeitados'] })
      queryClient.invalidateQueries({ queryKey: ['document-reader-fila'] })
    },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao reabrir')),
  })

  if (isLoading) return <div className="text-sm text-muted-foreground">Carregando...</div>
  if (rejeitados.length === 0) return <p className="text-sm text-muted-foreground">Nenhum documento rejeitado.</p>

  return (
    <div className="space-y-2">
      {rejeitados.map((doc) => (
        <div key={doc.id} className="rounded-lg border border-border p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground block truncate">{doc.filename}</span>
            <span className="text-xs text-muted-foreground">
              {doc.reviewedBy ? `Rejeitado por ${doc.reviewedBy.name}` : 'Rejeitado'}
              {doc.reviewedAt && ` em ${new Date(doc.reviewedAt).toLocaleString('pt-BR')}`}
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={() => reabrirMutation.mutate(doc.id)} disabled={reabrirMutation.isPending}>
            Reabrir
          </Button>
        </div>
      ))}
    </div>
  )
}

interface ClientOption {
  id: string
  name: string
  codigo?: string | null
}

interface TaskOption {
  id: string
  title: string
}

function SeletorDeTarefa({ onEscolher, onCancelar }: { onEscolher: (taskId: string) => void; onCancelar: () => void }) {
  const [clientId, setClientId] = useState('')

  const { data: clients = [] } = useQuery<ClientOption[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
  })

  const { data: tasksPage } = useQuery<{ items: TaskOption[] }>({
    queryKey: ['tasks', { clientId, openOnly: true }],
    queryFn: () => api.get('/tasks', { params: { clientId, openOnly: true } }).then((r) => r.data),
    enabled: !!clientId,
  })
  const tasks = tasksPage?.items ?? []

  return (
    <div className="flex gap-2 items-center flex-wrap">
      <select
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        className="h-8 rounded-md border border-border bg-surface text-foreground px-2 text-xs"
      >
        <option value="">Escolher cliente...</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select
        disabled={!clientId}
        defaultValue=""
        onChange={(e) => { if (e.target.value) onEscolher(e.target.value) }}
        className="h-8 rounded-md border border-border bg-surface text-foreground px-2 text-xs disabled:opacity-50"
      >
        <option value="" disabled>{clientId ? (tasks.length ? 'Escolher tarefa...' : 'Sem tarefa aberta') : 'Escolha o cliente primeiro'}</option>
        {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>
      <Button size="sm" variant="ghost" onClick={onCancelar}>Cancelar</Button>
    </div>
  )
}

type Campo = { bruto: string; valor: string | number | null; valido: boolean }

export interface AnexarOpcoes {
  deliverableId?: string
  amount?: string
  paymentDueDate?: string
}

// Which pending delivery of the task the document fills, plus amount/due date when it is a payment
// guide (pre-filled with what the robot read). Returns null while the form is incomplete.
function OpcoesDeEntrega({ entregas, campos, onChange }: {
  entregas: { id: string; name: string; requiresPayment: boolean }[]
  campos: Record<string, unknown>
  onChange: (opcoes: AnexarOpcoes | null) => void
}) {
  const valorLido = campos.valor as Campo | undefined
  const vencLido = campos.vencimento as Campo | undefined
  const [deliverableId, setDeliverableId] = useState(entregas.length === 1 ? entregas[0].id : '')
  const [valor, setValor] = useState(valorLido?.valido && typeof valorLido.valor === 'number' ? toInputAmount(valorLido.valor.toFixed(2)) : '')
  const [vencimento, setVencimento] = useState(vencLido?.valido && typeof vencLido.valor === 'string' ? vencLido.valor : '')
  const entrega = entregas.find((e) => e.id === deliverableId)
  // Parent passes a new callback every render; a ref keeps the effect from looping
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const emit = onChangeRef.current
    if (!entrega) return emit(null)
    if (!entrega.requiresPayment) return emit({ deliverableId: entrega.id })
    try {
      emit({ deliverableId: entrega.id, amount: toApiAmount(valor), paymentDueDate: vencimento || undefined })
    } catch {
      emit(null)
    }
  }, [entrega, valor, vencimento])

  return (
    <div className="flex flex-wrap items-end gap-2 text-xs">
      {entregas.length > 1 && (
        <label className="flex flex-col gap-1 text-muted-foreground">
          Preenche a entrega
          <select
            value={deliverableId}
            onChange={(e) => setDeliverableId(e.target.value)}
            className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
          >
            <option value="">Escolha…</option>
            {entregas.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
      )}
      {entrega?.requiresPayment && (
        <>
          <label className="flex flex-col gap-1 text-muted-foreground">
            Valor da guia (R$)
            <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="1.234,56" className="h-8 w-32" inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1 text-muted-foreground">
            Vencimento
            <Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="h-8 w-40" />
          </label>
        </>
      )}
    </div>
  )
}

export default function ReviewQueue() {
  const queryClient = useQueryClient()
  const [trocandoId, setTrocandoId] = useState<string | null>(null)
  // Per document: delivery choice + payment data (null = incomplete, blocks "Confirmar anexo")
  const [opcoesPorDoc, setOpcoesPorDoc] = useState<Record<string, AnexarOpcoes | null>>({})
  const [aba, setAba] = useState<'fila' | 'rejeitados'>('fila')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const me = useMyScope()
  const [scopeFilter, setScopeFilter] = useScopeFilter('documents', me)
  // Upload feeds the triage of unidentified documents: admins and managers
  const canUpload = !!me && me.role !== 'ORG_MEMBER'

  const { data: fila = [], isLoading } = useQuery<ReceivedDocument[]>({
    queryKey: ['document-reader-fila', scopeFilter],
    queryFn: () => api.get('/document-reader/fila', { params: scopeParams(scopeFilter) }).then((r) => r.data),
  })

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ['document-reader-fila'] })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post('/document-reader/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: () => { toast.success('Documento enviado pra leitura'); invalidar() },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao enviar documento')),
  })

  const confirmarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/document-reader/${id}/confirmar`, opcoesPorDoc[id] ?? {}),
    onSuccess: () => { toast.success('Documento anexado'); invalidar() },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao confirmar')),
  })

  const trocarMutation = useMutation({
    mutationFn: ({ id, taskId }: { id: string; taskId: string }) => api.post(`/document-reader/${id}/trocar-tarefa`, { taskId }),
    // Choosing another task: its deliveries are picked by the API (single pending one) or refused
    // with a clear message; amount comes from the robot reading.
    onSuccess: () => { toast.success('Documento anexado na tarefa escolhida'); setTrocandoId(null); invalidar() },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao trocar tarefa')),
  })

  const rejeitarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/document-reader/${id}/rejeitar`),
    onSuccess: () => { toast.success('Documento rejeitado'); invalidar() },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao rejeitar')),
  })

  async function abrirPdf(id: string) {
    try {
      const { data } = await api.get<{ url: string }>(`/document-reader/${id}/visualizar`)
      window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch {
      toast.error('Erro ao abrir o PDF')
    }
  }

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Fila de revisão — leitura de documentos</h1>
        {canUpload && (
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
            Enviar PDF
          </Button>
        )}
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

      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setAba('fila')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${aba === 'fila' ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground'}`}
        >
          Fila de revisão
        </button>
        <button
          onClick={() => setAba('rejeitados')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${aba === 'rejeitados' ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground'}`}
        >
          Rejeitados
        </button>
      </div>

      {aba === 'fila' && me && <ScopeFilter me={me} value={scopeFilter} onChange={setScopeFilter} />}

      {aba === 'rejeitados' ? <AbaRejeitados /> : fila.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum documento pendente.</p>
      ) : (
        <div className="space-y-2">
          {fila.map((doc) => {
            const campos = Object.entries(doc.extractedFields ?? {}).filter(([campo]) => !campo.startsWith('_'))
            const erro = doc.extractedFields?._erro
            const motivo = doc.extractedFields?._motivo
            const duplicataDe = doc.extractedFields?._possivelDuplicataDe
            const aindaProcessando = doc.status === 'PENDING' && doc.confidence === null

            return (
              <div key={doc.id} className="rounded-lg border border-border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-foreground block truncate">{doc.filename}</span>
                    <span className="text-xs text-muted-foreground">
                      {aindaProcessando
                        ? 'Processando...'
                        : doc.status === 'NOT_IDENTIFIED' ? 'Não identificado' : 'Aguardando revisão'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {doc.confidence !== null && (
                      <span className="text-xs text-muted-foreground">
                        Confiança: {Math.round(doc.confidence * 100)}%
                      </span>
                    )}
                    <Button size="sm" variant="outline" onClick={() => abrirPdf(doc.id)}>
                      Ver PDF
                    </Button>
                  </div>
                </div>

                {doc.task && (
                  <p className="text-xs text-foreground">
                    Sugestão: <span className="font-medium">{doc.task.client.name}</span> — {doc.task.title}
                  </p>
                )}

                {typeof motivo === 'string' && (
                  <p className="text-xs text-muted-foreground">{motivo}</p>
                )}

                {typeof erro === 'string' && (
                  <p className="text-xs text-danger-text">Erro ao processar: {erro}</p>
                )}

                {typeof duplicataDe === 'string' && (
                  <p className="text-xs text-warning-text">
                    Possível duplicata de outro documento já enviado (id: {duplicataDe}).
                  </p>
                )}

                {campos.length > 0 && (
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {campos.map(([campo, v]) => {
                      const field = v as { bruto: string; valor: string | number | null; valido: boolean }
                      return (
                        <p key={campo}>
                          {campo}: {String(field.valor ?? field.bruto)} {!field.valido && <span className="text-danger-text">(inválido)</span>}
                        </p>
                      )
                    })}
                  </div>
                )}

                {doc.task && doc.task.pendingDeliverables.length > 0 && (
                  <OpcoesDeEntrega
                    entregas={doc.task.pendingDeliverables}
                    campos={doc.extractedFields ?? {}}
                    onChange={(opcoes) => setOpcoesPorDoc((prev) => ({ ...prev, [doc.id]: opcoes }))}
                  />
                )}

                <div className="flex gap-2">
                  {doc.taskId && (
                    <Button
                      size="sm"
                      onClick={() => confirmarMutation.mutate(doc.id)}
                      disabled={confirmarMutation.isPending || (!!doc.task?.pendingDeliverables.length && !opcoesPorDoc[doc.id])}
                    >
                      Confirmar anexo
                    </Button>
                  )}
                  {trocandoId === doc.id ? (
                    <SeletorDeTarefa
                      onEscolher={(taskId) => trocarMutation.mutate({ id: doc.id, taskId })}
                      onCancelar={() => setTrocandoId(null)}
                    />
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
            )
          })}
        </div>
      )}
    </div>
  )
}
