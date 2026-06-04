# Frontend Design Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir todos os inline styles das 7 telas sem design por componentes TailwindCSS + shadcn/ui usando a paleta de marca AutoHubs.

**Architecture:** Cada tela é reescrita de forma isolada mantendo 100% da lógica existente (hooks, mutations, state). Nenhum novo componente compartilhado é criado — o HubIcon SVG é definido localmente onde usado (tamanhos e opacidades diferem por contexto). O padrão de referência é o `AppLayout.tsx` que já usa Tailwind corretamente.

**Tech Stack:** React 19, TailwindCSS v4, shadcn/ui (Button, Input, Label, Card, CardContent, CardHeader, CardTitle, Badge), lucide-react, cn utility de `@/lib/utils`.

**Paleta AutoHubs:**
- `#0C447C` — azul escuro (sidebar, brand panel)
- `#185FA5` — azul primário (botões, links, active states)
- `#378ADD` — azul secundário (ícones, accents)
- `#85B7EB` — azul claro (texto secundário em fundos escuros)
- `#B5D4F4` — azul ultralight (texto terciário em fundos escuros)

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `apps/web/src/pages/Login.tsx` | Reescrever | Split layout: painel azul + formulário shadcn |
| `apps/web/src/pages/Register.tsx` | Reescrever | Seleção de plano em cards + formulário shadcn |
| `apps/web/src/pages/master/Layout.tsx` | Reescrever | Sidebar dark brand + nav com NavLink |
| `apps/web/src/pages/master/Dashboard.tsx` | Reescrever | Cards de MRR/Orgs/Churn com shadcn Card |
| `apps/web/src/pages/master/Plans.tsx` | Reescrever | Formulário + tabela com shadcn |
| `apps/web/src/pages/master/Organizations.tsx` | Reescrever | Tabela com Badge de status coloridos |
| `apps/web/src/pages/org/Subscription.tsx` | Reescrever | Cards de plano + histórico em tabela |

---

## Task 1: Login.tsx — Split layout com painel de marca

**Files:**
- Modify: `apps/web/src/pages/Login.tsx`

**Design:** Tela dividida em dois painéis. Esquerda (`hidden lg:flex`): fundo `#0C447C`, ícone hub SVG branco, título "Tramita", subtítulo "by AutoHubs", tagline. Direita: fundo branco, formulário com Label+Input+Button do shadcn. Exibe mensagem de sucesso vinda de `location.state` (usada após registro).

- [ ] **Step 1: Reescrever `apps/web/src/pages/Login.tsx` com o conteúdo abaixo**

```tsx
import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const successMessage = (location.state as { message?: string } | null)?.message
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', { email, password })
      localStorage.setItem('accessToken', data.accessToken)
      localStorage.setItem('refreshToken', data.refreshToken)
      localStorage.setItem('user', JSON.stringify(data.user))
      const role: string = data.user.role
      if (role === 'MASTER') navigate('/master/dashboard')
      else if (role === 'ORG_ADMIN' || role === 'ORG_MANAGER') navigate('/app/dashboard')
      else if (role === 'ORG_MEMBER') navigate('/app/board')
      else navigate('/portal/board')
    } catch {
      setError('E-mail ou senha inválidos')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Brand panel — visible only on lg+ */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#0C447C] flex-col items-center justify-center p-12 text-white">
        <HubIcon size={64} />
        <h1 className="mt-6 text-4xl font-bold tracking-tight">Tramita</h1>
        <p className="mt-2 text-[#85B7EB] text-lg font-light">by AutoHubs</p>
        <p className="mt-8 text-center text-[#B5D4F4] text-sm max-w-xs leading-relaxed">
          Acompanhe processos de legalização entre escritórios contábeis e seus clientes em tempo real.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <HubIcon size={32} />
            <span className="text-xl font-bold text-[#185FA5]">Tramita</span>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 mb-1">Bem-vindo</h2>
          <p className="text-gray-500 text-sm mb-8">Entre com suas credenciais para acessar</p>

          {successMessage && (
            <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              {successMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#185FA5] hover:bg-[#0C447C] text-white"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            Sem conta?{' '}
            <a href="/register" className="text-[#185FA5] hover:underline font-medium">
              Cadastre seu escritório
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

function HubIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="72" height="72" rx="16" fill="#185FA5" fillOpacity="0.35" />
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
```

- [ ] **Step 2: Verificar que os testes unitários continuam passando**

```bash
pnpm --filter web test
```

Expected: `12 passed (5)`

- [ ] **Step 3: Verificar visualmente no browser**

```bash
pnpm --filter web dev
```

Abrir `http://localhost:5173/login`. Verificar: painel azul escuro à esquerda (apenas em tela larga), formulário à direita, botão azul, sem inline styles.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/Login.tsx
git commit -m "feat: redesign Login com split layout e paleta AutoHubs"
```

---

## Task 2: Register.tsx — Seleção de plano + formulário

**Files:**
- Modify: `apps/web/src/pages/Register.tsx`

**Design:** Step 1 (seleção): fundo `bg-gray-50`, header com logo, grid de Cards clicáveis com hover em `border-[#185FA5]`. Step 2 (formulário): header com breadcrumb, Card central com inputs shadcn, seção de admin separada por divisor.

- [ ] **Step 1: Reescrever `apps/web/src/pages/Register.tsx`**

```tsx
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
```

- [ ] **Step 2: Verificar testes**

```bash
pnpm --filter web test
```

Expected: `12 passed (5)`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/Register.tsx
git commit -m "feat: redesign Register com cards de plano e formulário shadcn"
```

---

## Task 3: master/Layout.tsx — Sidebar dark brand

**Files:**
- Modify: `apps/web/src/pages/master/Layout.tsx`

**Design:** Sidebar `bg-[#0C447C]` com logo (hub icon + "AutoHubs / Master"), NavLinks com active state `bg-[#185FA5]`, hover `hover:bg-[#185FA5]`, texto em `text-[#B5D4F4]`. Área principal `bg-gray-50`. Segue o mesmo padrão do `AppLayout.tsx` mas com paleta escura.

- [ ] **Step 1: Reescrever `apps/web/src/pages/master/Layout.tsx`**

```tsx
import { useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { LayoutDashboard, Building2, CreditCard, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function MasterLayout() {
  const { user, isAuthenticated, logout } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'MASTER') {
      navigate('/login', { replace: true })
    }
  }, [isAuthenticated, user, navigate])

  if (!isAuthenticated || user?.role !== 'MASTER') return null

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-56 bg-[#0C447C] flex flex-col flex-shrink-0">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-[#185FA5]">
          <div className="flex items-center gap-2.5">
            <HubIcon />
            <div>
              <p className="text-white font-bold text-sm leading-tight">AutoHubs</p>
              <p className="text-[#85B7EB] text-xs">Master</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          <MasterLink to="/master/dashboard" icon={<LayoutDashboard size={16} />} label="Dashboard" />
          <MasterLink to="/master/plans" icon={<CreditCard size={16} />} label="Planos" />
          <MasterLink to="/master/organizations" icon={<Building2 size={16} />} label="Escritórios" />
        </nav>

        {/* User + logout */}
        <div className="px-3 py-4 border-t border-[#185FA5]">
          <p className="text-[#B5D4F4] text-xs px-3 mb-2 truncate">{user?.name}</p>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-[#85B7EB] hover:bg-[#185FA5] hover:text-white transition-colors"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}

function MasterLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-[#185FA5] text-white font-medium'
            : 'text-[#B5D4F4] hover:bg-[#185FA5] hover:text-white',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}

function HubIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="36" cy="36" r="10" fill="white" />
      <circle cx="36" cy="10" r="5" fill="white" opacity="0.8" />
      <circle cx="60" cy="51" r="5" fill="white" opacity="0.8" />
      <circle cx="12" cy="51" r="5" fill="white" opacity="0.8" />
      <line x1="36" y1="26" x2="36" y2="15" stroke="white" strokeWidth="2" opacity="0.6" />
      <line x1="46" y1="42" x2="55" y2="46" stroke="white" strokeWidth="2" opacity="0.6" />
      <line x1="26" y1="42" x2="17" y2="46" stroke="white" strokeWidth="2" opacity="0.6" />
    </svg>
  )
}
```

- [ ] **Step 2: Verificar testes**

```bash
pnpm --filter web test
```

Expected: `12 passed (5)`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/master/Layout.tsx
git commit -m "feat: redesign MasterLayout com sidebar dark brand AutoHubs"
```

---

## Task 4: master/Dashboard.tsx — Cards de métricas

**Files:**
- Modify: `apps/web/src/pages/master/Dashboard.tsx`

**Design:** Três `Card` do shadcn com ícone colorido, label em cinza, valor em bold. MRR usa ícone `TrendingUp` em `#185FA5`, Orgs usa `Building2` em `#378ADD`, Churn usa `TrendingDown` em vermelho.

- [ ] **Step 1: Reescrever `apps/web/src/pages/master/Dashboard.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { TrendingUp, Building2, TrendingDown } from 'lucide-react'

interface Revenue {
  mrr: number
  totalOrgsAtivas: number
  churn: number
}

export default function MasterDashboard() {
  const { data, isLoading, error } = useQuery<Revenue>({
    queryKey: ['master', 'revenue'],
    queryFn: () => api.get('/master/revenue').then((r) => r.data as Revenue),
  })

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>
  if (error) return <div className="p-8 text-red-500">Erro ao carregar dados.</div>

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="MRR"
          value={`R$ ${(data?.mrr ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          icon={<TrendingUp size={20} />}
          iconColor="#185FA5"
        />
        <StatCard
          label="Orgs Ativas"
          value={String(data?.totalOrgsAtivas ?? 0)}
          icon={<Building2 size={20} />}
          iconColor="#378ADD"
        />
        <StatCard
          label="Churn"
          value={String(data?.churn ?? 0)}
          icon={<TrendingDown size={20} />}
          iconColor="#dc2626"
        />
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  iconColor,
}: {
  label: string
  value: string
  icon: React.ReactNode
  iconColor: string
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-gray-500">{label}</p>
          <span style={{ color: iconColor }}>{icon}</span>
        </div>
        <p className="text-3xl font-bold text-gray-900">{value}</p>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Verificar testes**

```bash
pnpm --filter web test
```

Expected: `12 passed (5)`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/master/Dashboard.tsx
git commit -m "feat: redesign MasterDashboard com cards de métricas shadcn"
```

---

## Task 5: master/Plans.tsx — Formulário + tabela

**Files:**
- Modify: `apps/web/src/pages/master/Plans.tsx`

**Design:** Card com formulário inline de criação. Tabela dentro de Card com `p-0`, cabeçalho `bg-gray-50`, linhas com `border-b last:border-0`. Badge verde para ativo. Botões de ação com `variant="outline"` e cor semântica.

- [ ] **Step 1: Reescrever `apps/web/src/pages/master/Plans.tsx`**

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
```

- [ ] **Step 2: Verificar testes**

```bash
pnpm --filter web test
```

Expected: `12 passed (5)`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/master/Plans.tsx
git commit -m "feat: redesign MasterPlans com formulário e tabela shadcn"
```

---

## Task 6: master/Organizations.tsx — Tabela com badges de status

**Files:**
- Modify: `apps/web/src/pages/master/Organizations.tsx`

**Design:** Tabela dentro de Card. Badge de status com cor semântica por status (verde/ativo, vermelho/suspensa, azul/trial, âmbar/carência, cinza/cancelada). Botões de ação com `variant="outline"` e cor semântica.

- [ ] **Step 1: Reescrever `apps/web/src/pages/master/Organizations.tsx`**

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['master', 'organizations'] }),
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
```

- [ ] **Step 2: Verificar testes**

```bash
pnpm --filter web test
```

Expected: `12 passed (5)`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/master/Organizations.tsx
git commit -m "feat: redesign MasterOrganizations com tabela e badges semânticos"
```

---

## Task 7: org/Subscription.tsx — Cards de assinatura

**Files:**
- Modify: `apps/web/src/pages/org/Subscription.tsx`

**Design:** Card com plano atual (badge de status, info de trial/carência). Seção de troca de plano com grid de cards (border highlight no plano atual). Histórico em tabela dentro de Card.

- [ ] **Step 1: Reescrever `apps/web/src/pages/org/Subscription.tsx`**

```tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Plan { id: string; name: string; maxClients: number; priceMonthly: number }
interface HistoryItem { id: string; event: string; amount: number | null; createdAt: string }
interface SubscriptionData {
  subscriptionStatus: string
  trialEndsAt: string | null
  gracePeriodEndsAt: string | null
  plan: Plan
  clientsCount: number
  subscriptionHistory: HistoryItem[]
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Ativa', SUSPENDED: 'Suspensa', TRIAL: 'Trial',
  GRACE_PERIOD: 'Em carência', CANCELLED: 'Cancelada',
}

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700 hover:bg-green-100',
  SUSPENDED: 'bg-red-100 text-red-700 hover:bg-red-100',
  TRIAL: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
  GRACE_PERIOD: 'bg-amber-100 text-amber-700 hover:bg-amber-100',
  CANCELLED: 'bg-gray-100 text-gray-500 hover:bg-gray-100',
}

export default function OrgSubscription() {
  const navigate = useNavigate()
  const { user, isAuthenticated } = useAuth()
  const qc = useQueryClient()
  const [showChangePlan, setShowChangePlan] = useState(false)

  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'ORG_ADMIN') {
      navigate('/login', { replace: true })
    }
  }, [isAuthenticated, user, navigate])

  const { data, isLoading } = useQuery<SubscriptionData>({
    queryKey: ['org', 'subscription'],
    queryFn: () => api.get('/org/subscription').then((r) => r.data as SubscriptionData),
    enabled: isAuthenticated && user?.role === 'ORG_ADMIN',
  })

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['public', 'plans'],
    queryFn: () => api.get('/organizations/plans').then((r) => r.data as Plan[]),
    enabled: showChangePlan,
  })

  const changePlanMutation = useMutation({
    mutationFn: (planId: string) => api.post('/org/subscription/change-plan', { planId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org', 'subscription'] })
      setShowChangePlan(false)
    },
  })

  if (!isAuthenticated || user?.role !== 'ORG_ADMIN') return null
  if (isLoading) return <div className="p-6 text-gray-500">Carregando...</div>
  if (!data) return null

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Assinatura</h1>

      {/* Current plan */}
      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Plano atual</p>
              <h2 className="text-xl font-bold text-gray-900">{data.plan.name}</h2>
              <p className="text-sm text-gray-500 mt-1">
                Até {data.plan.maxClients} clientes · R$ {Number(data.plan.priceMonthly).toFixed(2)}/mês
              </p>
              <p className="text-sm text-gray-500">
                {data.clientsCount} cliente{data.clientsCount !== 1 ? 's' : ''} ativo{data.clientsCount !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="text-right space-y-1">
              <Badge className={STATUS_CLASS[data.subscriptionStatus] ?? 'bg-gray-100 text-gray-500'}>
                {STATUS_LABEL[data.subscriptionStatus] ?? data.subscriptionStatus}
              </Badge>
              {data.trialEndsAt && (
                <p className="text-xs text-gray-500">
                  Trial expira em {new Date(data.trialEndsAt).toLocaleDateString('pt-BR')}
                </p>
              )}
              {data.gracePeriodEndsAt && (
                <p className="text-xs text-amber-600">
                  Carência até {new Date(data.gracePeriodEndsAt).toLocaleDateString('pt-BR')}
                </p>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setShowChangePlan(!showChangePlan)}
          >
            {showChangePlan ? 'Cancelar' : 'Trocar plano'}
          </Button>
        </CardContent>
      </Card>

      {/* Change plan */}
      {showChangePlan && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Selecione o novo plano</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className={`rounded-lg border-2 p-4 ${
                    plan.id === data.plan.id
                      ? 'border-[#185FA5] bg-blue-50'
                      : 'border-gray-200'
                  }`}
                >
                  <p className="font-semibold text-gray-900">{plan.name}</p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    R$ {Number(plan.priceMonthly).toFixed(2)}/mês
                  </p>
                  <p className="text-xs text-gray-400 mb-3">Até {plan.maxClients} clientes</p>
                  <Button
                    size="sm"
                    className="w-full bg-[#185FA5] hover:bg-[#0C447C] text-white"
                    onClick={() => changePlanMutation.mutate(plan.id)}
                    disabled={plan.id === data.plan.id || changePlanMutation.isPending}
                  >
                    {plan.id === data.plan.id ? 'Plano atual' : 'Selecionar'}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.subscriptionHistory.length === 0 ? (
            <p className="px-6 py-4 text-sm text-gray-500">Nenhum evento registrado.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Evento', 'Valor', 'Data'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.subscriptionHistory.map((h) => (
                  <tr key={h.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 text-gray-700">{h.event.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {h.amount ? `R$ ${Number(h.amount).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(h.createdAt).toLocaleString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Verificar testes**

```bash
pnpm --filter web test
```

Expected: `12 passed (5)`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/org/Subscription.tsx
git commit -m "feat: redesign OrgSubscription com cards e tabela shadcn"
```

---

## Task 8: Verificação visual final

- [ ] **Step 1: Subir dev server**

```bash
pnpm --filter api dev &
pnpm --filter web dev
```

- [ ] **Step 2: Verificar cada tela no browser**

| URL | O que verificar |
|---|---|
| `http://localhost:5173/login` | Painel azul escuro à esquerda, formulário à direita, botão `#185FA5` |
| `http://localhost:5173/register` | Cards de plano com hover azul, formulário com shadcn inputs |
| Login como `master@autohubs.com.br` | Sidebar dark `#0C447C`, links com active state azul |
| `/master/dashboard` | 3 cards de métricas com ícones coloridos |
| `/master/plans` | Card de formulário + tabela com badges |
| `/master/organizations` | Tabela com badges semânticos por status |
| Login como `admin@g2a.com.br` → `/app/settings/subscription` | Cards de plano, badge de status, tabela de histórico |

- [ ] **Step 3: Rodar suite completa de testes**

```bash
pnpm --filter web test
```

Expected: `12 passed (5)`

- [ ] **Step 4: Commit final**

```bash
git add .
git commit -m "chore: verificação visual — design frontend completo"
```
