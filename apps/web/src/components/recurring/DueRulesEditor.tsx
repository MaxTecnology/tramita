import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useMunicipalities } from '@/hooks/useMunicipalities'
import { UFS } from '@/lib/uf'

export type DueScope = 'FEDERAL' | 'STATE' | 'CITY'
export type Roll = 'NONE' | 'FORWARD' | 'BACKWARD'

// One place with its own due day: a state (scope STATE) or a city (scope CITY, cityName for display)
export interface DueRuleDraft {
  uf: string
  ibgeCityCode: number | null
  cityName: string
  dueDayOfPeriod: number
  dueBusinessDayRoll: Roll
}

const ROLL_LABEL: Record<Roll, string> = { NONE: 'Manter', BACKWARD: 'Antecipar', FORWARD: 'Adiar' }
const WEEKDAY: Record<number, string> = { 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado', 7: 'Domingo' }
const selectCls = 'h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60'

export function describeDueRule(rule: DueRuleDraft, scope: DueScope, weekly: boolean): string {
  const place = scope === 'CITY' ? `${rule.cityName} (${rule.uf})` : rule.uf
  const day = weekly
    ? WEEKDAY[rule.dueDayOfPeriod]?.toLowerCase() ?? 'dia inválido para semanal'
    : `dia ${rule.dueDayOfPeriod}`
  return `${place} · ${day} · ${ROLL_LABEL[rule.dueBusinessDayRoll].toLowerCase()}`
}

// Exceptions of the due date by state or city: everything else of the template stays the same
export function DueRulesEditor({ scope, weekly, rules, onChange }: {
  scope: Exclude<DueScope, 'FEDERAL'>
  weekly: boolean
  rules: DueRuleDraft[]
  onChange: (rules: DueRuleDraft[]) => void
}) {
  const [uf, setUf] = useState('')
  const [city, setCity] = useState<number | null>(null)
  const [day, setDay] = useState(weekly ? 5 : 10)
  const [roll, setRoll] = useState<Roll>('NONE')
  const { data: cities = [] } = useMunicipalities(scope === 'CITY' ? uf : null)

  const usedUfs = new Set(rules.map((r) => r.uf))
  const usedCities = new Set(rules.map((r) => r.ibgeCityCode))
  const ufOptions = scope === 'STATE' ? UFS.filter((u) => !usedUfs.has(u)) : UFS
  const cityOptions = cities.filter((c) => !usedCities.has(c.ibgeCode))
  const dayOptions = weekly ? [1, 2, 3, 4, 5, 6, 7] : Array.from({ length: 31 }, (_, i) => i + 1)
  const complete = !!uf && (scope === 'STATE' || city !== null)
  // A monthly day (8–31) kept after switching to weekly: the server refuses it, so say which ones
  const hasInvalid = weekly && rules.some((r) => r.dueDayOfPeriod > 7)
  // A day picked for a monthly template is no weekday: weekly falls back to Friday
  const effectiveDay = weekly && day > 7 ? 5 : day

  function add() {
    if (!complete) return
    const cityName = cities.find((c) => c.ibgeCode === city)?.name ?? ''
    onChange([...rules, { uf, ibgeCityCode: scope === 'CITY' ? city : null, cityName, dueDayOfPeriod: effectiveDay, dueBusinessDayRoll: roll }])
    setUf('')
    setCity(null)
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-neutral-bg/30 p-3">
      <p className="text-sm font-medium text-foreground">{scope === 'STATE' ? 'Datas por estado' : 'Datas por cidade'}</p>
      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem exceções: todos os clientes usam a data padrão acima.</p>
      ) : (
        <ul className="space-y-1">
          {rules.map((r, i) => (
            <li key={`${r.uf}-${r.ibgeCityCode ?? ''}`} className="flex items-center justify-between rounded-md bg-surface px-2.5 py-1.5 text-sm">
              <span className={weekly && r.dueDayOfPeriod > 7 ? 'text-danger-text' : 'text-foreground'}>{describeDueRule(r, scope, weekly)}</span>
              <button
                type="button"
                aria-label={`Remover exceção ${scope === 'CITY' ? r.cityName : r.uf}`}
                onClick={() => onChange(rules.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-danger-text"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {hasInvalid && (
        <p className="text-xs text-danger-text">Remova ou refaça as exceções marcadas: na periodicidade semanal o dia vai de segunda a domingo.</p>
      )}
      <div className={cn('grid gap-2 items-end', scope === 'CITY' ? 'sm:grid-cols-[repeat(4,minmax(0,1fr))_auto]' : 'sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]')}>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>Estado</span>
          <select aria-label="Estado da exceção" value={uf} onChange={(e) => { setUf(e.target.value); setCity(null) }} className={selectCls}>
            <option value="">Selecione</option>
            {ufOptions.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        {scope === 'CITY' ? (
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Cidade</span>
            <select
              aria-label="Cidade da exceção"
              value={city === null ? '' : String(city)}
              disabled={!uf}
              onChange={(e) => setCity(e.target.value ? Number(e.target.value) : null)}
              className={selectCls}
            >
              <option value="">Selecione</option>
              {cityOptions.map((c) => <option key={c.ibgeCode} value={c.ibgeCode}>{c.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>{weekly ? 'Vence toda' : 'Vence no dia'}</span>
          <select aria-label="Dia da exceção" value={effectiveDay} onChange={(e) => setDay(Number(e.target.value))} className={selectCls}>
            {dayOptions.map((d) => <option key={d} value={d}>{weekly ? WEEKDAY[d] : d}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>Fim de semana</span>
          <select aria-label="Se cair no fim de semana (exceção)" value={roll} onChange={(e) => setRoll(e.target.value as Roll)} className={selectCls}>
            {(Object.keys(ROLL_LABEL) as Roll[]).map((r) => <option key={r} value={r}>{ROLL_LABEL[r]}</option>)}
          </select>
        </label>
        <Button type="button" size="sm" variant="outline" onClick={add} disabled={!complete} className="gap-1">
          <Plus size={14} /> Adicionar exceção
        </Button>
      </div>
    </div>
  )
}
