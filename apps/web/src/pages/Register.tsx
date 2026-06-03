import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import axios from 'axios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowLeft } from 'lucide-react'

interface Plan { id: string; name: string; maxClients: number; priceMonthly: number }
type Step = 'plan' | 'form'

export default function Register() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('plan')
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '', cnpj: '', email: '', phone: '', adminName: '', adminPassword: '',
  })

  const { data: plans = [], isLoading } = useQuery<Plan[]>({
    queryKey: ['public', 'plans'],
    queryFn: () => api.get('/organizations/plans').then((r) => r.data as Plan[]),
  })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!selectedPlan) return
    setError('')
    setLoading(true)
    try {
      await api.post('/organizations/register', {
        ...form,
        planId: selectedPlan.id,
        cnpj: form.cnpj || undefined,
        phone: form.phone || undefined,
      })
      navigate('/login', { state: { message: 'Cadastro realizado! Faça login para continuar.' } })
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message ?? 'Erro ao cadastrar. Tente novamente.')
      } else {
        setError('Erro inesperado.')
      }
    } finally {
      setLoading(false)
    }
  }

  if (step === 'plan') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
          <HubIcon />
          <span className="font-bold text-[#185FA5]">Tramita</span>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Escolha seu plano</h1>
          <p className="text-gray-500 mb-8">Comece com um trial gratuito. Sem cartão de crédito.</p>

          {isLoading ? (
            <p className="text-gray-400">Carregando planos...</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-3xl">
              {plans.map((plan) => (
                <Card
                  key={plan.id}
                  className="cursor-pointer border-2 hover:border-[#185FA5] transition-colors"
                  onClick={() => { setSelectedPlan(plan); setStep('form') }}
                >
                  <CardContent className="pt-6">
                    <h2 className="text-lg font-bold text-gray-900 mb-1">{plan.name}</h2>
                    <p className="text-3xl font-bold text-[#185FA5] mb-1">
                      R$ {Number(plan.priceMonthly).toFixed(0)}
                      <span className="text-sm font-normal text-gray-500">/mês</span>
                    </p>
                    <p className="text-sm text-gray-500 mb-4">Até {plan.maxClients} clientes</p>
                    <Button className="w-full bg-[#185FA5] hover:bg-[#0C447C] text-white">
                      Escolher
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <p className="mt-8 text-sm text-gray-500">
            Já tem conta?{' '}
            <Link to="/login" className="text-[#185FA5] hover:underline font-medium">Entrar</Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
        <button
          onClick={() => setStep('plan')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft size={16} />
          Planos
        </button>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">{selectedPlan?.name}</span>
      </header>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Criar conta</h1>
          <p className="text-gray-500 text-sm mb-6">
            Plano <strong>{selectedPlan?.name}</strong> — R$ {Number(selectedPlan?.priceMonthly).toFixed(2)}/mês
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="org-name">Nome do escritório</Label>
              <Input
                id="org-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cnpj">
                CNPJ <span className="text-gray-400 font-normal">(opcional)</span>
              </Label>
              <Input
                id="cnpj"
                value={form.cnpj}
                onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-email">E-mail</Label>
              <Input
                id="reg-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">
                Telefone <span className="text-gray-400 font-normal">(opcional)</span>
              </Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            <div className="border-t border-gray-200 pt-4">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
                Administrador da conta
              </p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="admin-name">Seu nome</Label>
                  <Input
                    id="admin-name"
                    value={form.adminName}
                    onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="admin-pass">Senha</Label>
                  <Input
                    id="admin-pass"
                    type="password"
                    value={form.adminPassword}
                    onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                    required
                  />
                </div>
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#185FA5] hover:bg-[#0C447C] text-white"
            >
              {loading ? 'Criando conta...' : 'Criar conta'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}

function HubIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="72" height="72" rx="16" fill="#185FA5" />
      <circle cx="36" cy="36" r="10" fill="white" />
      <circle cx="36" cy="10" r="5" fill="white" opacity="0.85" />
      <circle cx="60" cy="51" r="5" fill="white" opacity="0.85" />
      <circle cx="12" cy="51" r="5" fill="white" opacity="0.85" />
      <line x1="36" y1="26" x2="36" y2="15" stroke="white" strokeWidth="2" opacity="0.7" />
      <line x1="46" y1="42" x2="55" y2="46" stroke="white" strokeWidth="2" opacity="0.7" />
      <line x1="26" y1="42" x2="17" y2="46" stroke="white" strokeWidth="2" opacity="0.7" />
    </svg>
  )
}
