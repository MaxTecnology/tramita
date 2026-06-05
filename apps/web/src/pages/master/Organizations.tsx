import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface Org {
  id: string
  name: string
  email: string
  subscriptionStatus: string
  planName: string
  clientsCount: number
  usersCount: number
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  TRIAL: 'Trial',
  GRACE_PERIOD: 'Carência',
  CANCELLED: 'Cancelada',
}

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700 hover:bg-green-100',
  SUSPENDED: 'bg-red-100 text-red-700 hover:bg-red-100',
  TRIAL: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
  GRACE_PERIOD: 'bg-amber-100 text-amber-700 hover:bg-amber-100',
  CANCELLED: 'bg-gray-100 text-gray-500 hover:bg-gray-100',
}

export default function MasterOrganizations() {
  const qc = useQueryClient()

  const { data: orgs = [], isLoading } = useQuery<Org[]>({
    queryKey: ['master', 'organizations'],
    queryFn: () => api.get('/master/organizations').then((r) => r.data as Org[]),
  })

  const patchMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, string> }) =>
      api.patch(`/master/organizations/${id}`, data),
    onSuccess: () => {
      toast.success('Escritório atualizado')
      qc.invalidateQueries({ queryKey: ['master', 'organizations'] })
    },
    onError: () => toast.error('Erro ao atualizar escritório'),
  })

  if (isLoading) return <div className="p-8 text-gray-500">Carregando escritórios...</div>

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold text-gray-900 mb-6">
        Escritórios{' '}
        <span className="text-base font-normal text-gray-400">({orgs.length})</span>
      </h1>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['Nome', 'E-mail', 'Plano', 'Status', 'Clientes', 'Usuários', 'Ações'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">{org.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{org.email}</td>
                  <td className="px-4 py-3 text-gray-600">{org.planName}</td>
                  <td className="px-4 py-3">
                    <Badge className={STATUS_CLASS[org.subscriptionStatus] ?? 'bg-gray-100 text-gray-500'}>
                      {STATUS_LABEL[org.subscriptionStatus] ?? org.subscriptionStatus}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{org.clientsCount}</td>
                  <td className="px-4 py-3 text-gray-600">{org.usersCount}</td>
                  <td className="px-4 py-3">
                    {org.subscriptionStatus !== 'SUSPENDED' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-red-600 border-red-200 hover:bg-red-50"
                        disabled={patchMutation.isPending}
                        onClick={() =>
                          patchMutation.mutate({
                            id: org.id,
                            data: { subscriptionStatus: 'SUSPENDED' },
                          })
                        }
                      >
                        Suspender
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-green-700 border-green-200 hover:bg-green-50"
                        disabled={patchMutation.isPending}
                        onClick={() =>
                          patchMutation.mutate({
                            id: org.id,
                            data: { subscriptionStatus: 'ACTIVE' },
                          })
                        }
                      >
                        Reativar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
