import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Org {
  id: string
  name: string
  email: string
  subscriptionStatus: string
  planName: string
  clientsCount: number
  usersCount: number
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  TRIAL: 'Trial',
  GRACE_PERIOD: 'Carência',
  CANCELLED: 'Cancelada',
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#2a7a2a',
  SUSPENDED: '#c00',
  TRIAL: '#0060a0',
  GRACE_PERIOD: '#a06000',
  CANCELLED: '#666',
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['master', 'organizations'] }),
  })

  if (isLoading) return <p>Carregando escritórios...</p>

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Escritórios ({orgs.length})</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8 }}>
        <thead>
          <tr style={{ background: '#f0f0f0', textAlign: 'left' }}>
            <th style={{ padding: '10px 12px' }}>Nome</th>
            <th style={{ padding: '10px 12px' }}>E-mail</th>
            <th style={{ padding: '10px 12px' }}>Plano</th>
            <th style={{ padding: '10px 12px' }}>Status</th>
            <th style={{ padding: '10px 12px' }}>Clientes</th>
            <th style={{ padding: '10px 12px' }}>Usuários</th>
            <th style={{ padding: '10px 12px' }}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {orgs.map((org) => (
            <tr key={org.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '10px 12px', fontWeight: 500 }}>{org.name}</td>
              <td style={{ padding: '10px 12px', color: '#555' }}>{org.email}</td>
              <td style={{ padding: '10px 12px' }}>{org.planName}</td>
              <td style={{ padding: '10px 12px' }}>
                <span
                  style={{
                    color: STATUS_COLORS[org.subscriptionStatus] ?? '#333',
                    fontWeight: 500,
                  }}
                >
                  {STATUS_LABELS[org.subscriptionStatus] ?? org.subscriptionStatus}
                </span>
              </td>
              <td style={{ padding: '10px 12px' }}>{org.clientsCount}</td>
              <td style={{ padding: '10px 12px' }}>{org.usersCount}</td>
              <td style={{ padding: '10px 12px', display: 'flex', gap: 6 }}>
                {org.subscriptionStatus !== 'SUSPENDED' && (
                  <button
                    style={{ color: '#c00', cursor: 'pointer' }}
                    disabled={patchMutation.isPending}
                    onClick={() =>
                      patchMutation.mutate({
                        id: org.id,
                        data: { subscriptionStatus: 'SUSPENDED' },
                      })
                    }
                  >
                    Suspender
                  </button>
                )}
                {org.subscriptionStatus === 'SUSPENDED' && (
                  <button
                    style={{ color: '#2a7a2a', cursor: 'pointer' }}
                    disabled={patchMutation.isPending}
                    onClick={() =>
                      patchMutation.mutate({
                        id: org.id,
                        data: { subscriptionStatus: 'ACTIVE' },
                      })
                    }
                  >
                    Reativar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
