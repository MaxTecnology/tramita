import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

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
      toast.success('Plano criado')
      qc.invalidateQueries({ queryKey: ['master', 'plans'] })
      setForm({ name: '', maxClients: '', priceMonthly: '' })
    },
    onError: () => toast.error('Erro ao criar plano'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch(`/master/plans/${id}`, { name }),
    onSuccess: () => {
      toast.success('Plano atualizado')
      qc.invalidateQueries({ queryKey: ['master', 'plans'] })
      setEditId(null)
    },
    onError: () => toast.error('Erro ao atualizar plano'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/master/plans/${id}`),
    onSuccess: () => {
      toast.success('Plano removido')
      qc.invalidateQueries({ queryKey: ['master', 'plans'] })
    },
    onError: () => toast.error('Erro ao remover plano'),
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

  if (isLoading) return <div className="p-8 text-gray-500">Carregando planos...</div>

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Planos</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Novo plano</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex gap-3 flex-wrap items-end">
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Nome</label>
              <Input
                placeholder="Ex: Pro"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-36"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Max clientes</label>
              <Input
                type="number"
                placeholder="50"
                value={form.maxClients}
                onChange={(e) =>
                  setForm({ ...form, maxClients: e.target.value ? Number(e.target.value) : '' })
                }
                className="w-32"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Preço/mês (R$)</label>
              <Input
                type="number"
                placeholder="197"
                value={form.priceMonthly}
                onChange={(e) =>
                  setForm({ ...form, priceMonthly: e.target.value ? Number(e.target.value) : '' })
                }
                className="w-36"
                required
              />
            </div>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
            >
              {createMutation.isPending ? 'Criando...' : 'Criar plano'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['Nome', 'Max clientes', 'Preço/mês', 'Status', 'Ações'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {editId === plan.id ? (
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-7 w-36"
                      />
                    ) : (
                      plan.name
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{plan.maxClients}</td>
                  <td className="px-4 py-3 text-gray-600">
                    R$ {Number(plan.priceMonthly).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      className={
                        plan.isActive
                          ? 'bg-green-100 text-green-700 hover:bg-green-100'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-100'
                      }
                    >
                      {plan.isActive ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {editId === plan.id ? (
                        <>
                          <Button
                            size="sm"
                            className="h-7 bg-[#185FA5] hover:bg-[#0C447C] text-white"
                            onClick={() => updateMutation.mutate({ id: plan.id, name: editName })}
                          >
                            Salvar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            onClick={() => setEditId(null)}
                          >
                            Cancelar
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => { setEditId(plan.id); setEditName(plan.name) }}
                        >
                          Editar
                        </Button>
                      )}
                      {plan.isActive && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-red-600 border-red-200 hover:bg-red-50"
                          onClick={() => deleteMutation.mutate(plan.id)}
                        >
                          Desativar
                        </Button>
                      )}
                    </div>
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
