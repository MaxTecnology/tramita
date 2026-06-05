import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus } from 'lucide-react'
import type { Board, Client } from '@/types'
import { toast } from 'sonner'

interface BoardSummary extends Pick<Board, 'id' | 'title' | 'client' | 'columns'> {}

export default function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', clientId: '' })

  const { data: boards = [], isLoading } = useQuery<BoardSummary[]>({
    queryKey: ['boards'],
    queryFn: () => api.get('/boards').then((r) => r.data),
  })

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
    enabled: open,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/boards', { title: form.title, clientId: form.clientId }).then((r) => r.data),
    onSuccess: (board) => {
      toast.success('Processo criado com sucesso')
      qc.invalidateQueries({ queryKey: ['boards'] })
      setOpen(false)
      setForm({ title: '', clientId: '' })
      navigate(`/app/board/${board.id}`)
    },
    onError: () => toast.error('Erro ao criar processo'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !form.clientId) return
    createMutation.mutate()
  }

  async function handleExportReport(clientId: string, clientName: string) {
    const month = new Date().toISOString().slice(0, 7)
    try {
      const res = await api.get(`/clients/${clientId}/report?month=${month}`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `relatorio-${clientName}-${month}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Relatório não disponível para este período.')
    }
  }

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        {user?.role !== 'CLIENT' && (
          <Button
            onClick={() => setOpen(true)}
            className="bg-[#185FA5] hover:bg-[#0C447C] text-white gap-2"
          >
            <Plus size={16} />
            Novo Processo
          </Button>
        )}
      </div>

      {boards.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg font-medium mb-2">Nenhum processo cadastrado ainda</p>
          <p className="text-sm">Clique em "Novo Processo" para começar</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {boards.map((board) => {
            const allTasks = board.columns?.flatMap((c) => c.tasks ?? []) ?? []
            const doneTasks = allTasks.filter((t) => t.status === 'DONE').length
            const overdueTasks = allTasks.filter(
              (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'DONE',
            ).length
            const progress =
              allTasks.length > 0 ? Math.round((doneTasks / allTasks.length) * 100) : 0

            return (
              <Link key={board.id} to={`/app/board/${board.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardHeader>
                    <CardTitle className="text-base">{board.title}</CardTitle>
                    <p className="text-sm text-gray-500">{board.client?.name}</p>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-2">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Progresso</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                    {overdueTasks > 0 && (
                      <p className="text-xs text-red-500 font-medium mt-2">
                        ⚠ {overdueTasks} tarefa{overdueTasks > 1 ? 's' : ''} vencida
                        {overdueTasks > 1 ? 's' : ''}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        handleExportReport(board.client.id, board.client.name)
                      }}
                      className="mt-2 text-xs text-blue-500 hover:text-blue-700 hover:underline"
                    >
                      Exportar relatório
                    </button>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Processo</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="board-title">Título do processo</Label>
              <Input
                id="board-title"
                placeholder="Ex: Abertura de empresa LTDA"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="board-client">Cliente</Label>
              <select
                id="board-client"
                value={form.clientId}
                onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                required
                className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <option value="">Selecione um cliente</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <p className="text-xs text-gray-400">
              3 colunas padrão serão criadas automaticamente: Pendente → Em andamento → Concluído
            </p>

            {createMutation.isError && (
              <p className="text-sm text-red-600">Erro ao criar processo. Tente novamente.</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || !form.title.trim() || !form.clientId}
                className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
              >
                {createMutation.isPending ? 'Criando...' : 'Criar processo'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
