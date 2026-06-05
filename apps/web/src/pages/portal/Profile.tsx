import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
}

export default function PortalProfile() {
  const { user } = useAuth()
  const [form, setForm] = useState({ password: '', confirmPassword: '', whatsapp: '' })
  const [errorMsg, setErrorMsg] = useState('')

  const mutation = useMutation({
    mutationFn: () => {
      const payload: { password?: string; whatsapp?: string } = {}
      if (form.whatsapp) payload.whatsapp = form.whatsapp
      if (form.password) payload.password = form.password
      return api.patch('/portal/profile', payload).then((r) => r.data)
    },
    onSuccess: () => {
      toast.success('Perfil atualizado')
      setForm({ password: '', confirmPassword: '', whatsapp: '' })
    },
    onError: () => {
      toast.error('Erro ao atualizar perfil')
    },
  })

  function handleSave() {
    if (form.password && form.password !== form.confirmPassword) {
      setErrorMsg('As senhas não coincidem.')
      return
    }
    setErrorMsg('')
    mutation.mutate()
  }

  return (
    <div className="p-4 md:p-6 max-w-lg">
      <h1 className="text-lg md:text-xl font-bold text-gray-900 mb-6">Meu Perfil</h1>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5 space-y-5">
        {/* Avatar + nome */}
        <div className="flex items-center gap-4">
          <div
            className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold text-base"
            style={{ backgroundColor: '#185FA5' }}
          >
            {user?.name ? getInitials(user.name) : '?'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{user?.name}</p>
            {user?.orgName && <p className="text-xs text-gray-500 truncate">{user.orgName}</p>}
          </div>
        </div>

        <hr className="border-gray-100" />

        <div>
          <Label>WhatsApp</Label>
          <Input
            value={form.whatsapp}
            onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
            placeholder="5582999999999"
            className="mt-1"
          />
        </div>

        <div>
          <Label>Nova senha</Label>
          <Input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Deixe em branco para não alterar"
            className="mt-1"
          />
        </div>

        <div>
          <Label>Confirmar nova senha</Label>
          <Input
            type="password"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            className="mt-1"
          />
        </div>

        {errorMsg && <p className="text-sm text-red-500">{errorMsg}</p>}

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={mutation.isPending}
            className="bg-[#185FA5] hover:bg-[#145088] text-white"
          >
            Salvar alterações
          </Button>
        </div>
      </div>
    </div>
  )
}
