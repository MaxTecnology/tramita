import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ClientUser, Client, Department } from '@/types'

interface AccessRow { clientId: string; departmentId: string }

interface FormState {
  name: string
  email: string
  password: string
  phone: string
  isActive: boolean
  accesses: AccessRow[]
}

const EMPTY_FORM: FormState = { name: '', email: '', password: '', phone: '', isActive: true, accesses: [] }

export default function ClientUserForm() {
  const { id } = useParams<{ id: string }>()
  const isEditing = !!id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [draftClientId, setDraftClientId] = useState('')
  const [draftDepartmentId, setDraftDepartmentId] = useState('')

  const { data: clientUser, isLoading } = useQuery<ClientUser>({
    queryKey: ['client-user', id],
    queryFn: () => api.get(`/client-users/${id}`).then((r) => r.data),
    enabled: isEditing,
  })

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
  })

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
  })

  useEffect(() => {
    if (!clientUser) return
    setForm({
      name: clientUser.name, email: clientUser.email, password: '', phone: clientUser.phone ?? '',
      isActive: clientUser.isActive,
      accesses: clientUser.accesses.map((a) => ({ clientId: a.clientId, departmentId: a.departmentId })),
    })
  }, [clientUser])

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name, email: form.email, isActive: form.isActive,
        accesses: form.accesses,
        ...(form.password ? { password: form.password } : {}),
      }
      // No PATCH (edição), campo vazio precisa virar `null` pra realmente limpar o telefone no
      // banco — `undefined` faz o Prisma ignorar o campo, mantendo o valor antigo. No POST
      // (criação) não há nada a limpar, então `undefined` (omitir do payload) é o correto.
      return isEditing
        ? api.patch(`/client-users/${id}`, { ...payload, phone: form.phone || null }).then((r) => r.data)
        : api.post('/client-users', { ...payload, phone: form.phone || undefined, password: form.password }).then((r) => r.data)
    },
    onSuccess: () => {
      toast.success(isEditing ? 'Usuário atualizado' : 'Usuário criado')
      qc.invalidateQueries({ queryKey: ['client-users'] })
      navigate('/app/settings/client-users')
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao salvar usuário')
    },
  })

  function addAccessRow() {
    if (!draftClientId || !draftDepartmentId) return
    if (form.accesses.some((a) => a.clientId === draftClientId && a.departmentId === draftDepartmentId)) return
    setForm((f) => ({ ...f, accesses: [...f.accesses, { clientId: draftClientId, departmentId: draftDepartmentId }] }))
    setDraftClientId('')
    setDraftDepartmentId('')
  }

  function clientName(id: string) { return clients.find((c) => c.id === id)?.name ?? id }
  function departmentName(id: string) { return departments.find((d) => d.id === id)?.name ?? id }

  if (isEditing && isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/app/settings/client-users" aria-label="Voltar" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-lg md:text-xl font-bold text-foreground">{isEditing ? 'Editar usuário' : 'Novo usuário'}</h1>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate() }} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cu-name">Nome</Label>
            <Input id="cu-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cu-email">E-mail</Label>
            <Input id="cu-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cu-password">{isEditing ? 'Nova senha (deixe em branco pra manter)' : 'Senha'}</Label>
            <Input id="cu-password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!isEditing} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cu-phone">Telefone</Label>
            <Input id="cu-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(82) 99999-9999" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Ativo
        </label>

        <div className="pt-2 border-t border-border space-y-2">
          <Label>Clientes e departamentos com acesso</Label>
          <div className="flex gap-2">
            <select value={draftClientId} onChange={(e) => setDraftClientId(e.target.value)} className="h-9 flex-1 rounded-md border border-border bg-surface text-foreground px-2 text-sm">
              <option value="">Cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={draftDepartmentId} onChange={(e) => setDraftDepartmentId(e.target.value)} className="h-9 flex-1 rounded-md border border-border bg-surface text-foreground px-2 text-sm">
              <option value="">Departamento</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <Button type="button" variant="outline" onClick={addAccessRow} disabled={!draftClientId || !draftDepartmentId}>Adicionar</Button>
          </div>

          {form.accesses.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum vínculo adicionado ainda.</p>
          ) : (
            <ul className="space-y-1">
              {form.accesses.map((a, i) => (
                <li key={`${a.clientId}-${a.departmentId}`} className="flex items-center justify-between text-sm bg-neutral-bg rounded px-2 py-1.5">
                  <span>{clientName(a.clientId)} — {departmentName(a.departmentId)}</span>
                  <button type="button" onClick={() => setForm((f) => ({ ...f, accesses: f.accesses.filter((_, idx) => idx !== i) }))} className="text-muted-foreground hover:text-danger-text">
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button type="button" variant="outline" onClick={() => navigate('/app/settings/client-users')}>Cancelar</Button>
          <Button type="submit" disabled={saveMutation.isPending || !form.name || !form.email || (!isEditing && !form.password) || form.accesses.length === 0}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
