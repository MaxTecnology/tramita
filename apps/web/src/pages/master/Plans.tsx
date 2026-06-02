import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Plan {
  id: string
  name: string
  maxClients: number
  priceMonthly: number
  isActive: boolean
}

interface PlanForm {
  name: string
  maxClients: number | ''
  priceMonthly: number | ''
}

export default function MasterPlans() {
  const qc = useQueryClient()
  const [form, setForm] = useState<PlanForm>({ name: '', maxClients: '', priceMonthly: '' })
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const { data: plans = [], isLoading } = useQuery<Plan[]>({
    queryKey: ['master', 'plans'],
    queryFn: () => api.get('/master/plans').then((r) => r.data as Plan[]),
  })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; maxClients: number; priceMonthly: number }) =>
      api.post('/master/plans', { ...data, features: { pdf: true, sse: true, attachments: true } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['master', 'plans'] })
      setForm({ name: '', maxClients: '', priceMonthly: '' })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch(`/master/plans/${id}`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['master', 'plans'] })
      setEditId(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/master/plans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['master', 'plans'] }),
  })

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.maxClients || !form.priceMonthly) return
    createMutation.mutate({
      name: form.name,
      maxClients: Number(form.maxClients),
      priceMonthly: Number(form.priceMonthly),
    })
  }

  if (isLoading) return <p>Carregando planos...</p>

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Planos</h1>

      <form onSubmit={handleCreate} style={{ marginBottom: 24, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          placeholder="Nome"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          style={{ padding: '6px 10px' }}
        />
        <input
          type="number"
          placeholder="Max clientes"
          value={form.maxClients}
          onChange={(e) => setForm({ ...form, maxClients: e.target.value ? Number(e.target.value) : '' })}
          required
          style={{ padding: '6px 10px', width: 130 }}
        />
        <input
          type="number"
          placeholder="Preço/mês (R$)"
          value={form.priceMonthly}
          onChange={(e) => setForm({ ...form, priceMonthly: e.target.value ? Number(e.target.value) : '' })}
          required
          style={{ padding: '6px 10px', width: 140 }}
        />
        <button type="submit" disabled={createMutation.isPending} style={{ padding: '6px 16px' }}>
          {createMutation.isPending ? 'Criando...' : 'Criar Plano'}
        </button>
      </form>

      <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8 }}>
        <thead>
          <tr style={{ background: '#f0f0f0', textAlign: 'left' }}>
            <th style={{ padding: '10px 12px' }}>Nome</th>
            <th style={{ padding: '10px 12px' }}>Max Clientes</th>
            <th style={{ padding: '10px 12px' }}>Preço/mês</th>
            <th style={{ padding: '10px 12px' }}>Ativo</th>
            <th style={{ padding: '10px 12px' }}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={plan.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '10px 12px' }}>
                {editId === plan.id ? (
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{ padding: '4px 8px' }}
                  />
                ) : (
                  plan.name
                )}
              </td>
              <td style={{ padding: '10px 12px' }}>{plan.maxClients}</td>
              <td style={{ padding: '10px 12px' }}>R$ {Number(plan.priceMonthly).toFixed(2)}</td>
              <td style={{ padding: '10px 12px' }}>{plan.isActive ? 'Sim' : 'Não'}</td>
              <td style={{ padding: '10px 12px', display: 'flex', gap: 6 }}>
                {editId === plan.id ? (
                  <>
                    <button onClick={() => updateMutation.mutate({ id: plan.id, name: editName })}>
                      Salvar
                    </button>
                    <button onClick={() => setEditId(null)}>Cancelar</button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setEditId(plan.id)
                      setEditName(plan.name)
                    }}
                  >
                    Editar
                  </button>
                )}
                {plan.isActive && (
                  <button
                    onClick={() => deleteMutation.mutate(plan.id)}
                    style={{ color: '#c00' }}
                  >
                    Desativar
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
