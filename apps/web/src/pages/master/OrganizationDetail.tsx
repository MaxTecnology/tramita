import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface OrgUser {
  id: string
  name: string
  email: string
  role: string
}

interface OrgDetail {
  id: string
  name: string
  email: string
  planName: string
  subscriptionStatus: string
  clientsCount: number
  usersCount: number
  users: OrgUser[]
}

const ROLE_LABEL: Record<string, string> = {
  MASTER: 'Master', ORG_ADMIN: 'Admin', ORG_MANAGER: 'Gerente', ORG_MEMBER: 'Colaborador',
}

export default function MasterOrganizationDetail() {
  const { id } = useParams<{ id: string }>()
  const [resetPassword, setResetPassword] = useState<string | null>(null)

  const { data: org, isLoading } = useQuery<OrgDetail>({
    queryKey: ['master', 'organizations', id],
    queryFn: () => api.get(`/master/organizations/${id}`).then((r) => r.data as OrgDetail),
  })

  const resetMutation = useMutation({
    mutationFn: (userId: string) =>
      api.post(`/master/organizations/${id}/users/${userId}/reset-password`)
        .then((r) => r.data as { temporaryPassword: string }),
    onSuccess: (data) => setResetPassword(data.temporaryPassword),
    onError: () => toast.error('Erro ao redefinir senha'),
  })

  if (isLoading || !org) return <div className="p-8 text-muted-foreground">Carregando...</div>

  return (
    <div className="p-8">
      <Link to="/master/organizations" className="text-sm text-accent hover:underline">
        ← Voltar
      </Link>
      <h1 className="text-xl font-bold text-foreground mt-2 mb-1">{org.name}</h1>
      <p className="text-sm text-muted-foreground mb-6">{org.email} · {org.planName}</p>

      <Card className="mb-6">
        <CardContent className="p-4 flex gap-6 text-sm">
          <div><span className="text-muted-foreground">Status:</span> <Badge>{org.subscriptionStatus}</Badge></div>
          <div><span className="text-muted-foreground">Clientes:</span> {org.clientsCount}</div>
          <div><span className="text-muted-foreground">Usuários:</span> {org.usersCount}</div>
        </CardContent>
      </Card>

      <h2 className="text-sm font-semibold text-foreground mb-3">Usuários</h2>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-neutral-bg">
                {['Nome', 'E-mail', 'Perfil', 'Ações'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {org.users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">{u.name}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{u.email}</td>
                  <td className="px-4 py-3 text-foreground">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="px-4 py-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resetMutation.isPending}
                      onClick={() => resetMutation.mutate(u.id)}
                    >
                      Redefinir senha
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!resetPassword} onOpenChange={(open) => { if (!open) setResetPassword(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Senha redefinida</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <p className="text-sm text-muted-foreground">
              Nova senha temporária — repasse para o usuário agora, ela não será mostrada novamente:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-neutral-bg rounded px-3 py-2 text-sm font-mono">{resetPassword}</code>
              <Button
                type="button"
                variant="outline"
                onClick={() => { navigator.clipboard.writeText(resetPassword!); toast.success('Copiado') }}
              >
                Copiar
              </Button>
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={() => setResetPassword(null)} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
