import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Org {
  id: string
  name: string
  email: string
  subscriptionStatus: string
  planName: string
  clientsCount: number
  usersCount: number
}

interface Plan {
  id: string
  name: string
  priceMonthly: number
}

type CreateOrgForm = {
  name: string
  email: string
  phone: string
  cnpj: string
  planId: string
  adminName: string
  createAsaasSubscription: boolean
}

const EMPTY_CREATE_ORG: CreateOrgForm = {
  name: '', email: '', phone: '', cnpj: '', planId: '', adminName: '', createAsaasSubscription: false,
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

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<CreateOrgForm>(EMPTY_CREATE_ORG)
  const [createdPassword, setCreatedPassword] = useState<string | null>(null)

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['organizations', 'plans'],
    queryFn: () => api.get('/organizations/plans').then((r) => r.data as Plan[]),
    enabled: showCreate,
  })

  const createOrgMutation = useMutation({
    mutationFn: () =>
      api.post('/master/organizations', {
        name: createForm.name,
        email: createForm.email,
        phone: createForm.phone || undefined,
        cnpj: createForm.cnpj || undefined,
        planId: createForm.planId,
        adminName: createForm.adminName,
        createAsaasSubscription: createForm.createAsaasSubscription,
      }).then((r) => r.data as { temporaryPassword: string }),
    onSuccess: (data) => {
      toast.success('Organização criada com sucesso')
      qc.invalidateQueries({ queryKey: ['master', 'organizations'] })
      setCreatedPassword(data.temporaryPassword)
    },
    onError: () => toast.error('Erro ao criar organização'),
  })

  function closeCreateDialog() {
    setShowCreate(false)
    setCreateForm(EMPTY_CREATE_ORG)
    setCreatedPassword(null)
  }

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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">
          Escritórios{' '}
          <span className="text-base font-normal text-gray-400">({orgs.length})</span>
        </h1>
        <Button onClick={() => setShowCreate(true)} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
          + Criar organização
        </Button>
      </div>

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

      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) closeCreateDialog() }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          {createdPassword ? (
            <>
              <DialogHeader>
                <DialogTitle>Organização criada</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 mt-2">
                <p className="text-sm text-gray-600">
                  Senha temporária do administrador — repasse para o escritório agora,
                  ela não será mostrada novamente:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-100 rounded px-3 py-2 text-sm font-mono">
                    {createdPassword}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { navigator.clipboard.writeText(createdPassword); toast.success('Copiado') }}
                  >
                    Copiar
                  </Button>
                </div>
                <div className="flex justify-end pt-2">
                  <Button onClick={closeCreateDialog} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
                    Fechar
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Criar organização</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 mt-2">
                <div className="space-y-1">
                  <Label htmlFor="o-name">Nome do escritório *</Label>
                  <Input id="o-name" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="o-email">E-mail *</Label>
                  <Input id="o-email" type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="o-phone">Telefone</Label>
                  <Input id="o-phone" value={createForm.phone} onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="o-plan">Plano *</Label>
                  <select
                    id="o-plan"
                    value={createForm.planId}
                    onChange={(e) => setCreateForm({ ...createForm, planId: e.target.value })}
                    className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <option value="">Selecione um plano</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} — R$ {p.priceMonthly}/mês</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="o-admin-name">Nome do administrador *</Label>
                  <Input id="o-admin-name" value={createForm.adminName} onChange={(e) => setCreateForm({ ...createForm, adminName: e.target.value })} />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="o-asaas"
                    type="checkbox"
                    checked={createForm.createAsaasSubscription}
                    onChange={(e) => setCreateForm({ ...createForm, createAsaasSubscription: e.target.checked })}
                  />
                  <Label htmlFor="o-asaas">Também criar assinatura na Asaas</Label>
                </div>
                {createForm.createAsaasSubscription && (
                  <div className="space-y-1">
                    <Label htmlFor="o-cnpj">CNPJ *</Label>
                    <Input id="o-cnpj" value={createForm.cnpj} onChange={(e) => setCreateForm({ ...createForm, cnpj: e.target.value })} />
                  </div>
                )}
                {createOrgMutation.isError && (
                  <p className="text-sm text-red-600">Erro ao criar organização. Verifique os dados.</p>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={closeCreateDialog}>Cancelar</Button>
                  <Button
                    onClick={() => createOrgMutation.mutate()}
                    disabled={
                      createOrgMutation.isPending ||
                      !createForm.name || !createForm.email || !createForm.planId || !createForm.adminName ||
                      (createForm.createAsaasSubscription && !createForm.cnpj)
                    }
                    className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
                  >
                    {createOrgMutation.isPending ? 'Criando...' : 'Criar'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
