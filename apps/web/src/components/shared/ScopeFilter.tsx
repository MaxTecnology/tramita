import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

// Who I am for the "Minhas · Meu departamento · Todas" filter (GET /users/me)
export interface MyScope {
  role: 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'
  departments: { id: string; name: string }[]
  seesDepartmentWork: boolean
}

export type ScopeView = 'mine' | 'department' | 'all'
export interface ScopeValue { scope: ScopeView; departmentId?: string }

export function canFilterDepartment(me: MyScope): boolean {
  if (me.role === 'ORG_MANAGER') return true
  if (me.role === 'ORG_MEMBER') return me.seesDepartmentWork && me.departments.length > 0
  return me.departments.length > 0
}

function allowedViews(me: MyScope): ScopeView[] {
  return [
    'mine',
    ...(canFilterDepartment(me) ? (['department'] as const) : []),
    ...(me.role === 'ORG_ADMIN' ? (['all'] as const) : []),
  ]
}

function defaultView(me: MyScope): ScopeView {
  if (me.role === 'ORG_ADMIN') return 'all'
  return me.role === 'ORG_MANAGER' ? 'department' : 'mine'
}

const storageKey = (screen: string) => `scope-filter:${screen}`

function read(screen: string): ScopeValue | null {
  try {
    const raw = localStorage.getItem(storageKey(screen))
    return raw ? (JSON.parse(raw) as ScopeValue) : null
  } catch {
    return null
  }
}

// Filter state for one screen, remembered in the browser. A stored value the user can no longer
// use (role or option changed) falls back to the default of their role.
export function useScopeFilter(screen: string, me: MyScope | undefined): [ScopeValue, (v: ScopeValue) => void] {
  const [value, setValue] = useState<ScopeValue>(() => {
    if (!me) return { scope: 'mine' }
    const stored = read(screen)
    const ok = stored && allowedViews(me).includes(stored.scope)
      && (!stored.departmentId || me.departments.some((d) => d.id === stored.departmentId))
    return ok ? stored : { scope: defaultView(me) }
  })

  // `me` arrives after the first render: settle on the role default once it is known
  useEffect(() => {
    if (!me) return
    if (!allowedViews(me).includes(value.scope)) setValue({ scope: defaultView(me) })
  }, [me, value.scope])

  const update = (next: ScopeValue) => {
    setValue(next)
    try {
      localStorage.setItem(storageKey(screen), JSON.stringify(next))
    } catch {
      // private mode / blocked storage: the filter still works for this visit
    }
  }
  return [value, update]
}

const LABEL: Record<ScopeView, string> = { mine: 'Minhas', department: 'Meu departamento', all: 'Todas' }

export function ScopeFilter({ me, value, onChange }: { me: MyScope; value: ScopeValue; onChange: (v: ScopeValue) => void }) {
  const views = allowedViews(me)
  if (views.length < 2) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-md border border-border overflow-hidden">
        {views.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange({ scope: v })}
            className={cn(
              'px-3 py-1.5 text-sm font-medium transition-colors',
              value.scope === v ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground hover:bg-neutral-bg',
            )}
          >
            {LABEL[v]}
          </button>
        ))}
      </div>
      {value.scope === 'department' && me.departments.length > 1 && (
        <select
          aria-label="Departamento"
          value={value.departmentId ?? ''}
          onChange={(e) => onChange({ scope: 'department', ...(e.target.value ? { departmentId: e.target.value } : {}) })}
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
        >
          <option value="">Todos os meus departamentos</option>
          {me.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
    </div>
  )
}

// Query params for the list endpoints (?scope=&departmentId=)
export function scopeParams(value: ScopeValue): Record<string, string> {
  return { scope: value.scope, ...(value.departmentId ? { departmentId: value.departmentId } : {}) }
}
