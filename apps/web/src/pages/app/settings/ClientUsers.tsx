import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Plus, Pencil, Trash2, UserCog } from 'lucide-react'
import { toast } from 'sonner'
import type { ClientUser } from '@/types'

export default function ClientUsers() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: clientUsers = [], isLoading } = useQuery<ClientUser[]>({
    queryKey: ['client-users'],
    queryFn: () => api.get('/client-users').then((r) => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/client-users/${id}`),
    onSuccess: () => {
      toast.success('Usuário desativado')
      qc.invalidateQueries({ queryKey: ['client-users'] })
    },
  })

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Usuários de Cliente</h1>
        <Button onClick={() => navigate('/app/settings/client-users/new')} className="gap-2">
          <Plus size={16} />
          Novo usuário
        </Button>
      </div>

      {clientUsers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <UserCog size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhum usuário de cliente cadastrado</p>
          <p className="text-xs mt-1">Cadastre quem, do lado do cliente, vai acessar o portal e quais departamentos pode ver.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {clientUsers.map((u) => (
            <Card key={u.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{u.name}</span>
                  {!u.isActive && <span className="text-xs px-1.5 py-0.5 rounded-full bg-neutral-bg text-muted-foreground">Inativo</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{u.email}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {u.accesses.map((a) => `${a.client.name} (${a.department.name})`).join(', ')}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Link to={`/app/settings/client-users/${u.id}/edit`} className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-bg hover:text-foreground" aria-label="Editar">
                  <Pencil size={14} />
                </Link>
                <button
                  onClick={() => { if (window.confirm(`Desativar "${u.name}"?`)) deleteMutation.mutate(u.id) }}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-danger-bg hover:text-danger-text"
                  aria-label="Excluir"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
