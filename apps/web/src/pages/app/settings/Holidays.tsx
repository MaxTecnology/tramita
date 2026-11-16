import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, CalendarOff, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import { formatDateOnlyUTC } from '@/lib/dates'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { askConfirm } from '@/components/ui/app-dialogs'

interface HolidayList {
  national: { date: string; name: string }[]
  custom: { id: string; date: string; name: string }[]
}

// The office calendar: national holidays come built in; the office adds municipal/state ones,
// Carnaval, recess. Every deadline in business days (OS, processes, recurring) uses it.
export default function Holidays() {
  const qc = useQueryClient()
  const [year, setYear] = useState(new Date().getFullYear())
  const [date, setDate] = useState('')
  const [name, setName] = useState('')

  const { data, isLoading } = useQuery<HolidayList>({
    queryKey: ['holidays', year],
    queryFn: () => api.get('/holidays', { params: { year } }).then((r) => r.data),
  })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['holidays'] }); qc.invalidateQueries({ queryKey: ['holiday-days'] }) }

  const addMutation = useMutation({
    mutationFn: () => api.post('/holidays', { date, name: name.trim() }),
    onSuccess: () => { toast.success('Feriado adicionado'); setDate(''); setName(''); refresh() },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao adicionar feriado')),
  })
  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/holidays/${id}`),
    onSuccess: () => { toast.success('Feriado removido'); refresh() },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao remover feriado')),
  })

  const rows = [
    ...(data?.national ?? []).map((h) => ({ ...h, id: null as string | null })),
    ...(data?.custom ?? []),
  ].sort((a, b) => a.date.localeCompare(b.date))

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      <div>
        <Link to="/app/settings" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={12} /> Configurações
        </Link>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg md:text-xl font-bold text-foreground">Feriados</h1>
            <p className="text-sm text-muted-foreground">Dias que não contam nos prazos em dias úteis (OS, processos e recorrentes).</p>
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Ano">
            <Button variant="outline" size="sm" onClick={() => setYear(year - 1)} aria-label="Ano anterior">‹</Button>
            <span className="text-sm font-semibold w-12 text-center">{year}</span>
            <Button variant="outline" size="sm" onClick={() => setYear(year + 1)} aria-label="Próximo ano">›</Button>
          </div>
        </div>
      </div>

      <Card className="p-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => { e.preventDefault(); if (date && name.trim()) addMutation.mutate() }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="holiday-date">Data</Label>
            <Input id="holiday-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="space-y-1.5 flex-1 min-w-48">
            <Label htmlFor="holiday-name">Nome</Label>
            <Input id="holiday-name" placeholder="Ex.: Aniversário da cidade" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <Button type="submit" disabled={addMutation.isPending}>Adicionar feriado</Button>
        </form>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-muted-foreground"><CalendarOff size={40} className="mb-2 opacity-40" /><p className="text-sm">Nenhum feriado</p></div>
      ) : (
        <Card className="divide-y divide-border">
          {rows.map((h) => (
            <div key={`${h.date}-${h.name}`} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-sm tabular-nums text-muted-foreground w-24">{formatDateOnlyUTC(h.date)}</span>
              <span className="text-sm text-foreground flex-1">{h.name}</span>
              {h.id ? (
                <button
                  onClick={async () => { if (h.id && await askConfirm({ title: `Remover o feriado "${h.name}"?`, confirmLabel: 'Remover', danger: true })) removeMutation.mutate(h.id) }}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-danger-bg hover:text-danger-text"
                  aria-label={`Remover ${h.name}`}
                >
                  <Trash2 size={14} />
                </button>
              ) : (
                <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-neutral-bg">Nacional</span>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
