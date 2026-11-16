import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { homeForRole } from '@/lib/homeForRole'
import { TramitaLogo } from '@/components/brand/TramitaLogo'

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
      navigate(homeForRole(data.user.role))
    } catch {
      setError('E-mail ou senha inválidos')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Brand panel — visible only on lg+ */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#0B1F3F] flex-col items-center justify-center p-12 text-white">
        <h1><img src="/brand/tramita-logo-horizontal-branco.svg" alt="Tramita — Gestão de processos contábeis" className="w-80 max-w-full" /></h1>
        <p className="mt-3 text-[#B8C4D6] text-sm">by AutoHubs</p>
        <p className="mt-8 text-center text-[#B8C4D6] text-sm max-w-xs leading-relaxed">
          Acompanhe processos entre escritórios contábeis e seus clientes em tempo real.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-surface">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden mb-8">
            <TramitaLogo className="h-8 w-auto text-brand" />
          </div>

          <h2 className="text-2xl font-semibold text-foreground mb-1">Bem-vindo</h2>
          <p className="text-muted-foreground text-sm mb-8">Entre com suas credenciais para acessar</p>

          {successMessage && (
            <div className="mb-4 rounded-md bg-success-bg border border-success-text/30 px-4 py-3 text-sm text-success-text">
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
            {error && <p className="text-sm text-danger-text">{error}</p>}
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
