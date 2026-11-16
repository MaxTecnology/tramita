import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { withDelayReason, type DelayMemory } from '@/components/shared/task-documents/delayReason'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ReceivedDocument, RejectedDocument } from '@/types'
import { toast } from 'sonner'
import { cn, mensagemDeErro } from '@/lib/utils'
import { askConfirm } from '@/components/ui/app-dialogs'
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

type Completion = 'AUTO_COMPLETED' | 'READY' | 'PENDING'
interface BulkResult {
  results: { id: string; ok: boolean; error?: string; taskId?: string; completion?: Completion }[]
  summary: { delivered: number; completed: number; readyTaskIds: string[]; failed: number }
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', ok ? 'bg-success-bg text-success-text' : 'bg-warning-bg text-warning-text')}>
      {`${ok ? '✓' : '⚠'} ${label}`}
    </span>
  )
}

const fmtCompetence = (c: string | null | undefined) => (c ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : '')
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// Competence chip: when it does not match, the month read in the document goes next to the task's
function competenceLabel(ok: boolean, taskCompetence: string | null, fields: Record<string, unknown> | null): string {
  const task = taskCompetence ? fmtCompetence(taskCompetence) : null
  if (ok || !task) return `Competência${task ? ` ${task}` : ''}`
  const read = ['competencia', 'pa']
    .map((k) => (fields?.[k] as { valor?: unknown } | undefined)?.valor)
    .find((v): v is string => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v))
  return read ? `Competência ${fmtCompetence(read)} — tarefa ${task}` : `Competência não lida — tarefa ${task}`
}

export default function ReviewQueue() {
  const queryClient = useQueryClient()
  const [trocandoId, setTrocandoId] = useState<string | null>(null)
  // Per document: delivery choice + payment data (null = incomplete) for the ones with pending items
  const [opcoesPorDoc, setOpcoesPorDoc] = useState<Record<string, AnexarOpcoes | null>>({})
  const [ajustandoId, setAjustandoId] = useState<string | null>(null)
  const [aba, setAba] = useState<'fila' | 'rejeitados'>('fila')
  const [resultado, setResultado] = useState<BulkResult | null>(null)
  const [falhasConclusao, setFalhasConclusao] = useState<string | null>(null)
  const [pdf, setPdf] = useState<{ url: string; name: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const me = useMyScope()
  const [scopeFilter, setScopeFilter] = useScopeFilter('documents', me)
  // Upload feeds the triage of unidentified documents: admins and managers
  const canUpload = !!me && me.role !== 'ORG_MEMBER'

  const { data: fila = [], isLoading } = useQuery<ReceivedDocument[]>({
    queryKey: ['document-reader-fila', scopeFilter],
    queryFn: () => api.get('/document-reader/fila', { params: scopeParams(scopeFilter) }).then((r) => r.data),
    // Switching the scope (or the user scope arriving) keeps the list on screen while it reloads
    placeholderData: keepPreviousData,
  })
  const prontos = fila.filter((d) => d.ready)
  const nomeDoArquivo = (id: string) => fila.find((d) => d.id === id)?.filename ?? id

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['document-reader-fila'] })
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post('/document-reader/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: () => { toast.success('Documento enviado pra leitura'); invalidar() },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao enviar documento')),
  })

  const concluirMutation = useMutation({
    // One by one: a late OS asks its own reason (the API says when); giving up skips that task
    mutationFn: async (taskIds: string[]) => {
      let done = 0
      const failures: string[] = []
      // Several late OS in the batch: the reason can be chosen once for all of them
      const memory: DelayMemory | undefined = taskIds.length > 1 ? {} : undefined
      for (const id of taskIds) {
        // One task refused (pending approval, waiting for another OS...) never stops the others
        try {
          const result = await withDelayReason((extra) => api.patch(`/tasks/${id}`, { status: 'DONE', ...extra }), memory)
          if (result !== null) done++
        } catch (err) {
          failures.push(mensagemDeErro(err, 'Erro ao concluir'))
        }
      }
      return { done, failures }
    },
    onSuccess: ({ done, failures }) => {
      if (done > 0) toast.success(done === 1 ? 'Tarefa concluída' : `${done} tarefas concluídas`)
      setFalhasConclusao(failures.length > 0
        ? `${plural(failures.length, 'tarefa não foi concluída', 'tarefas não foram concluídas')}: ${[...new Set(failures)].join('; ')}`
        : null)
      setResultado((r) => (r ? { ...r, summary: { ...r.summary, readyTaskIds: [] } } : r))
      invalidar()
    },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao concluir')),
  })

  // One document: same completion rule as a manual delivery
  const confirmarMutation = useMutation({
    mutationFn: (id: string) => api.post<{ taskId: string; completion?: Completion }>(`/document-reader/${id}/confirmar`, opcoesPorDoc[id] ?? {}).then((r) => r.data),
    onSuccess: async (r) => {
      setAjustandoId(null)
      invalidar()
      if (r.completion === 'AUTO_COMPLETED') return void toast.success('Entregue — tarefa concluída automaticamente')
      toast.success('Documento entregue ao cliente')
      if (r.completion === 'READY' && await askConfirm({
        title: 'Tudo entregue. Concluir a tarefa agora?', description: 'Os documentos do cliente estão resolvidos e todas as entregas foram feitas.',
        confirmLabel: 'Concluir', cancelLabel: 'Agora não',
      })) concluirMutation.mutate([r.taskId])
    },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao confirmar')),
  })

  const loteMutation = useMutation({
    mutationFn: (ids: string[]) => api.post<BulkResult>('/document-reader/confirmar-lote', { ids }).then((r) => r.data),
    onSuccess: (r) => { setResultado(r); setFalhasConclusao(null); invalidar() },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao confirmar em lote')),
  })

  const trocarMutation = useMutation({
    mutationFn: ({ id, taskId }: { id: string; taskId: string }) => api.post(`/document-reader/${id}/trocar-tarefa`, { taskId }),
    // Choosing another task: its deliveries are picked by the API (single pending one) or refused
    // with a clear message; amount comes from the robot reading.
    onSuccess: () => { toast.success('Documento entregue na tarefa escolhida'); setTrocandoId(null); invalidar() },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao trocar tarefa')),
  })

  const rejeitarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/document-reader/${id}/rejeitar`),
    onSuccess: () => { toast.success('Documento recusado'); invalidar() },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao recusar')),
  })

  async function abrirPdf(id: string, name: string) {
    try {
      const { data } = await api.get<{ url: string }>(`/document-reader/${id}/visualizar`)
      // The side panel only exists from lg up (1024px); below that the PDF opens in a new tab
      if (window.matchMedia?.('(min-width: 1024px)').matches) setPdf({ url: data.url, name })
      else window.open(data.url, '_blank', 'noopener')
    } catch {
      toast.error('Erro ao abrir o PDF')
    }
  }

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 p-4 md:p-6 space-y-4 overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Leitura de documentos</h1>
            <p className="text-xs text-muted-foreground">O robô lê e confere; você confirma antes de chegar ao cliente.</p>
          </div>
          {canUpload && (
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>Enviar PDF</Button>
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

        <div role="tablist" className="flex gap-2 border-b border-border">
          {(['fila', 'rejeitados'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={aba === t}
              onClick={() => setAba(t)}
              className={cn('px-3 py-2 text-sm font-medium border-b-2 -mb-px', aba === t ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground')}
            >
              {t === 'fila' ? `Para conferir (${fila.length})` : 'Recusados'}
            </button>
          ))}
        </div>

        {aba === 'rejeitados' ? <AbaRejeitados /> : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {me && <ScopeFilter me={me} value={scopeFilter} onChange={setScopeFilter} />}
              {prontos.length > 0 && (
                <Button onClick={() => loteMutation.mutate(prontos.map((d) => d.id))} disabled={loteMutation.isPending}>
                  {loteMutation.isPending ? 'Entregando...' : (prontos.length === 1 ? 'Confirmar 1 sem pendência' : `Confirmar os ${prontos.length} sem pendência`)}
                </Button>
              )}
            </div>

            {resultado && (
              <div className="rounded-lg border border-border bg-surface p-4 space-y-2" role="status">
                <p className="text-sm text-foreground">
                  <span className="font-semibold">{plural(resultado.summary.delivered, 'entregue', 'entregues')}</span>
                  {resultado.summary.completed > 0 && ` · ${plural(resultado.summary.completed, 'tarefa concluída', 'tarefas concluídas')}`}
                  {resultado.summary.readyTaskIds.length > 0 && ` · ${plural(resultado.summary.readyTaskIds.length, 'pronta para concluir', 'prontas para concluir')}`}
                  {resultado.summary.failed > 0 && <span className="text-danger-text"> · {plural(resultado.summary.failed, 'com erro', 'com erro')}</span>}
                </p>
                {falhasConclusao && <p className="text-xs text-danger-text">{falhasConclusao}</p>}
                {resultado.results.filter((r) => !r.ok).map((r) => (
                  <p key={r.id} className="text-xs text-danger-text">{nomeDoArquivo(r.id)}: {r.error}</p>
                ))}
                <div className="flex gap-2">
                  {resultado.summary.readyTaskIds.length > 0 && (
                    <Button size="sm" onClick={() => concluirMutation.mutate(resultado.summary.readyTaskIds)} disabled={concluirMutation.isPending}>
                      {`Concluir ${plural(resultado.summary.readyTaskIds.length, 'tarefa pronta', 'tarefas prontas')}`}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setResultado(null)}>Fechar</Button>
                </div>
              </div>
            )}

            {fila.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum documento para conferir.</p>
            ) : (
              <div className="space-y-2">
                {fila.map((doc) => {
                  const campos = Object.entries(doc.extractedFields ?? {}).filter(([campo]) => !campo.startsWith('_'))
                  const erro = doc.extractedFields?._erro
                  const motivo = doc.extractedFields?._motivo
                  const duplicataDe = doc.extractedFields?._possivelDuplicataDe
                  const aindaProcessando = doc.status === 'PENDING' && doc.confidence === null
                  const s = doc.suggestion
                  const ajustando = ajustandoId === doc.id

                  return (
                    <div key={doc.id} className={cn('rounded-lg border bg-surface p-4 space-y-2', doc.ready ? 'border-success-text/40' : 'border-border')}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">📄 {doc.filename}</p>
                          {s ? (
                            <p className="text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">{s.clientName}</span>
                              {' · '}<span className="font-medium text-info-text">{s.obligationName ?? 'Documento'} → {s.deliverableName}</span>
                              {' · '}{s.taskTitle}{s.competence && ` ${fmtCompetence(s.competence)}`}
                              {s.osModelName && (
                                <span className="ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-info-bg text-info-text">{s.processTitle ? `OS · ${s.processTitle}` : 'OS'}</span>
                              )}
                            </p>
                          ) : (
                            <p className="text-xs text-warning-text">
                              {aindaProcessando ? 'Lendo o documento...' : doc.status === 'NOT_IDENTIFIED' ? 'O robô não reconheceu este documento' : 'Sem entrega sugerida'}
                              {typeof motivo === 'string' && ` — ${motivo}`}
                            </p>
                          )}
                        </div>
                        {doc.confidence !== null && <span className="text-xs text-muted-foreground">leitura {Math.round(doc.confidence * 100)}%</span>}
                      </div>

                      {s && doc.checks && (
                        <div className="flex flex-wrap gap-1.5">
                          <Check ok={doc.checks.cnpj} label="CNPJ" />
                          <Check ok={doc.checks.competence} label={competenceLabel(doc.checks.competence, s.competence, doc.extractedFields)} />
                          {s.requiresPayment && <Check ok={doc.checks.payment} label={doc.checks.payment ? `Valor R$ ${s.amount?.replace('.', ',')} · vence ${s.paymentDueDate?.split('-').reverse().join('/')}` : 'Valor e vencimento'} />}
                        </div>
                      )}

                      {typeof erro === 'string' && <p className="text-xs text-danger-text">Erro ao processar: {erro}</p>}
                      {typeof duplicataDe === 'string' && <p className="text-xs text-warning-text">Possível duplicata de outro documento já enviado.</p>}

                      {/* Also without a suggestion (the suggested delivery was removed): the reviewer picks one */}
                      {(ajustando || !doc.ready) && doc.taskId && doc.task && doc.task.pendingDeliverables.length > 0 && (
                        <OpcoesDeEntrega
                          entregas={doc.task.pendingDeliverables}
                          campos={doc.extractedFields ?? {}}
                          onChange={(opcoes) => setOpcoesPorDoc((prev) => ({ ...prev, [doc.id]: opcoes }))}
                        />
                      )}

                      {campos.length > 0 && (
                        <details className="text-xs text-muted-foreground">
                          <summary className="cursor-pointer">Ver campos lidos</summary>
                          <div className="mt-1 space-y-0.5">
                            {campos.map(([campo, v]) => {
                              const field = v as { bruto: string; valor: string | number | null; valido: boolean }
                              return <p key={campo}>{campo}: {String(field.valor ?? field.bruto)} {!field.valido && <span className="text-danger-text">(inválido)</span>}</p>
                            })}
                          </div>
                        </details>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {doc.taskId && (
                          <Button
                            size="sm"
                            onClick={() => confirmarMutation.mutate(doc.id)}
                            disabled={confirmarMutation.isPending || (!doc.ready && !!doc.task?.pendingDeliverables.length && !opcoesPorDoc[doc.id])}
                          >
                            Confirmar
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => abrirPdf(doc.id, doc.filename)}>Ver PDF</Button>
                        {trocandoId === doc.id ? (
                          <SeletorDeTarefa onEscolher={(taskId) => trocarMutation.mutate({ id: doc.id, taskId })} onCancelar={() => setTrocandoId(null)} />
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setTrocandoId(doc.id)}>Trocar tarefa</Button>
                        )}
                        {doc.ready && !ajustando && (
                          <Button size="sm" variant="ghost" onClick={() => setAjustandoId(doc.id)}>Ajustar</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => rejeitarMutation.mutate(doc.id)}>Recusar</Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {pdf && (
        <aside className="hidden lg:flex w-[45%] max-w-2xl flex-col border-l border-border bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
            <p className="text-sm font-medium text-foreground truncate">{pdf.name}</p>
            <div className="flex gap-2">
              <a href={pdf.url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent-hover hover:underline">Abrir em nova aba</a>
              <button type="button" onClick={() => setPdf(null)} className="text-xs text-muted-foreground hover:text-foreground">Fechar</button>
            </div>
          </div>
          <iframe title={pdf.name} src={pdf.url} className="flex-1 w-full" />
        </aside>
      )}
    </div>
  )
}
