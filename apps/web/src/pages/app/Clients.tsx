import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn, mensagemDeErro } from '@/lib/utils'
import { Plus, Users2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { SearchField } from '@/components/ui/search-field'
import { ListTable, ROW_OPENER, StatusTag } from '@/components/ui/list-table'
import { ActionMenu } from '@/components/ui/action-menu'
import { formatDocument, digitsOf } from '@/lib/documents'
import type { Client } from '@/types'
import { toast } from 'sonner'
import { ClientForm } from './clients/ClientForm'
import { EMPTY_COMPANY, type ClientFormState, type CompanyForm } from './clients/clientFormStatus'
import { askConfirm } from '@/components/ui/app-dialogs'

const EMPTY_FORM: ClientFormState = { company: EMPTY_COMPANY, departments: [], clientUsers: [] }

interface AssignmentRow { departmentId: string; userId: string }
interface ClientUserLinkRow { existingId: string; name: string; email: string; phone: string | null; isActive: boolean; departmentIds: string[] }

function toPayload(state: ClientFormState) {
  // The city name is not sent: the server takes it from the IBGE code
  const { cidade: _cidade, ...company } = state.company
  return {
    ...company,
    departments: state.departments,
    clientUsers: state.clientUsers.map((u) =>
      u.existingId
        ? { existingId: u.existingId, departmentIds: u.departmentIds }
        : { name: u.name, email: u.email, password: u.password, phone: u.phone || undefined, departmentIds: u.departmentIds },
    ),
  }
}

function companyFromClient(client: Client): CompanyForm {
  return {
    name: client.name,
    codigo: client.codigo ?? '',
    clientType: client.clientType ?? 'PJ',
    cnpj: client.cnpj ?? '',
    cpf: client.cpf ?? '',
    cei: client.cei ?? '',
    caepf: client.caepf ?? '',
    inscricaoEstadual: client.inscricaoEstadual ?? '',
    whatsapp: client.whatsapp ?? '',
    phone: client.phone ?? '',
    notes: client.notes ?? '',
    cep: client.cep ?? '',
    estado: client.estado ?? '',
    cidade: client.cidade ?? '',
    ibgeCityCode: client.ibgeCityCode ?? null,
    bairro: client.bairro ?? '',
    logradouro: client.logradouro ?? '',
    numero: client.numero ?? '',
    complemento: client.complemento ?? '',
  }
}

export default function Clients() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const [showCreate, setShowCreate] = useState(false)
  const [createKey, setCreateKey] = useState(0)
  const [editing, setEditing] = useState<{ client: Client; initial: ClientFormState } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'PF' | 'PJ'>('all')
  const [includeInactive, setIncludeInactive] = useState(false)

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients', { includeInactive }],
    queryFn: () =>
      api.get('/clients', { params: includeInactive ? { includeInactive: true } : {} })
        .then((r) => r.data),
  })

  // Name, code, or CPF/CNPJ typed with or without punctuation
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    const qDigits = digitsOf(q)
    return clients.filter((c) => {
      const matchType = typeFilter === 'all' || c.clientType === typeFilter
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.codigo ?? '').toLowerCase().includes(q) ||
        (qDigits.length >= 3 && (digitsOf(c.cnpj).includes(qDigits) || digitsOf(c.cpf).includes(qDigits)))
      return matchType && matchSearch
    })
  }, [clients, search, typeFilter])

  const createMutation = useMutation({
    mutationFn: (state: ClientFormState) => api.post('/clients', toPayload(state)).then((r) => r.data),
    onSuccess: () => {
      toast.success('Cliente cadastrado com sucesso')
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setShowCreate(false)
      setSearch('')
      setTypeFilter('all')
    },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao cadastrar cliente')),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, state }: { id: string; state: ClientFormState }) =>
      api.patch(`/clients/${id}`, toPayload(state)).then((r) => r.data),
    onSuccess: () => {
      toast.success('Cliente atualizado')
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setEditing(null)
    },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao salvar alterações')),
  })

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/clients/${id}/reactivate`),
    onSuccess: () => {
      toast.success('Cliente reativado')
      queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao reativar cliente')),
  })

  async function deactivate(client: Client) {
    if (!(await askConfirm({ title: `Desativar o cliente "${client.name}"?`, description: 'O cliente sai das listas e o portal dele é bloqueado. O histórico continua registrado, e dá para reativar depois.', confirmLabel: 'Desativar', danger: true }))) return
    setDeletingId(client.id)
    deleteMutation.mutate(client.id)
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/clients/${id}`),
    onSuccess: () => {
      toast.success('Cliente desativado')
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setDeletingId(null)
    },
    onError: () => toast.error('Erro ao desativar cliente'),
  })

  async function openEdit(client: Client) {
    try {
      const [assignments, links] = await Promise.all([
        api.get<AssignmentRow[]>(`/clients/${client.id}/assignments`).then((r) => r.data),
        api.get<ClientUserLinkRow[]>(`/clients/${client.id}/users`).then((r) => r.data),
      ])
      setEditing({
        client,
        initial: {
          company: companyFromClient(client),
          departments: assignments.map((a) => ({ departmentId: a.departmentId, responsibleUserId: a.userId })),
          clientUsers: links,
        },
      })
    } catch {
      toast.error('Erro ao carregar o cadastro do cliente')
    }
  }

  // ?edit=<clientId> abre o cadastro direto (links do alerta de recorrentes não geradas no Dashboard).
  const editParam = searchParams.get('edit')
  useEffect(() => {
    if (!editParam || clients.length === 0) return
    const target = clients.find((c) => c.id === editParam)
    if (target) void openEdit(target)
    setSearchParams((p) => { p.delete('edit'); return p }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, clients])

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Clientes"
        description="As empresas e pessoas que o escritório atende, com os departamentos e quem acompanha pelo portal."
        actions={
          <Button onClick={() => { setCreateKey((k) => k + 1); setShowCreate(true) }} className="gap-1.5">
            <Plus size={16} aria-hidden /> Novo cliente
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchField label="Buscar clientes" placeholder="Nome, código, CPF ou CNPJ" value={search} onChange={setSearch} className="w-full sm:w-72" />
        <div role="group" aria-label="Tipo de cliente" className="flex overflow-hidden rounded-md border border-border">
          {(['all', 'PJ', 'PF'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={typeFilter === t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                'h-9 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                typeFilter === t ? 'bg-accent text-accent-foreground' : 'bg-surface text-muted-foreground hover:bg-neutral-bg',
              )}
            >
              {t === 'all' ? 'Todos' : t === 'PJ' ? 'Empresas (PJ)' : 'Pessoas (PF)'}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} className="h-4 w-4 rounded border-border accent-[var(--color-accent)]" />
          Mostrar desativados
        </label>
      </div>

      {clients.length > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          {filtered.length === clients.length
            ? `${clients.length} ${clients.length === 1 ? 'cliente' : 'clientes'}`
            : `${filtered.length} de ${clients.length} clientes`}
        </p>
      )}

      <ListTable<Client>
        label="Clientes"
        loading={isLoading}
        rows={filtered}
        rowKey={(c) => c.id}
        interactive
        muted={(c) => !c.isActive}
        actionsWidth="3rem"
        empty={
          <div className="flex flex-col items-center text-muted-foreground">
            <Users2 size={40} aria-hidden className="mb-3 opacity-40" />
            <p className="text-sm font-medium">{clients.length === 0 ? 'Nenhum cliente cadastrado' : 'Nenhum cliente com esses filtros'}</p>
            {clients.length === 0 && <p className="mt-1 text-xs">Cadastre o primeiro pelo botão "Novo cliente".</p>}
          </div>
        }
        columns={[
          {
            header: 'Cliente', width: 'minmax(0,2fr)',
            cell: (c) => (
              <div className="min-w-0">
                <p className="flex min-w-0 items-baseline gap-2">
                  {c.codigo && <span className="flex-shrink-0 text-xs text-muted-foreground">{c.codigo}</span>}
                  {c.isActive
                    ? <button type="button" onClick={() => void openEdit(c)} className={cn(ROW_OPENER, 'truncate text-sm')}>{c.name}</button>
                    : <span className="truncate text-sm font-medium text-foreground">{c.name}</span>}
                </p>
                {!c.isActive && <span className="mt-1 inline-block"><StatusTag>Desativado</StatusTag></span>}
                {c.notes && <p className="mt-0.5 truncate text-xs text-muted-foreground" title={c.notes}>{c.notes}</p>}
              </div>
            ),
          },
          {
            header: 'Documento', width: 'minmax(0,1.3fr)',
            cell: (c) => (
              <p className="flex items-baseline gap-2 text-sm text-foreground">
                <span>{formatDocument(c.clientType === 'PF' ? c.cpf : c.cnpj) || '—'}</span>
                <span className="rounded bg-neutral-bg px-1.5 py-0.5 text-[11px] text-muted-foreground">{c.clientType ?? 'PJ'}</span>
              </p>
            ),
          },
          {
            header: 'Cidade', width: 'minmax(0,1.1fr)',
            cell: (c) => <span className="text-sm text-foreground">{c.cidade && c.estado ? `${c.cidade}/${c.estado}` : '—'}</span>,
          },
          {
            header: 'Contato', width: 'minmax(0,1fr)',
            cell: (c) => <span className="text-sm text-foreground">{c.whatsapp || c.phone || '—'}</span>,
          },
        ]}
        actions={(c) => (
          <ActionMenu
            label={`Mais ações de ${c.name}`}
            items={c.isActive
              ? [{ label: 'Desativar', onSelect: () => void deactivate(c), danger: true, disabled: deleteMutation.isPending && deletingId === c.id }]
              : [{ label: 'Reativar', onSelect: () => reactivateMutation.mutate(c.id), disabled: reactivateMutation.isPending }]}
          />
        )}
      />

      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) setShowCreate(false) }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo cliente</DialogTitle>
          </DialogHeader>
          {showCreate && (
            <ClientForm
              key={createKey}
              initial={EMPTY_FORM}
              submitLabel="Cadastrar"
              isSaving={createMutation.isPending}
              onSubmit={(state) => createMutation.mutate(state)}
              onCancel={() => setShowCreate(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null) }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar cliente</DialogTitle>
          </DialogHeader>
          {editing && (
            <ClientForm
              key={editing.client.id}
              initial={editing.initial}
              submitLabel="Salvar"
              isSaving={updateMutation.isPending}
              onSubmit={(state) => updateMutation.mutate({ id: editing.client.id, state })}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
