import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Board, OSModel } from '@/types'

const selectCls = 'flex h-9 w-full rounded-md border border-border bg-surface px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
const FINISHED = ['DONE', 'DISREGARDED']

type ModelOption = Pick<OSModel, 'id' | 'name' | 'requiresCompetence' | 'usableInProcess' | 'isActive'>

// Adds one more OS to an open process: a model used in processes, the column it is born in and the
// OS of this process it waits for (it only starts when they finish)
export function AddOSDialog({ open, board, onClose }: { open: boolean; board: Pick<Board, 'id' | 'columns' | 'competence'>; onClose: () => void }) {
  const qc = useQueryClient()
  const columns = useMemo(() => [...board.columns].sort((a, b) => a.position - b.position), [board.columns])
  const [osModelId, setOsModelId] = useState('')
  const [columnId, setColumnId] = useState('')
  const [competence, setCompetence] = useState('')
  const [dependsOn, setDependsOn] = useState<string[]>([])

  const { data: models = [] } = useQuery<ModelOption[]>({
    queryKey: ['os-models', 'all'], queryFn: () => api.get('/os-models').then((r) => r.data), enabled: open,
  })
  const usable = models.filter((m) => m.usableInProcess && m.isActive)
  const model = usable.find((m) => m.id === osModelId)
  const openOS = columns.flatMap((c) => c.tasks).filter((t) => t.osModelId && !FINISHED.includes(t.status))
  const column = columnId || columns[0]?.id || ''

  const reset = () => { setOsModelId(''); setColumnId(''); setCompetence(''); setDependsOn([]) }
  const close = () => { reset(); add.reset(); onClose() }

  const add = useMutation({
    mutationFn: () => api.post(`/boards/${board.id}/os`, {
      osModelId, columnId: column, dependsOnTaskIds: dependsOn,
      ...(model?.requiresCompetence && competence ? { competence } : {}),
    }).then((r) => r.data),
    onSuccess: () => {
      toast.success('OS adicionada ao processo')
      qc.invalidateQueries({ queryKey: ['board', board.id] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['os'] })
      close()
    },
  })

  const toggle = (id: string) => setDependsOn((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  // The API takes the process month when none is typed
  const processMonth = board.competence ? `${board.competence.slice(5, 7)}/${board.competence.slice(0, 4)}` : null
  const canAdd = !!model && !!column && (!model.requiresCompetence || !!competence || !!processMonth)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Adicionar OS ao processo</DialogTitle></DialogHeader>
        <form className="space-y-4 mt-2" onSubmit={(e) => { e.preventDefault(); if (canAdd) add.mutate() }}>
          <div className="space-y-1.5">
            <Label htmlFor="add-os-model">Modelo de OS</Label>
            <select id="add-os-model" className={selectCls} value={osModelId} onChange={(e) => setOsModelId(e.target.value)}>
              <option value="">Selecione</option>
              {usable.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-os-column">Coluna</Label>
            <select id="add-os-column" className={selectCls} value={column} onChange={(e) => setColumnId(e.target.value)}>
              {columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          {model?.requiresCompetence && (
            <div className="space-y-1.5">
              <Label htmlFor="add-os-competence">Competência</Label>
              <Input id="add-os-competence" type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} />
              {processMonth && <p className="text-xs text-muted-foreground">Vazio = a do processo ({processMonth})</p>}
            </div>
          )}
          {openOS.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Espera (só começa quando estas terminarem)</legend>
              {openOS.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={dependsOn.includes(t.id)} onChange={() => toggle(t.id)} />
                  {t.title}
                </label>
              ))}
            </fieldset>
          )}
          {add.isError && <p className="text-sm text-danger-text">{mensagemDeErro(add.error, 'Erro ao adicionar OS')}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={close}>Cancelar</Button>
            <Button type="submit" disabled={!canAdd || add.isPending}>Adicionar OS</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
