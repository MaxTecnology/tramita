import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { Client } from '@/types'
import { toast } from 'sonner'
import { UserCheck } from 'lucide-react'

interface OrgUser { id: string; name: string; email: string; role: string }
interface Assignment { id: string; userId: string; user: OrgUser }

const ROLE_LABEL: Record<string, string> = {
  ORG_ADMIN: 'Admin', ORG_MANAGER: 'Gerente', ORG_MEMBER: 'Colaborador',
}

function AssignmentsSection({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient()

  const { data: users = [] } = useQuery<OrgUser[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  })

  const { data: assignments = [] } = useQuery<Assignment[]>({
    queryKey: ['client-assignments', clientId],
    queryFn: () => api.get(`/clients/${clientId}/assignments`).then((r) => r.data),
  })

  const assignedIds = assignments.map((a) => a.userId)

  const saveMutation = useMutation({
    mutationFn: (userIds: string[]) =>
      api.put(`/clients/${clientId}/assignments`, { userIds }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Responsáveis atualizados')
      queryClient.invalidateQueries({ queryKey: ['client-assignments', clientId] })
    },
    onError: () => toast.error('Erro ao salvar responsáveis'),
  })

  function toggle(userId: string) {
    const next = assignedIds.includes(userId)
      ? assignedIds.filter((id) => id !== userId)
      : [...assignedIds, userId]
    saveMutation.mutate(next)
  }

  const eligibleUsers = users.filter((u) => ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'].includes(u.role))

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <UserCheck size={14} className="text-gray-400" />
        <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Responsáveis</Label>
      </div>
      <p className="text-xs text-gray-400">
        Quando definido, só os responsáveis recebem notificações deste cliente.
        Sem responsável, notifica todos os admins e gerentes.
      </p>
      <div className="space-y-1">
        {eligibleUsers.map((u) => {
          const active = assignedIds.includes(u.id)
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => toggle(u.id)}
              disabled={saveMutation.isPending}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors',
                active
                  ? 'border-[#185FA5] bg-blue-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50',
              )}
            >
              <div className={cn(
                'w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border',
                active ? 'bg-[#185FA5] border-[#185FA5]' : 'border-gray-300',
              )}>
                {active && (
                  <svg viewBox="0 0 10 8" className="w-2.5 h-2 fill-white">
                    <path d="M1 4l3 3L9 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium truncate', active ? 'text-[#185FA5]' : 'text-gray-800')}>{u.name}</p>
                <p className="text-xs text-gray-400 truncate">{u.email}</p>
              </div>
              <span className={cn(
                'text-xs px-1.5 py-0.5 rounded flex-shrink-0',
                active ? 'bg-blue-100 text-[#185FA5]' : 'bg-gray-100 text-gray-500',
              )}>
                {ROLE_LABEL[u.role] ?? u.role}
              </span>
            </button>
          )
        })}
        {eligibleUsers.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-3">Nenhum usuário cadastrado.</p>
        )}
      </div>
    </div>
  )
}

type ClientType = 'PF' | 'PJ'

type CreateForm = {
  name: string; clientType: ClientType; cnpj: string; cpf: string
  email: string; password: string; whatsapp: string; phone: string; notes: string
}

type EditForm = {
  name: string; clientType: ClientType; cnpj: string; cpf: string
  email: string; whatsapp: string; phone: string; notes: string
}

const EMPTY_CREATE: CreateForm = {
  name: '', clientType: 'PJ', cnpj: '', cpf: '',
  email: '', password: '', whatsapp: '', phone: '', notes: '',
}

function TypeToggle({ value, onChange }: { value: ClientType; onChange: (v: ClientType) => void }) {
  return (
    <div className="flex rounded-md border border-gray-300 overflow-hidden w-fit">
      {(['PJ', 'PF'] as ClientType[]).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={cn(
            'px-4 py-1.5 text-sm font-medium transition-colors',
            value === t ? 'bg-[#185FA5] text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
          )}
        >
          {t === 'PJ' ? 'Pessoa Jurídica' : 'Pessoa Física'}
        </button>
      ))}
    </div>
  )
}

function ClientFields<T extends { clientType: ClientType; cnpj: string; cpf: string; whatsapp: string; phone: string; notes: string }>({
  form,
  onChange,
  idPrefix,
}: {
  form: T
  onChange: (patch: Partial<T>) => void
  idPrefix: string
}) {
  return (
    <>
      <div className="space-y-1">
        <Label>Tipo</Label>
        <TypeToggle value={form.clientType} onChange={(v) => onChange({ clientType: v } as Partial<T>)} />
      </div>

      {form.clientType === 'PJ' ? (
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-cnpj`}>CNPJ</Label>
          <Input id={`${idPrefix}-cnpj`} value={form.cnpj} onChange={(e) => onChange({ cnpj: e.target.value } as Partial<T>)} placeholder="00.000.000/0001-00" />
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-cpf`}>CPF</Label>
          <Input id={`${idPrefix}-cpf`} value={form.cpf} onChange={(e) => onChange({ cpf: e.target.value } as Partial<T>)} placeholder="000.000.000-00" />
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-whatsapp`}>WhatsApp</Label>
        <Input id={`${idPrefix}-whatsapp`} value={form.whatsapp} onChange={(e) => onChange({ whatsapp: e.target.value } as Partial<T>)} placeholder="5582999999999" />
      </div>

      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-phone`}>Telefone fixo</Label>
        <Input id={`${idPrefix}-phone`} value={form.phone} onChange={(e) => onChange({ phone: e.target.value } as Partial<T>)} placeholder="(82) 3000-0000" />
      </div>

      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-notes`}>Observações internas</Label>
        <textarea
          id={`${idPrefix}-notes`}
          value={form.notes}
          onChange={(e) => onChange({ notes: e.target.value } as Partial<T>)}
          rows={2}
          placeholder="Notas visíveis apenas para o escritório..."
          className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
        />
      </div>
    </>
  )
}

export default function Clients() {
  const queryClient = useQueryClient()

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE)

  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({
    name: '', clientType: 'PJ', cnpj: '', cpf: '', email: '', whatsapp: '', phone: '', notes: '',
  })
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
        c.email.toLowerCase().includes(q) ||
        (c.cnpj ?? '').toLowerCase().includes(q) ||
        (c.cpf ?? '').toLowerCase().includes(q)
      return matchType && matchSearch
    })
  }, [clients, search, typeFilter])

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/clients', {
        name: createForm.name,
        clientType: createForm.clientType,
        cnpj: createForm.cnpj || undefined,
        cpf: createForm.cpf || undefined,
        email: createForm.email,
        password: createForm.password,
        whatsapp: createForm.whatsapp || undefined,
        phone: createForm.phone || undefined,
        notes: createForm.notes || undefined,
      }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Cliente cadastrado com sucesso')
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setShowCreate(false)
      setCreateForm(EMPTY_CREATE)
      setSearch('')
      setTypeFilter('all')
    },
    onError: () => toast.error('Erro ao cadastrar cliente'),
  })

  const updateMutation = useMutation({
    mutationFn: (data: EditForm & { id: string }) =>
      api.patch(`/clients/${data.id}`, {
        name: data.name,
        clientType: data.clientType,
        cnpj: data.cnpj || undefined,
        cpf: data.cpf || undefined,
        email: data.email,
        whatsapp: data.whatsapp || undefined,
        phone: data.phone || undefined,
        notes: data.notes || undefined,
      }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Cliente atualizado')
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setEditingClient(null)
    },
    onError: () => toast.error('Erro ao salvar alterações'),
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

  function openEdit(client: Client) {
    setEditingClient(client)
    setEditForm({
      name: client.name,
      clientType: client.clientType ?? 'PJ',
      cnpj: client.cnpj ?? '',
      cpf: client.cpf ?? '',
      email: client.email,
      whatsapp: client.whatsapp ?? '',
      phone: client.phone ?? '',
      notes: client.notes ?? '',
    })
  }

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg md:text-xl font-bold text-gray-900">Clientes</h1>
        <Button
          onClick={() => { if (showCreate) setCreateForm(EMPTY_CREATE); setShowCreate(!showCreate) }}
          className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
        >
          {showCreate ? 'Cancelar' : '+ Novo cliente'}
        </Button>
      </div>

      {/* Barra de filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            aria-label="Buscar clientes"
            type="text"
            placeholder="Buscar por nome, e-mail, CPF/CNPJ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex rounded-md border border-gray-300 overflow-hidden">
          {(['all', 'PJ', 'PF'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={cn(
                'px-3 py-2 text-sm font-medium transition-colors',
                typeFilter === t ? 'bg-[#185FA5] text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              {t === 'all' ? 'Todos' : t}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          Incluir desativados
        </label>
      </div>

      {/* Contador */}
      {clients.length > 0 && (
        <p className="text-xs text-gray-400 mb-3">
          {filtered.length === clients.length
            ? `${clients.length} cliente${clients.length !== 1 ? 's' : ''}`
            : `Exibindo ${filtered.length} de ${clients.length}`}
        </p>
      )}

      {/* Formulário de criação */}
      {showCreate && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Novo cliente</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="c-name">Nome *</Label>
              <Input id="c-name" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-email">E-mail *</Label>
              <Input id="c-email" type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-password">Senha do portal *</Label>
              <Input id="c-password" type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} />
            </div>
          </div>

          <ClientFields
            form={createForm}
            onChange={(patch) => setCreateForm((f) => ({ ...f, ...patch }))}
            idPrefix="c"
          />

          {createMutation.isError && (
            <p className="text-sm text-red-600">Erro ao cadastrar. Verifique os dados.</p>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !createForm.name || !createForm.email || !createForm.password}
              className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
            >
              {createMutation.isPending ? 'Cadastrando...' : 'Cadastrar'}
            </Button>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      {/* Lista */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-center text-gray-400 py-12">
            {clients.length === 0 ? 'Nenhum cliente cadastrado.' : 'Nenhum cliente encontrado para este filtro.'}
          </p>
        )}
        {filtered.map((client) => (
          <div key={client.id} className={cn('bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between gap-3', !client.isActive && 'opacity-60')}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900 truncate">{client.name}</p>
                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded flex-shrink-0">
                  {client.clientType ?? 'PJ'}
                </span>
                {!client.isActive && (
                  <span className="text-xs bg-red-100 text-red-500 px-1.5 py-0.5 rounded flex-shrink-0">
                    Inativo
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 truncate">{client.email}</p>
              {(client.cnpj || client.cpf || client.whatsapp || client.phone) && (
                <p className="text-xs text-gray-400 truncate mt-0.5">
                  {[client.cnpj, client.cpf, client.whatsapp, client.phone].filter(Boolean).join(' · ')}
                </p>
              )}
              {client.notes && (
                <p className="text-xs text-amber-600 truncate mt-0.5 italic">{client.notes}</p>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button variant="ghost" size="sm" onClick={() => openEdit(client)} className="text-gray-600 hover:text-gray-900">
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

      {/* Modal de edição */}
      <Dialog open={!!editingClient} onOpenChange={(open) => { if (!open) setEditingClient(null) }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar cliente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1">
              <Label htmlFor="e-name">Nome *</Label>
              <Input id="e-name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-email">E-mail *</Label>
              <Input id="e-email" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
            <ClientFields
              form={editForm}
              onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))}
              idPrefix="e"
            />
            <hr className="border-gray-100" />
            {editingClient && <AssignmentsSection clientId={editingClient.id} />}
            {updateMutation.isError && (
              <p className="text-sm text-red-600">Erro ao salvar. Tente novamente.</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditingClient(null)}>Cancelar</Button>
              <Button
                onClick={() => { if (editingClient) updateMutation.mutate({ ...editForm, id: editingClient.id }) }}
                disabled={updateMutation.isPending || !editForm.name || !editForm.email}
                className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
              >
                {updateMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
