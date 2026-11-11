import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn, mensagemDeErro } from '@/lib/utils'
import type { Client } from '@/types'
import { toast } from 'sonner'
import { ClientForm } from './clients/ClientForm'
import { EMPTY_COMPANY, type ClientFormState, type CompanyForm } from './clients/clientFormStatus'

const EMPTY_FORM: ClientFormState = { company: EMPTY_COMPANY, departments: [], clientUsers: [] }

interface AssignmentRow { departmentId: string; userId: string }
interface ClientUserLinkRow { existingId: string; name: string; email: string; phone: string | null; departmentIds: string[] }

function toPayload(state: ClientFormState) {
  return {
    ...state.company,
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

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return clients.filter((c) => {
      const matchType = typeFilter === 'all' || c.clientType === typeFilter
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.codigo ?? '').toLowerCase().includes(q) ||
        (c.cnpj ?? '').toLowerCase().includes(q) ||
        (c.cpf ?? '').toLowerCase().includes(q)
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

  if (isLoading) return <div className="p-8 text-muted-foreground">Carregando...</div>

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Clientes</h1>
        <Button
          onClick={() => { if (!showCreate) setCreateKey((k) => k + 1); setShowCreate(!showCreate) }}
          className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
        >
          {showCreate ? 'Cancelar' : '+ Novo cliente'}
        </Button>
      </div>

      {/* Barra de filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            aria-label="Buscar clientes"
            type="text"
            placeholder="Buscar por nome, e-mail, CPF/CNPJ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-md bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div className="flex rounded-md border border-border overflow-hidden">
          {(['all', 'PJ', 'PF'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={cn(
                'px-3 py-2 text-sm font-medium transition-colors',
                typeFilter === t ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground hover:bg-neutral-bg',
              )}
            >
              {t === 'all' ? 'Todos' : t}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="h-4 w-4 rounded border-border text-accent"
          />
          Incluir desativados
        </label>
      </div>

      {/* Contador */}
      {clients.length > 0 && (
        <p className="text-xs text-muted-foreground mb-3">
          {filtered.length === clients.length
            ? `${clients.length} cliente${clients.length !== 1 ? 's' : ''}`
            : `Exibindo ${filtered.length} de ${clients.length}`}
        </p>
      )}

      {showCreate && (
        <div className="bg-surface rounded-lg border border-border p-4 mb-6 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Novo cliente</h2>
          <ClientForm
            key={createKey}
            initial={EMPTY_FORM}
            submitLabel="Cadastrar"
            isSaving={createMutation.isPending}
            onSubmit={(state) => createMutation.mutate(state)}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {/* Lista */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-center text-muted-foreground py-12">
            {clients.length === 0 ? 'Nenhum cliente cadastrado.' : 'Nenhum cliente encontrado para este filtro.'}
          </p>
        )}
        {filtered.map((client) => (
          <div key={client.id} className={cn('bg-surface rounded-lg border border-border px-4 py-3 flex items-center justify-between gap-3', !client.isActive && 'opacity-60')}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-foreground truncate">
                  {client.codigo ? `${client.codigo} - ${client.name}` : client.name}
                </p>
                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded flex-shrink-0">
                  {client.clientType ?? 'PJ'}
                </span>
                {!client.isActive && (
                  <span className="text-xs bg-red-100 text-red-500 px-1.5 py-0.5 rounded flex-shrink-0">
                    Inativo
                  </span>
                )}
              </div>
              {(client.cnpj || client.cpf || client.whatsapp || client.phone) && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {[client.cnpj, client.cpf, client.whatsapp, client.phone].filter(Boolean).join(' · ')}
                </p>
              )}
              {client.notes && (
                <p className="text-xs text-amber-600 truncate mt-0.5 italic">{client.notes}</p>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button variant="ghost" size="sm" onClick={() => openEdit(client)} className="text-muted-foreground hover:text-foreground">
                Editar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (!window.confirm(`Desativar o cliente "${client.name}"?`)) return
                  setDeletingId(client.id)
                  deleteMutation.mutate(client.id)
                }}
                disabled={deleteMutation.isPending && deletingId === client.id}
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
              >
                {deleteMutation.isPending && deletingId === client.id ? 'Desativando...' : 'Desativar'}
              </Button>
            </div>
          </div>
        ))}
      </div>

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
