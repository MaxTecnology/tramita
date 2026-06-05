import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { User, OrgRole } from '@/types'
import { toast } from 'sonner'

type EditableRole = Exclude<OrgRole, 'ORG_ADMIN'>

type CreateForm = {
  name: string; email: string; password: string; role: EditableRole; phone: string
}

type EditForm = {
  name: string; email: string; role: EditableRole; phone: string
}

const EMPTY_CREATE: CreateForm = {
  name: '', email: '', password: '', role: 'ORG_MEMBER', phone: '',
}

const ROLE_LABEL: Record<string, string> = {
  ORG_ADMIN: 'Admin',
  ORG_MANAGER: 'Gerente',
  ORG_MEMBER: 'Colaborador',
}

const ROLE_BADGE: Record<string, string> = {
  ORG_ADMIN: 'bg-gray-100 text-gray-600',
  ORG_MANAGER: 'bg-blue-100 text-blue-600',
  ORG_MEMBER: 'bg-green-100 text-green-600',
}

export default function Users() {
  const queryClient = useQueryClient()

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE)

  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({
    name: '', email: '', role: 'ORG_MEMBER', phone: '',
  })

  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | EditableRole>('all')

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  })

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return users.filter((u) => {
      const matchRole = roleFilter === 'all' || u.role === roleFilter
      const matchSearch =
        !q ||
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      return matchRole && matchSearch
    })
  }, [users, search, roleFilter])

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/users', {
        name: createForm.name,
        email: createForm.email,
        password: createForm.password,
        role: createForm.role,
        phone: createForm.phone || undefined,
      }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Usuário cadastrado com sucesso')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowCreate(false)
      setCreateForm(EMPTY_CREATE)
      setSearch('')
      setRoleFilter('all')
    },
    onError: () => toast.error('Erro ao cadastrar usuário'),
  })

  const updateMutation = useMutation({
    mutationFn: (data: EditForm & { id: string }) =>
      api.patch(`/users/${data.id}`, {
        name: data.name,
        email: data.email,
        role: data.role,
        phone: data.phone || undefined,
      }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Usuário atualizado')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setEditingUser(null)
    },
    onError: () => toast.error('Erro ao salvar alterações'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      toast.success('Usuário desativado')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setDeletingId(null)
    },
    onError: () => toast.error('Erro ao desativar usuário'),
  })

  function openEdit(user: User) {
    setEditingUser(user)
    setEditForm({
      name: user.name,
      email: user.email,
      role: user.role === 'ORG_MANAGER' ? 'ORG_MANAGER' : 'ORG_MEMBER',
      phone: user.phone ?? '',
    })
  }

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg md:text-xl font-bold text-gray-900">Usuários</h1>
        <Button
          onClick={() => { if (showCreate) setCreateForm(EMPTY_CREATE); setShowCreate(!showCreate) }}
          className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
        >
          {showCreate ? 'Cancelar' : '+ Novo usuário'}
        </Button>
      </div>

      {/* Formulário de criação */}
      {showCreate && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Novo usuário</h2>
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
              <Label htmlFor="c-password">Senha *</Label>
              <Input id="c-password" type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-role">Perfil</Label>
              <select
                id="c-role"
                value={createForm.role}
                onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as EditableRole })}
                className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <option value="ORG_MEMBER">Colaborador</option>
                <option value="ORG_MANAGER">Gerente</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-phone">Telefone</Label>
              <Input id="c-phone" value={createForm.phone} onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} placeholder="(82) 99999-9999" />
            </div>
          </div>
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
            <Button variant="outline" onClick={() => { setShowCreate(false); setCreateForm(EMPTY_CREATE) }}>Cancelar</Button>
          </div>
        </div>
      )}

      {/* Barra de filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            aria-label="Buscar usuários"
            type="text"
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex rounded-md border border-gray-300 overflow-hidden">
          {(['all', 'ORG_MANAGER', 'ORG_MEMBER'] as const satisfies readonly ('all' | EditableRole)[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(r)}
              className={cn(
                'px-3 py-2 text-sm font-medium transition-colors',
                roleFilter === r ? 'bg-[#185FA5] text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              {r === 'all' ? 'Todos' : r === 'ORG_MANAGER' ? 'Gerente' : 'Colaborador'}
            </button>
          ))}
        </div>
      </div>

      {/* Contador */}
      {users.length > 0 && (
        <p className="text-xs text-gray-400 mb-3">
          {filtered.length === users.length
            ? `${users.length} usuário${users.length !== 1 ? 's' : ''}`
            : `Exibindo ${filtered.length} de ${users.length}`}
        </p>
      )}

      {/* Lista */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-center text-gray-400 py-12">
            {users.length === 0 ? 'Nenhum usuário cadastrado.' : 'Nenhum usuário encontrado para este filtro.'}
          </p>
        )}
        {filtered.map((user) => (
          <div key={user.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
                <span className={cn('text-xs px-1.5 py-0.5 rounded flex-shrink-0', ROLE_BADGE[user.role] ?? 'bg-gray-100 text-gray-500')}>
                  {ROLE_LABEL[user.role] ?? user.role}
                </span>
              </div>
              <p className="text-xs text-gray-500 truncate">
                {user.email}{user.phone ? ` · ${user.phone}` : ''}
              </p>
            </div>
            {user.role !== 'ORG_ADMIN' && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button variant="ghost" size="sm" onClick={() => openEdit(user)} className="text-gray-600 hover:text-gray-900">
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (!window.confirm(`Desativar o usuário "${user.name}"?`)) return
                    setDeletingId(user.id)
                    deleteMutation.mutate(user.id)
                  }}
                  disabled={deleteMutation.isPending && deletingId === user.id}
                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                >
                  {deleteMutation.isPending && deletingId === user.id ? 'Desativando...' : 'Desativar'}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Modal de edição */}
      <Dialog open={!!editingUser} onOpenChange={(open) => { if (!open) setEditingUser(null) }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar usuário</DialogTitle>
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
            <div className="space-y-1">
              <Label htmlFor="e-role">Perfil</Label>
              <select
                id="e-role"
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value as EditableRole })}
                className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <option value="ORG_MEMBER">Colaborador</option>
                <option value="ORG_MANAGER">Gerente</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-phone">Telefone</Label>
              <Input id="e-phone" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} placeholder="(82) 99999-9999" />
            </div>
            {updateMutation.isError && (
              <p className="text-sm text-red-600">Erro ao salvar. Tente novamente.</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditingUser(null)}>Cancelar</Button>
              <Button
                onClick={() => { if (editingUser) updateMutation.mutate({ ...editForm, id: editingUser.id }) }}
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
