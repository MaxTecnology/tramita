import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Client } from '@/types'

type CreateForm = { name: string; email: string; password: string; whatsapp: string; cnpj: string }
type EditForm = { name: string; email: string; whatsapp: string; cnpj: string }

const normalizeOptional = (val: string) => val.trim() || undefined

export default function Clients() {
  const queryClient = useQueryClient()

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>({
    name: '', email: '', password: '', whatsapp: '', cnpj: '',
  })

  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ name: '', email: '', whatsapp: '', cnpj: '' })

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/clients', {
        name: createForm.name,
        email: createForm.email,
        password: createForm.password,
        whatsapp: normalizeOptional(createForm.whatsapp),
        cnpj: normalizeOptional(createForm.cnpj),
      }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setShowCreate(false)
      setCreateForm({ name: '', email: '', password: '', whatsapp: '', cnpj: '' })
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: EditForm) => {
      if (!editingClient) throw new Error('Nenhum cliente selecionado')
      return api.patch(`/clients/${editingClient.id}`, {
        name: data.name,
        email: data.email,
        whatsapp: normalizeOptional(data.whatsapp),
        cnpj: normalizeOptional(data.cnpj),
      }).then((r) => r.data)
    },
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
      email: client.email,
      whatsapp: client.whatsapp ?? '',
      cnpj: client.cnpj ?? '',
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
            <div className="space-y-1">
              <Label htmlFor="c-name">Nome *</Label>
              <Input id="c-name" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-cnpj">CNPJ</Label>
              <Input id="c-cnpj" value={createForm.cnpj} onChange={(e) => setCreateForm({ ...createForm, cnpj: e.target.value })} placeholder="00.000.000/0001-00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-email">E-mail *</Label>
              <Input id="c-email" type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-whatsapp">WhatsApp</Label>
              <Input id="c-whatsapp" value={createForm.whatsapp} onChange={(e) => setCreateForm({ ...createForm, whatsapp: e.target.value })} placeholder="5582999999999" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-password">Senha do portal *</Label>
              <Input id="c-password" type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} />
            </div>
          </div>
          {createMutation.isError && (
            <p className="text-sm text-red-600">Erro ao cadastrar cliente. Verifique os dados.</p>
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

      {/* Lista de clientes */}
      <div className="space-y-2">
        {clients.length === 0 && (
          <p className="text-center text-gray-400 py-12">Nenhum cliente cadastrado.</p>
        )}
        {clients.map((client) => (
          <div key={client.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate">{client.name}</p>
              <p className="text-xs text-gray-500 truncate">{client.email}</p>
              {(client.cnpj || client.whatsapp) && (
                <p className="text-xs text-gray-400 truncate mt-0.5">
                  {[client.cnpj, client.whatsapp].filter(Boolean).join(' · ')}
                </p>
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar cliente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1">
              <Label htmlFor="e-name">Nome *</Label>
              <Input id="e-name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-cnpj">CNPJ</Label>
              <Input id="e-cnpj" value={editForm.cnpj} onChange={(e) => setEditForm({ ...editForm, cnpj: e.target.value })} placeholder="00.000.000/0001-00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-email">E-mail *</Label>
              <Input id="e-email" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-whatsapp">WhatsApp</Label>
              <Input id="e-whatsapp" value={editForm.whatsapp} onChange={(e) => setEditForm({ ...editForm, whatsapp: e.target.value })} placeholder="5582999999999" />
            </div>
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
