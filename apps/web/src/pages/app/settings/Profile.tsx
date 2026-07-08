import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { toast } from 'sonner'
import { Lock, Mail } from 'lucide-react'

interface Profile {
  id: string
  name: string
  email: string
  phone: string | null
  role: string
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
}

const ROLE_LABEL: Record<string, string> = {
  MASTER: 'Master',
  ORG_ADMIN: 'Administrador',
  ORG_MANAGER: 'Gerente',
  ORG_MEMBER: 'Colaborador',
}

export default function Profile() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ name: '', phone: '' })
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [pwError, setPwError] = useState('')

  const { data: profile } = useQuery<Profile>({
    queryKey: ['my-profile'],
    queryFn: () => api.get('/auth/me').then((r) => r.data),
  })

  useEffect(() => {
    if (profile) setForm({ name: profile.name, phone: profile.phone ?? '' })
  }, [profile])

  const profileMutation = useMutation({
    mutationFn: () => api.patch('/auth/me', {
      name: form.name || undefined,
      phone: form.phone || undefined,
    }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Perfil atualizado')
      queryClient.invalidateQueries({ queryKey: ['my-profile'] })
    },
    onError: () => toast.error('Erro ao atualizar perfil'),
  })

  const pwMutation = useMutation({
    mutationFn: () => api.post('/auth/change-password', {
      currentPassword: pwForm.currentPassword,
      newPassword: pwForm.newPassword,
    }),
    onSuccess: () => {
      toast.success('Senha alterada com sucesso')
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setPwError('')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Erro ao alterar senha'
      setPwError(msg)
    },
  })

  function handleChangePw() {
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('As senhas não coincidem.')
      return
    }
    setPwError('')
    pwMutation.mutate()
  }

  return (
    <div className="p-4 md:p-6 max-w-lg space-y-6">
      <div>
        <h1 className="text-lg md:text-xl font-bold text-gray-900">Meu Perfil</h1>
        <p className="text-sm text-gray-500 mt-1">Gerencie suas informações pessoais e senha.</p>
      </div>

      {/* Dados pessoais */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Informações pessoais</p>
        </div>
        <div className="px-5 py-5 space-y-4">
          {/* Avatar + role */}
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold text-base flex-shrink-0"
              style={{ backgroundColor: '#185FA5' }}
            >
              {user?.name ? getInitials(user.name) : '?'}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{profile?.name ?? user?.name}</p>
              <span className="text-xs bg-blue-50 text-[#185FA5] font-medium px-2 py-0.5 rounded-full">
                {ROLE_LABEL[profile?.role ?? ''] ?? profile?.role}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="p-name">Nome</Label>
            <Input
              id="p-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="p-email">E-mail</Label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                id="p-email"
                value={profile?.email ?? ''}
                disabled
                className="pl-8 bg-gray-50 text-gray-500 cursor-not-allowed"
              />
            </div>
            <p className="text-xs text-gray-400">O e-mail não pode ser alterado.</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="p-phone">Telefone</Label>
            <Input
              id="p-phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="(82) 99999-9999"
            />
          </div>

          <div className="flex justify-end pt-1">
            <Button
              onClick={() => profileMutation.mutate()}
              disabled={profileMutation.isPending || !form.name}
              className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
            >
              {profileMutation.isPending ? 'Salvando...' : 'Salvar alterações'}
            </Button>
          </div>
        </div>
      </div>

      {/* Alterar senha */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Alterar senha</p>
        </div>
        <div className="px-5 py-5 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="pw-current">Senha atual</Label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                id="pw-current"
                type="password"
                value={pwForm.currentPassword}
                onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                className="pl-8"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="pw-new">Nova senha</Label>
            <Input
              id="pw-new"
              type="password"
              value={pwForm.newPassword}
              onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
              placeholder="Mínimo 8 caracteres"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="pw-confirm">Confirmar nova senha</Label>
            <Input
              id="pw-confirm"
              type="password"
              value={pwForm.confirmPassword}
              onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
            />
          </div>

          {pwError && <p className="text-sm text-red-500">{pwError}</p>}

          <div className="flex justify-end pt-1">
            <Button
              onClick={handleChangePw}
              disabled={pwMutation.isPending || !pwForm.currentPassword || !pwForm.newPassword}
              className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
            >
              {pwMutation.isPending ? 'Alterando...' : 'Alterar senha'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
