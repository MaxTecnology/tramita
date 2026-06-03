import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'

export default function PortalProfile() {
  const { user } = useAuth()
  const [form, setForm] = useState({ password: '', confirmPassword: '', whatsapp: '' })
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const mutation = useMutation({
    mutationFn: () => {
      const payload: { password?: string; whatsapp?: string } = {}
      if (form.whatsapp) payload.whatsapp = form.whatsapp
      if (form.password) payload.password = form.password
      return api.patch('/portal/profile', payload).then((r) => r.data)
    },
    onSuccess: () => {
      setSuccessMsg('Perfil atualizado com sucesso.')
      setErrorMsg('')
      setForm({ password: '', confirmPassword: '', whatsapp: '' })
    },
    onError: () => {
      setErrorMsg('Erro ao salvar. Verifique os dados e tente novamente.')
    },
  })

  function handleSave() {
    if (form.password && form.password !== form.confirmPassword) {
      setErrorMsg('As senhas não coincidem.')
      return
    }
    mutation.mutate()
  }

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Meu Perfil</h1>

      <Card>
        <CardHeader>
          <CardTitle>Dados da conta</CardTitle>
          <p className="text-sm text-gray-500">{user?.name}</p>
        </CardHeader>
        <CardContent className="space-y-4">
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
          {successMsg && <p className="text-sm text-green-600">{successMsg}</p>}

          <Button onClick={handleSave} disabled={mutation.isPending}>
            Salvar alterações
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
