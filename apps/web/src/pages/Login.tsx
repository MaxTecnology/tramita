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
      else if (role === 'ORG_MEMBER') navigate('/app/dashboard')
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
          Acompanhe processos entre escritórios contábeis e seus clientes em tempo real.
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
