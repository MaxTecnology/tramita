import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { UPLOAD_ACCEPT } from '@/lib/upload'
import { cn, mensagemDeErro } from '@/lib/utils'
import { usePortalClient } from './Layout'

interface MonthSummary { competence: string; pending: number; total: number }
type RequestStatus = 'PENDING' | 'UPLOADED' | 'APPROVED' | 'REJECTED' | 'NOT_APPLICABLE'
interface DocumentRequest {
  id: string
  taskId: string
  name: string
  status: RequestStatus
  rejectionReason: string | null
  taskTitle: string
  departmentName: string
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const monthLabel = (c: string) => `${MONTHS[Number(c.slice(5, 7)) - 1]}/${c.slice(0, 4)}`

// red = pending/refused, yellow = sent and waiting for the office, green = approved or nothing to send
const STATUS: Record<RequestStatus, { label: string; dot: string; text: string }> = {
  PENDING: { label: 'Pendente', dot: 'bg-danger-text', text: 'text-danger-text' },
  REJECTED: { label: 'Recusado', dot: 'bg-danger-text', text: 'text-danger-text' },
  UPLOADED: { label: 'Enviado — em conferência', dot: 'bg-warning-text', text: 'text-warning-text' },
  APPROVED: { label: 'Aprovado', dot: 'bg-success-text', text: 'text-success-text' },
  NOT_APPLICABLE: { label: 'Nada a enviar', dot: 'bg-success-text', text: 'text-success-text' },
}

function currentCompetence(): string {
  return new Date().toISOString().slice(0, 7)
}

// Monthly documents the office asked for (recurring obligations only — process requests live in the
// process). Current month opens by default; months without pending items stay collapsed in the picker.
export function SendDocumentsView({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient()
  // A notification link carries the month (?competence=AAAA-MM)
  const [searchParams] = useSearchParams()
  const [competence, setCompetence] = useState(() => {
    const linked = searchParams.get('competence')
    return linked && /^\d{4}-\d{2}$/.test(linked) ? linked : ''
  })

  const { data: months = [] } = useQuery<MonthSummary[]>({
    queryKey: ['portal-request-months', clientId],
    queryFn: () => api.get('/portal/document-requests/months', { params: { clientId } }).then((r) => r.data),
    enabled: !!clientId,
  })

  useEffect(() => {
    if (competence || months.length === 0) return
    const current = months.find((m) => m.competence === currentCompetence())
    setCompetence((current ?? months.find((m) => m.pending > 0) ?? months[0]).competence)
  }, [months, competence])

  const { data, isLoading } = useQuery<{ competence: string; requests: DocumentRequest[] }>({
    queryKey: ['portal-requests-month', clientId, competence],
    queryFn: () => api.get('/portal/document-requests', { params: { clientId, competence } }).then((r) => r.data),
    enabled: !!clientId && !!competence,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['portal-requests-month', clientId] })
    queryClient.invalidateQueries({ queryKey: ['portal-request-months', clientId] })
    queryClient.invalidateQueries({ queryKey: ['portal-home', clientId] })
  }

  const uploadMutation = useMutation({
    mutationFn: ({ r, file }: { r: DocumentRequest; file: File }) => {
      const form = new FormData()
      form.append('file', file)
      return api.post(`/portal/tasks/${r.taskId}/documents/requests/${r.id}/upload`, form)
    },
    onSuccess: () => { toast.success('Documento enviado'); refresh() },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao enviar documento')),
  })
  const notApplicableMutation = useMutation({
    mutationFn: ({ r, value }: { r: DocumentRequest; value: boolean }) => {
      const url = `/portal/tasks/${r.taskId}/documents/requests/${r.id}/not-applicable`
      return value ? api.post(url) : api.delete(url)
    },
    onSuccess: refresh,
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao atualizar documento')),
  })

  const requests = data?.requests ?? []
  const { data: home } = useQuery<{ documentsToSendInProcesses: number }>({
    queryKey: ['portal-home', clientId],
    queryFn: () => api.get('/portal/home', { params: { clientId } }).then((r) => r.data),
    enabled: !!clientId,
  })
  const inProcesses = home?.documentsToSendInProcesses ?? 0

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Enviar documentos</h1>
        {months.length > 0 && (
          <select
            value={competence}
            onChange={(e) => setCompetence(e.target.value)}
            aria-label="Mês"
            className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-foreground"
          >
            {months.map((m) => (
              <option key={m.competence} value={m.competence}>
                {monthLabel(m.competence)}{m.pending > 0 ? ` — ${m.pending} pendente${m.pending > 1 ? 's' : ''}` : ' — em dia'}
              </option>
            ))}
          </select>
        )}
      </div>

      {inProcesses > 0 && (
        <Link to="/portal/board" className="block rounded-md border border-warning-text/40 bg-warning-bg px-3 py-2 text-sm text-warning-text hover:underline">
          {inProcesses === 1 ? 'Há 1 documento pedido' : `Há ${inProcesses} documentos pedidos`} dentro de processos — ver processos
        </Link>
      )}

      {months.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <Send size={40} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhum documento pedido pelo escritório</p>
        </div>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Documentos que o escritório precisa, referentes a {competence && monthLabel(competence)}.</p>
          <div className="space-y-2">
            {requests.map((r) => {
              const st = STATUS[r.status]
              const open = r.status === 'PENDING' || r.status === 'REJECTED'
              return (
                <div key={r.id} className="rounded-lg border border-border bg-surface px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.departmentName} · {r.taskTitle}</p>
                    </div>
                    <span className={cn('flex items-center gap-1.5 text-xs font-medium whitespace-nowrap', st.text)}>
                      <span className={cn('h-2 w-2 rounded-full', st.dot)} />
                      {st.label}
                    </span>
                  </div>
                  {r.status === 'REJECTED' && r.rejectionReason && (
                    <p className="mt-1 text-xs text-danger-text">{r.rejectionReason}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-3">
                    {open && (
                      <>
                        <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-accent-hover hover:underline">
                          <Upload size={12} />
                          Anexar
                          <input
                            type="file" accept={UPLOAD_ACCEPT} className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              e.target.value = ''
                              if (file) uploadMutation.mutate({ r, file })
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => notApplicableMutation.mutate({ r, value: true })}
                          disabled={notApplicableMutation.isPending}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          Nada a enviar
                        </button>
                      </>
                    )}
                    {r.status === 'NOT_APPLICABLE' && (
                      <button
                        type="button"
                        onClick={() => notApplicableMutation.mutate({ r, value: false })}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        Desfazer
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default function SendDocuments() {
  const { clientId } = usePortalClient()
  return <SendDocumentsView clientId={clientId} />
}
