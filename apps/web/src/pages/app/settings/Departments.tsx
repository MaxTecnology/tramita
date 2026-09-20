import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Pencil, Trash2, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Department } from '@/types'

export default function Departments() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [name, setName] = useState('')

  const { data: departments = [], isLoading } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? api.patch(`/departments/${editing.id}`, { name }).then((r) => r.data)
        : api.post('/departments', { name }).then((r) => r.data),
    onSuccess: () => {
      toast.success(editing ? 'Departamento atualizado' : 'Departamento criado')
      qc.invalidateQueries({ queryKey: ['departments'] })
      closeDialog()
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao salvar departamento')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/departments/${id}`),
    onSuccess: () => {
      toast.success('Departamento removido')
      qc.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao remover departamento')
    },
  })

  function openCreate() {
    setEditing(null)
    setName('')
    setOpen(true)
  }

  function openEdit(department: Department) {
    setEditing(department)
    setName(department.name)
    setOpen(true)
  }

  function closeDialog() {
    setOpen(false)
    setEditing(null)
    setName('')
  }

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Departamentos</h1>
        <Button onClick={openCreate} className="gap-2">
          <Plus size={16} />
          Novo departamento
        </Button>
      </div>

      {departments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <Building2 size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhum departamento cadastrado</p>
          <p className="text-xs mt-1">Use o botão acima pra criar o primeiro (ex: Fiscal, Pessoal, Contábil).</p>
        </div>
      ) : (
        <div className="space-y-2">
          {departments.map((d) => (
            <Card key={d.id} className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{d.name}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => openEdit(d)}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-bg hover:text-foreground"
                  aria-label="Editar"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => { if (window.confirm(`Excluir o departamento "${d.name}"?`)) deleteMutation.mutate(d.id) }}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-danger-bg hover:text-danger-text"
                  aria-label="Excluir"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!v) closeDialog() }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar departamento' : 'Novo departamento'}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); if (name.trim()) saveMutation.mutate() }}
            className="space-y-4 mt-2"
          >
            <div className="space-y-1.5">
              <Label htmlFor="dept-name">Nome</Label>
              <Input
                id="dept-name"
                placeholder="Ex: Fiscal"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeDialog}>Cancelar</Button>
              <Button type="submit" disabled={saveMutation.isPending || !name.trim()}>
                {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
