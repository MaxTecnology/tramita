import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import axios from 'axios'

interface Plan {
  id: string
  name: string
  maxClients: number
  priceMonthly: number
}

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

  const { data: plans = [], isLoading: loadingPlans } = useQuery<Plan[]>({
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
      <div style={{ maxWidth: 800, margin: '48px auto', padding: 24, fontFamily: 'sans-serif' }}>
        <h1 style={{ marginTop: 0 }}>Comece agora — escolha seu plano</h1>
        {loadingPlans ? (
          <p>Carregando planos...</p>
        ) : (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {plans.map((plan) => (
              <div
                key={plan.id}
                onClick={() => { setSelectedPlan(plan); setStep('form') }}
                style={{
                  border: '2px solid #ddd', borderRadius: 12, padding: 24,
                  cursor: 'pointer', minWidth: 200, flex: 1,
                }}
              >
                <h2 style={{ marginTop: 0 }}>{plan.name}</h2>
                <p style={{ fontSize: 28, fontWeight: 700, margin: '8px 0' }}>
                  R$ {Number(plan.priceMonthly).toFixed(2)}
                  <span style={{ fontSize: 14, fontWeight: 400, color: '#666' }}>/mês</span>
                </p>
                <p style={{ color: '#555', marginBottom: 16 }}>Até {plan.maxClients} clientes</p>
                <button style={{ width: '100%', padding: '10px' }}>Escolher</button>
              </div>
            ))}
          </div>
        )}
        <p style={{ marginTop: 24, color: '#666' }}>
          Já tem conta? <a href="/login">Entrar</a>
        </p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 520, margin: '48px auto', padding: 24, fontFamily: 'sans-serif' }}>
      <button
        onClick={() => setStep('plan')}
        style={{ marginBottom: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#0070f3' }}
      >
        ← Voltar para planos
      </button>
      <h1 style={{ marginTop: 0 }}>Criar conta — {selectedPlan?.name}</h1>
      <form onSubmit={handleSubmit}>
        <Field label="Nome do escritório" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
        <Field label="CNPJ" value={form.cnpj} onChange={(v) => setForm({ ...form, cnpj: v })} />
        <Field label="E-mail" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} required />
        <Field label="Telefone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
        <hr style={{ margin: '16px 0', borderColor: '#eee' }} />
        <p style={{ color: '#666', margin: '0 0 8px', fontSize: 13 }}>Dados do administrador</p>
        <Field label="Seu nome" value={form.adminName} onChange={(v) => setForm({ ...form, adminName: v })} required />
        <Field label="Senha" type="password" value={form.adminPassword} onChange={(v) => setForm({ ...form, adminPassword: v })} required />
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ width: '100%', padding: '12px', marginTop: 8 }}>
          {loading ? 'Criando conta...' : 'Criar conta'}
        </button>
      </form>
    </div>
  )
}

function Field({
  label, value, onChange, type = 'text', required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        style={{ display: 'block', width: '100%', padding: '8px', boxSizing: 'border-box' }}
      />
    </div>
  )
}
