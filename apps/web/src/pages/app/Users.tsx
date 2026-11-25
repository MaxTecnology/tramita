import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, Plus, Search, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ActionMenu } from '@/components/ui/action-menu'
import { askConfirm } from '@/components/ui/app-dialogs'
import { cn, mensagemDeErro } from '@/lib/utils'
import type { User } from '@/types'
import { UserFormPanel, EMPTY_USER_FORM, type UserFormValues } from './users/UserFormPanel'

type Status = 'active' | 'inactive'
type RoleFilter = 'all' | 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'

const ROLE_LABEL: Record<string, string> = { ORG_ADMIN: 'Admin', ORG_MANAGER: 'Gerente', ORG_MEMBER: 'Colaborador' }
// Admin carries the strongest mark; the avatar repeats the profile color
const ROLE_BADGE: Record<string, string> = {
  ORG_ADMIN: 'bg-highlight-bg text-highlight-text',
  ORG_MANAGER: 'bg-info-bg text-info-text',
  ORG_MEMBER: 'bg-neutral-bg text-neutral-text',
}

const selectCls = 'h-9 rounded-md border border-border bg-surface px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function toForm(user: User): UserFormValues {
  return {
    name: user.name,
    email: user.email,
    phone: user.phone ?? '',
    role: user.role === 'ORG_MANAGER' ? 'ORG_MANAGER' : 'ORG_MEMBER',
    departmentIds: (user.departments ?? []).map((d) => d.id),
    seesDepartmentWork: user.seesDepartmentWork ?? true,
  }
}

export default function Users() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [status, setStatus] = useState<Status>('active')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [panel, setPanel] = useState<{ mode: 'create' } | { mode: 'edit'; user: User } | null>(null)
  const [password, setPassword] = useState<{ title: string; who: string; value: string } | null>(null)

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users', status],
    queryFn: () => api.get('/users', { params: status === 'inactive' ? { status } : {} }).then((r) => r.data),
  })
  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
  })

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return users.filter((u) =>
      (roleFilter === 'all' || u.role === roleFilter) &&
      (departmentFilter === 'all' || u.role === 'ORG_ADMIN' || (u.departments ?? []).some((d) => d.id === departmentFilter)) &&
      (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)))
  }, [users, search, roleFilter, departmentFilter])
  const filtering = !!search.trim() || roleFilter !== 'all' || departmentFilter !== 'all'

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] })

  // Create or edit travels with the call: the answer is handled the same even if the page changed
  const saveMutation = useMutation({
    mutationFn: ({ target, values }: { target: { mode: 'create' } | { mode: 'edit'; id: string }; values: UserFormValues }) => {
      const body = { ...values, phone: values.phone.trim() || (target.mode === 'edit' ? null : undefined) }
      return target.mode === 'edit'
        ? api.patch(`/users/${target.id}`, body).then((r) => r.data as User & { temporaryPassword?: string })
        : api.post('/users', body).then((r) => r.data as User & { temporaryPassword?: string })
    },
    onSuccess: (data, { target }) => {
      refresh()
      if (target.mode === 'create' && data.temporaryPassword) {
        setPassword({ title: 'Usuário cadastrado', who: data.name, value: data.temporaryPassword })
      } else {
        toast.success('Alterações salvas')
      }
      setPanel(null)
    },
    onError: (err) => toast.error(mensagemDeErro(err, 'Não foi possível salvar. Confira os dados e tente de novo.')),
  })

  const resetMutation = useMutation({
    mutationFn: (user: User) => api.post(`/users/${user.id}/reset-password`).then((r) => ({ user, ...(r.data as { temporaryPassword: string }) })),
    onSuccess: ({ user, temporaryPassword }) => setPassword({ title: 'Senha redefinida', who: user.name, value: temporaryPassword }),
    onError: (err) => toast.error(mensagemDeErro(err, 'Não foi possível redefinir a senha')),
  })

  const deactivateMutation = useMutation({
    mutationFn: (user: User) => api.delete(`/users/${user.id}`),
    onSuccess: () => { toast.success('Usuário desativado'); refresh() },
    onError: (err, user) => {
      // 409 = still responsible for clients: offer the transfer screen
      const responsible = (err as { response?: { status?: number } })?.response?.status === 409
      toast.error(mensagemDeErro(err, 'Não foi possível desativar'), responsible
        ? { action: { label: 'Transferir responsabilidades', onClick: () => navigate(`/app/users/${user.id}/transfer`) } }
        : undefined)
    },
  })

  const reactivateMutation = useMutation({
    mutationFn: (user: User) => api.post<User>(`/users/${user.id}/reactivate`).then((r) => r.data),
    // Someone whose departments were all removed meanwhile comes back seeing nothing: the edit panel
    // opens so a department is chosen right away
    onSuccess: (back) => {
      refresh()
      if (back?.role !== 'ORG_ADMIN' && back?.departments && back.departments.length === 0) {
        toast.warning(`${back.name} foi reativado sem departamento. Escolha ao menos um para voltar a ver o trabalho.`)
        setStatus('active')
        setPanel({ mode: 'edit', user: back })
        return
      }
      toast.success('Usuário reativado')
    },
    onError: (err) => toast.error(mensagemDeErro(err, 'Não foi possível reativar')),
  })

  async function resetPassword(user: User) {
    const ok = await askConfirm({
      title: `Redefinir a senha de ${user.name}?`,
      description: 'A senha atual deixa de funcionar e a pessoa sai de todas as sessões. Você recebe uma senha temporária para repassar.',
      confirmLabel: 'Redefinir senha',
    })
    if (ok) resetMutation.mutate(user)
  }

  function closePassword() {
    setPassword(null)
    // The password also lives in the mutations' last answer: drop it
    saveMutation.reset()
    resetMutation.reset()
  }

  async function copyPassword(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Senha copiada')
    } catch {
      toast.error('Não foi possível copiar. Selecione a senha e copie manualmente.')
    }
  }

  async function deactivate(user: User) {
    const ok = await askConfirm({
      title: `Desativar ${user.name}?`,
      description: 'A pessoa perde o acesso ao Tramita. O histórico continua registrado e dá para reativar depois.',
      confirmLabel: 'Desativar',
      danger: true,
    })
    if (ok) deactivateMutation.mutate(user)
  }

  function clearFilters() {
    setSearch('')
    setRoleFilter('all')
    setDepartmentFilter('all')
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-xl font-bold text-foreground">Usuários</h1>
          <p className="text-sm text-muted-foreground">A equipe do escritório e o que cada pessoa acessa.</p>
        </div>
        <Button onClick={() => setPanel({ mode: 'create' })} className="gap-1.5">
          <Plus size={16} aria-hidden /> Novo usuário
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:flex-1">
          <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Buscar pessoas"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou e-mail"
            className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <label className="sr-only" htmlFor="users-role">Perfil</label>
        <select id="users-role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleFilter)} className={cn(selectCls, 'min-w-[150px] flex-1 sm:flex-none')}>
          <option value="all">Todos os perfis</option>
          <option value="ORG_ADMIN">Admin</option>
          <option value="ORG_MANAGER">Gerente</option>
          <option value="ORG_MEMBER">Colaborador</option>
        </select>
        <label className="sr-only" htmlFor="users-department">Departamento</label>
        <select id="users-department" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className={cn(selectCls, 'min-w-[150px] flex-1 sm:flex-none')}>
          <option value="all">Todos os departamentos</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div role="radiogroup" aria-label="Situação" className="inline-flex rounded-md border border-border bg-surface p-0.5">
          {(['active', 'inactive'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={status === s}
              onClick={() => setStatus(s)}
              className={cn(
                'rounded px-3 py-1.5 text-sm transition-colors',
                status === s ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-neutral-bg hover:text-foreground',
              )}
            >
              {s === 'active' ? 'Ativos' : 'Desativados'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-visible rounded-lg border border-border bg-surface">
        <div className="hidden md:grid grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,2.4fr)_auto] gap-4 border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground">
          <span>Pessoa</span>
          <span>Perfil</span>
          <span>Acesso</span>
          <span className="w-[104px]" aria-hidden />
        </div>

        {isLoading ? (
          <div aria-label="Carregando usuários" className="divide-y divide-border">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-4">
                <div className="h-9 w-9 rounded-full bg-neutral-bg motion-safe:animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-40 rounded bg-neutral-bg motion-safe:animate-pulse" />
                  <div className="h-3 w-56 rounded bg-neutral-bg motion-safe:animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
            <UserRound size={28} aria-hidden className="text-muted-foreground" />
            {filtering ? (
              <>
                <p className="text-sm text-muted-foreground">Ninguém encontrado com esses filtros.</p>
                <Button variant="outline" size="sm" onClick={clearFilters}>Limpar filtros</Button>
              </>
            ) : status === 'inactive' ? (
              <p className="text-sm text-muted-foreground">Nenhuma pessoa desativada.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Cadastre quem trabalha no escritório para distribuir as tarefas.</p>
                <Button size="sm" onClick={() => setPanel({ mode: 'create' })}>Cadastrar a primeira pessoa</Button>
              </>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((user) => {
              const isAdmin = user.role === 'ORG_ADMIN'
              const userDepartments = user.departments ?? []
              return (
                <li
                  key={user.id}
                  data-user-row
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-4 py-3.5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,2.4fr)_auto] md:items-center md:gap-4"
                >
                  {/* Person */}
                  <div className="flex min-w-0 items-start gap-3">
                    <span aria-hidden className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold', ROLE_BADGE[user.role])}>
                      {initials(user.name)}
                    </span>
                    <div className="min-w-0">
                      <p className={cn('truncate text-sm font-medium', status === 'inactive' ? 'text-muted-foreground' : 'text-foreground')}>{user.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                      {user.phone && <p className="truncate text-xs text-muted-foreground">{user.phone}</p>}
                    </div>
                  </div>

                  {/* Actions (top right on phones, last column on desktop) */}
                  <div className="row-span-3 flex items-center justify-end gap-1 md:order-last md:row-span-1 md:w-[104px]">
                    {status === 'inactive' ? (
                      <Button variant="outline" size="sm" aria-label={`Reativar ${user.name}`} disabled={reactivateMutation.isPending} onClick={() => reactivateMutation.mutate(user)}>
                        Reativar
                      </Button>
                    ) : (
                      <>
                        {!isAdmin && (
                          <Button variant="ghost" size="sm" aria-label={`Editar ${user.name}`} onClick={() => setPanel({ mode: 'edit', user })}>
                            Editar
                          </Button>
                        )}
                        <ActionMenu
                          label={`Mais ações de ${user.name}`}
                          items={isAdmin
                            ? [{ label: 'Transferir responsabilidades', onSelect: () => navigate(`/app/users/${user.id}/transfer`) }]
                            : [
                              { label: 'Redefinir senha', onSelect: () => void resetPassword(user), disabled: resetMutation.isPending },
                              { label: 'Transferir responsabilidades', onSelect: () => navigate(`/app/users/${user.id}/transfer`) },
                              { label: 'Desativar', onSelect: () => void deactivate(user), danger: true, separated: true },
                            ]}
                        />
                      </>
                    )}
                  </div>

                  {/* Profile */}
                  <div className="pl-12 md:pl-0">
                    <span className={cn('inline-flex rounded px-2 py-0.5 text-xs font-medium', ROLE_BADGE[user.role])}>
                      {ROLE_LABEL[user.role] ?? user.role}
                    </span>
                  </div>

                  {/* Access: what the person sees */}
                  <div className="min-w-0 pl-12 md:pl-0">
                    {isAdmin ? (
                      <span className="text-sm text-muted-foreground">Todos os departamentos</span>
                    ) : userDepartments.length === 0 ? (
                      <span className="inline-flex rounded bg-danger-bg px-2 py-0.5 text-xs text-danger-text">Sem departamento</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {userDepartments.map((d) => (
                          <span key={d.id} className="rounded border border-border px-2 py-0.5 text-xs text-foreground">{d.name}</span>
                        ))}
                        {user.role === 'ORG_MEMBER' && user.seesDepartmentWork && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Eye size={12} aria-hidden />
                            Vê o trabalho da equipe
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {!isLoading && users.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {filtered.length === users.length ? `${users.length} ${users.length === 1 ? 'pessoa' : 'pessoas'}` : `${filtered.length} de ${users.length} pessoas`}
        </p>
      )}

      <UserFormPanel
        key={panel ? (panel.mode === 'edit' ? `edit-${panel.user.id}` : 'create') : 'closed'}
        open={!!panel}
        mode={panel?.mode ?? 'create'}
        initial={panel?.mode === 'edit' ? toForm(panel.user) : EMPTY_USER_FORM}
        departments={departments}
        saving={saveMutation.isPending}
        onClose={() => setPanel(null)}
        onSubmit={(values) => saveMutation.mutate({ target: panel?.mode === 'edit' ? { mode: 'edit', id: panel.user.id } : { mode: 'create' }, values })}
      />

      <Dialog open={!!password} onOpenChange={(open) => { if (!open) closePassword() }}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{password?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Senha temporária de {password?.who}. Repasse agora: ela não aparece de novo. A pessoa pode trocá-la em Meu Perfil.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-neutral-bg px-3 py-2 font-mono text-sm text-foreground">{password?.value}</code>
              <Button
                type="button"
                variant="outline"
                onClick={() => { if (password) void copyPassword(password.value) }}
              >
                Copiar
              </Button>
            </div>
            <div className="flex justify-end pt-1">
              <Button onClick={closePassword}>Concluir</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
