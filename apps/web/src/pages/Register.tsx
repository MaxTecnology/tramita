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
import { cnpjValido } from '@/lib/documento'
import { TramitaLogo } from '@/components/brand/TramitaLogo'

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


  // Closed by default: AutoHubs creates the office and hands over the access (PUBLIC_SIGNUP_ENABLED)
  const { data: signup, isPending: signupPending } = useQuery<{ enabled: boolean }>({
    queryKey: ['public', 'signup-status'],
    queryFn: () => api.get('/organizations/signup-status').then((r) => r.data as { enabled: boolean }),
  })
  const signupOpen = signup?.enabled === true

  const { data: plans = [], isLoading } = useQuery<Plan[]>({
    queryKey: ['public', 'plans'],
    queryFn: () => api.get('/organizations/plans').then((r) => r.data as Plan[]),
    enabled: signupOpen,
  })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!selectedPlan) return
    // The billing (Asaas) refuses a paid subscription without a valid CNPJ
    if (!form.cnpj.trim()) { setError('Informe o CNPJ do escritório'); return }
    if (!cnpjValido(form.cnpj)) { setError('CNPJ inválido'); return }
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

  if (signupPending) return <div className="min-h-screen bg-background p-8 text-muted-foreground">Carregando...</div>

  if (!signupOpen) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="bg-surface border-b border-border px-6 py-4 flex items-center gap-3">
          <TramitaLogo className="h-6 w-auto text-brand" />
        </header>
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Fale com a gente</h1>
          <p className="text-muted-foreground max-w-md">
            O cadastro do escritório é feito pela nossa equipe, que libera o acesso para você. Escreva para{' '}
            <a href="mailto:contato@autohubs.com.br" className="text-[#185FA5] hover:underline font-medium">contato@autohubs.com.br</a>.
          </p>
          <p className="text-sm text-muted-foreground mt-6">
            Já tem conta? <Link to="/login" className="text-[#185FA5] hover:underline font-medium">Entrar</Link>
          </p>
        </div>
      </div>
    )
  }

  if (step === 'plan') {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="bg-surface border-b border-border px-6 py-4 flex items-center gap-3">
          <TramitaLogo className="h-6 w-auto text-brand" />
        </header>

        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">Escolha seu plano</h1>
          <p className="text-muted-foreground mb-8">Escolha o plano do seu escritório. A cobrança é mensal, por boleto.</p>

          {isLoading ? (
            <p className="text-muted-foreground">Carregando planos...</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-3xl">
              {plans.map((plan) => (
                <Card
                  key={plan.id}
                  className="cursor-pointer border-2 hover:border-[#185FA5] transition-colors"
                  onClick={() => { setSelectedPlan(plan); setStep('form') }}
                >
                  <CardContent className="pt-6">
                    <h2 className="text-lg font-bold text-foreground mb-1">{plan.name}</h2>
                    <p className="text-3xl font-bold text-[#185FA5] mb-1">
                      R$ {Number(plan.priceMonthly).toFixed(0)}
                      <span className="text-sm font-normal text-muted-foreground">/mês</span>
                    </p>
                    <p className="text-sm text-muted-foreground mb-4">Até {plan.maxClients} clientes</p>
                    <Button className="w-full bg-[#185FA5] hover:bg-[#0C447C] text-white">
                      Escolher
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <p className="mt-8 text-sm text-muted-foreground">
            Já tem conta?{' '}
            <Link to="/login" className="text-[#185FA5] hover:underline font-medium">Entrar</Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-surface border-b border-border px-6 py-4 flex items-center gap-3">
        <button
          onClick={() => setStep('plan')}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} />
          Planos
        </button>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium text-foreground">{selectedPlan?.name}</span>
      </header>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold text-foreground mb-1">Criar conta</h1>
          <p className="text-muted-foreground text-sm mb-6">
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
              <Label htmlFor="cnpj">CNPJ</Label>
              <Input
                id="cnpj"
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                value={form.cnpj}
                onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                required
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
                Telefone <span className="text-muted-foreground font-normal">(opcional)</span>
              </Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            <div className="border-t border-border pt-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
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

            {error && <p className="text-sm text-danger-text">{error}</p>}

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
