import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { toast } from 'sonner'
import { Lock, Mail, Volume2 } from 'lucide-react'
import { playSound } from '@/lib/sla-sound'

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

const SOUND_LABEL: Record<string, string> = {
  CHIME: 'Toque',
  BELL: 'Sino',
  SOFT_PING: 'Ping suave',
  MUTE: 'Mudo',
  ORG_CUSTOM: 'Som do escritório',
}

interface SlaPreference {
  targetWarningSound: string
  targetWarningVolume: number
  dueCriticalSound: string
  dueCriticalVolume: number
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
      phone: form.phone || null,
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

  const { data: slaPreference } = useQuery<SlaPreference>({
    queryKey: ['sla-preference'],
    queryFn: () => api.get('/sla/preferences').then((r) => r.data),
  })

  const { data: customSound } = useQuery<{ url: string | null }>({
    queryKey: ['sla-custom-sound-url'],
    queryFn: () => api.get('/sla/custom-sound-url').then((r) => r.data),
  })

  // Mudança só de volume não mostra toast — o slider já dá feedback visual (%) a cada pixel do
  // drag, e um toast por pixel seria tão ruidoso quanto a enxurrada de requests que o commit só
  // no soltar do mouse já evita.
  const isVolumeOnlyChange = (data: Partial<SlaPreference>) =>
    Object.keys(data).every((k) => k === 'targetWarningVolume' || k === 'dueCriticalVolume')

  const slaPrefMutation = useMutation({
    mutationFn: (data: Partial<SlaPreference>) => api.patch('/sla/preferences', data).then((r) => r.data),
    onSuccess: (_result, variables) => {
      if (!isVolumeOnlyChange(variables)) toast.success('Preferência de som atualizada')
      queryClient.invalidateQueries({ queryKey: ['sla-preference'] })
    },
    onError: () => toast.error('Erro ao atualizar preferência de som'),
  })

  const [localVolumes, setLocalVolumes] = useState<{ targetWarning?: number; dueCritical?: number }>({})

  const soundOptions = customSound?.url
    ? ['CHIME', 'BELL', 'SOFT_PING', 'MUTE', 'ORG_CUSTOM']
    : ['CHIME', 'BELL', 'SOFT_PING', 'MUTE']

  return (
    <div className="p-4 md:p-6 max-w-lg space-y-6">
      <div>
        <h1 className="text-lg md:text-xl font-bold text-foreground">Meu Perfil</h1>
        <p className="text-sm text-muted-foreground mt-1">Gerencie suas informações pessoais e senha.</p>
      </div>

      {/* Dados pessoais */}
      <div className="bg-surface rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-neutral-bg">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Informações pessoais</p>
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
              <p className="text-sm font-semibold text-foreground">{profile?.name ?? user?.name}</p>
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
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="p-email"
                value={profile?.email ?? ''}
                disabled
                className="pl-8 bg-neutral-bg text-muted-foreground cursor-not-allowed"
              />
            </div>
            <p className="text-xs text-muted-foreground">O e-mail não pode ser alterado.</p>
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
      <div className="bg-surface rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-neutral-bg">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Alterar senha</p>
        </div>
        <div className="px-5 py-5 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="pw-current">Senha atual</Label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
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

      {/* Alertas de prazo */}
      <div className="bg-surface rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-neutral-bg">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Alertas de prazo</p>
        </div>
        <div className="px-5 py-5 space-y-5">
          {(['targetWarning', 'dueCritical'] as const).map((level) => {
            const soundKey = level === 'targetWarning' ? 'targetWarningSound' : 'dueCriticalSound'
            const volumeKey = level === 'targetWarning' ? 'targetWarningVolume' : 'dueCriticalVolume'
            const label = level === 'targetWarning' ? 'Som ao aproximar da meta' : 'Som ao ficar crítico'
            const fallback = level === 'targetWarning' ? 'SOFT_PING' : 'BELL'
            const sound = slaPreference?.[soundKey] ?? fallback
            const savedVolume = slaPreference?.[volumeKey] ?? (level === 'targetWarning' ? 50 : 70)
            const volume = localVolumes[level] ?? savedVolume

            const commitVolume = (v: number) => {
              setLocalVolumes((prev) => ({ ...prev, [level]: undefined }))
              slaPrefMutation.mutate({ [volumeKey]: v })
            }

            return (
              <div key={level} className="space-y-2">
                <Label>{label}</Label>
                <div className="flex items-center gap-2">
                  <select
                    value={sound}
                    onChange={(e) => slaPrefMutation.mutate({ [soundKey]: e.target.value })}
                    className="flex h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-[#185FA5] focus:border-transparent transition"
                  >
                    {soundOptions.map((opt) => (
                      <option key={opt} value={opt}>{SOUND_LABEL[opt]}</option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void playSound(sound, volume, customSound?.url ?? null, fallback)}
                  >
                    <Volume2 size={14} />
                    Testar
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volume}
                    disabled={sound === 'MUTE'}
                    onChange={(e) => setLocalVolumes((prev) => ({ ...prev, [level]: Number(e.target.value) }))}
                    onMouseUp={(e) => commitVolume(Number((e.target as HTMLInputElement).value))}
                    onTouchEnd={(e) => commitVolume(Number((e.target as HTMLInputElement).value))}
                    onKeyUp={(e) => commitVolume(Number((e.target as HTMLInputElement).value))}
                    className="flex-1"
                  />
                  <span className="text-xs text-muted-foreground w-10 text-right">{volume}%</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
