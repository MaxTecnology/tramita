import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Building2 } from 'lucide-react'
import { PageHeader, SETTINGS_BACK } from '@/components/ui/page-header'
import { EditButton, ListTable } from '@/components/ui/list-table'
import { ActionMenu } from '@/components/ui/action-menu'
import { toast } from 'sonner'
import type { Department } from '@/types'
import { askConfirm } from '@/components/ui/app-dialogs'

type Row = Department & { peopleCount?: number; clientsCount?: number }

export default function Departments() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [name, setName] = useState('')

  const { data: departments = [], isLoading } = useQuery<Row[]>({
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

  async function remove(d: Row) {
    const ok = await askConfirm({ title: `Excluir o departamento "${d.name}"?`, description: 'Só é possível excluir um departamento sem clientes, tarefas e solicitações ligados a ele.', confirmLabel: 'Excluir', danger: true })
    if (ok) deleteMutation.mutate(d.id)
  }

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <PageHeader
        back={SETTINGS_BACK}
        title="Departamentos"
        description="Áreas do escritório que atendem os clientes. Cada pessoa da equipe enxerga o trabalho dos departamentos dela."
        actions={<Button onClick={openCreate} className="gap-1.5"><Plus size={16} aria-hidden /> Novo departamento</Button>}
      />
      <ListTable<Row>
        label="Departamentos"
        loading={isLoading}
        rows={departments}
        rowKey={(d) => d.id}
        columns={[
          { header: 'Departamento', width: 'minmax(0,2fr)', cell: (d) => <span className="text-sm font-medium text-foreground">{d.name}</span> },
          { header: 'Equipe', width: 'minmax(0,1fr)', cell: (d) => <span className="text-sm text-foreground">{plural(d.peopleCount ?? 0, 'pessoa', 'pessoas')}</span> },
          { header: 'Clientes atendidos', width: 'minmax(0,1fr)', cell: (d) => <span className="text-sm text-foreground">{plural(d.clientsCount ?? 0, 'cliente', 'clientes')}</span> },
        ]}
        actions={(d) => (
          <>
            <EditButton onClick={() => openEdit(d)} name={d.name} />
            <ActionMenu label={`Mais ações de ${d.name}`} items={[{ label: 'Excluir', onSelect: () => void remove(d), danger: true }]} />
          </>
        )}
        empty={(
          <div className="flex flex-col items-center gap-2">
            <Building2 size={28} aria-hidden className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Crie as áreas do escritório, como Fiscal, Pessoal e Contábil.</p>
            <Button size="sm" onClick={openCreate}>Criar o primeiro departamento</Button>
          </div>
        )}
      />

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
