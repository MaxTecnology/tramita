import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { Client } from '@/types'

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

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
  })

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
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setShowCreate(false)
      setCreateForm(EMPTY_CREATE)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: EditForm) =>
      api.patch(`/clients/${editingClient!.id}`, {
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
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setEditingClient(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/clients/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
  })

  function openEdit(client: Client) {
    setEditingClient(client)
    setEditForm({
      name: client.name,
      clientType: (client.clientType as ClientType) ?? 'PJ',
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
          onClick={() => setShowCreate(!showCreate)}
          className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
        >
          {showCreate ? 'Cancelar' : '+ Novo cliente'}
        </Button>
      </div>

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
        {clients.length === 0 && (
          <p className="text-center text-gray-400 py-12">Nenhum cliente cadastrado.</p>
        )}
        {clients.map((client) => (
          <div key={client.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900 truncate">{client.name}</p>
                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded flex-shrink-0">
                  {client.clientType ?? 'PJ'}
                </span>
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
                onClick={() => deleteMutation.mutate(client.id)}
                disabled={deleteMutation.isPending}
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
              >
                Desativar
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
            {updateMutation.isError && (
              <p className="text-sm text-red-600">Erro ao salvar. Tente novamente.</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditingClient(null)}>Cancelar</Button>
              <Button
                onClick={() => updateMutation.mutate(editForm)}
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
