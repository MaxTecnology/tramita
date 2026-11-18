import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, UserCog } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PageHeader, SETTINGS_BACK } from '@/components/ui/page-header'
import { EditLink, ListTable, StatusTag } from '@/components/ui/list-table'
import { ActionMenu } from '@/components/ui/action-menu'
import { SearchField } from '@/components/ui/search-field'
import { askConfirm } from '@/components/ui/app-dialogs'
import type { ClientUser } from '@/types'

// The accesses of a contact grouped by company: "ACME — Fiscal, Pessoal"
function byCompany(u: ClientUser): { id: string; name: string; departments: string[] }[] {
  const map = new Map<string, { id: string; name: string; departments: string[] }>()
  for (const a of u.accesses) {
    const entry = map.get(a.client.id) ?? { id: a.client.id, name: a.client.name, departments: [] }
    entry.departments.push(a.department.name)
    map.set(a.client.id, entry)
  }
  return [...map.values()].sort((x, y) => x.name.localeCompare(y.name, 'pt-BR'))
}

// Configurações › Acessos ao portal: who, on the client side, follows the processes
export default function ClientUsers() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const { data: clientUsers = [], isLoading } = useQuery<ClientUser[]>({
    queryKey: ['client-users'],
    queryFn: () => api.get('/client-users').then((r) => r.data),
  })
  const shown = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return clientUsers
    return clientUsers.filter((u) =>
      u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.accesses.some((a) => a.client.name.toLowerCase().includes(q)))
  }, [clientUsers, search])

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/client-users/${id}`),
    onSuccess: () => { toast.success('Acesso desativado'); qc.invalidateQueries({ queryKey: ['client-users'] }) },
    onError: (err) => toast.error(mensagemDeErro(err, 'Não foi possível desativar o acesso')),
  })

  async function deactivate(u: ClientUser) {
    const ok = await askConfirm({ title: `Desativar o acesso de ${u.name}?`, description: 'A pessoa deixa de entrar no portal. O histórico continua registrado.', confirmLabel: 'Desativar', danger: true })
    if (ok) deactivateMutation.mutate(u.id)
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <PageHeader
        back={SETTINGS_BACK}
        title="Acessos ao portal"
        description="Quem, de cada cliente, entra no portal para acompanhar os processos, enviar documentos e ver guias. O acesso é por empresa e departamento."
        actions={<Button onClick={() => navigate('/app/settings/client-users/new')} className="gap-1.5"><Plus size={16} aria-hidden /> Novo acesso</Button>}
      />
      {clientUsers.length > 0 && <SearchField className="mb-3 max-w-sm" label="Buscar acessos" value={search} onChange={setSearch} placeholder="Buscar por pessoa, e-mail ou empresa" />}
      <ListTable<ClientUser>
        label="Acessos ao portal"
        loading={isLoading}
        rows={shown}
        rowKey={(u) => u.id}
        muted={(u) => !u.isActive}
        columns={[
          {
            header: 'Contato', width: 'minmax(0,1.6fr)',
            cell: (u) => (
              <span className="block min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{u.name}</span>
                  {!u.isActive && <StatusTag>Inativo</StatusTag>}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                {u.phone && <span className="block truncate text-xs text-muted-foreground">{u.phone}</span>}
              </span>
            ),
          },
          {
            header: 'Empresas e departamentos', width: 'minmax(0,2.4fr)',
            cell: (u) => (
              <ul className="space-y-0.5">
                {byCompany(u).map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium text-foreground">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.departments.join(', ')}</span>
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
        actions={(u) => (
          <>
            <EditLink to={`/app/settings/client-users/${u.id}/edit`} name={u.name} />
            <ActionMenu label={`Mais ações de ${u.name}`} items={u.isActive ? [{ label: 'Desativar', onSelect: () => void deactivate(u), danger: true }] : []} />
          </>
        )}
        empty={search ? <p className="text-sm text-muted-foreground">Ninguém encontrado com essa busca.</p> : (
          <div className="flex flex-col items-center gap-2">
            <UserCog size={28} aria-hidden className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Cadastre quem, do lado do cliente, vai acompanhar os processos pelo portal.</p>
            <Button size="sm" onClick={() => navigate('/app/settings/client-users/new')}>Cadastrar o primeiro acesso</Button>
          </div>
        )}
      />
    </div>
  )
}
