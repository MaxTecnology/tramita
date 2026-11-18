import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SidePanel } from '@/components/ui/side-panel'
import { cn } from '@/lib/utils'

export type EditableRole = 'ORG_MEMBER' | 'ORG_MANAGER'

export interface UserFormValues {
  name: string
  email: string
  phone: string
  role: EditableRole
  departmentIds: string[]
  seesDepartmentWork: boolean
}

export const EMPTY_USER_FORM: UserFormValues = {
  name: '', email: '', phone: '', role: 'ORG_MEMBER', departmentIds: [], seesDepartmentWork: true,
}

const ROLE_OPTIONS: { value: EditableRole; label: string; description: string }[] = [
  {
    value: 'ORG_MEMBER',
    label: 'Colaborador',
    description: 'Trabalha nas próprias tarefas. Pode ver também as dos colegas do departamento, se marcado abaixo.',
  },
  {
    value: 'ORG_MANAGER',
    label: 'Gerente',
    description: 'Vê e redistribui o trabalho dos departamentos dele e pode liberar uma OS antes da dependência.',
  },
]

const sectionTitle = 'text-sm font-semibold text-foreground'

// Create and edit share this panel: data, profile and the departments that define what the person sees.
// The form starts from `initial` when mounted: the page gives it a new `key` for each opening, so a
// reload of the list behind it never wipes what is being typed.
export function UserFormPanel({ open, mode, initial, departments, saving, onClose, onSubmit }: {
  open: boolean
  mode: 'create' | 'edit'
  initial: UserFormValues
  departments: { id: string; name: string }[]
  saving: boolean
  onClose: () => void
  onSubmit: (values: UserFormValues) => void
}) {
  const [form, setForm] = useState<UserFormValues>(initial)
  const set = <K extends keyof UserFormValues>(key: K, value: UserFormValues[K]) => setForm((f) => ({ ...f, [key]: value }))

  const toggleDepartment = (id: string) => set(
    'departmentIds',
    form.departmentIds.includes(id) ? form.departmentIds.filter((d) => d !== id) : [...form.departmentIds, id],
  )
  const valid = form.name.trim().length >= 2 && /\S+@\S+\.\S+/.test(form.email) && form.departmentIds.length > 0

  return (
    <SidePanel
      open={open}
      // While saving it stays open: the answer may carry the new password, shown only once
      onOpenChange={(v) => { if (!v && !saving) onClose() }}
      title={mode === 'create' ? 'Novo usuário' : 'Editar usuário'}
      description={mode === 'create' ? 'A senha de acesso é gerada pelo sistema e mostrada ao cadastrar.' : undefined}
      footer={(
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="submit" form="user-form" disabled={!valid || saving}>
            {saving ? 'Salvando...' : mode === 'create' ? 'Cadastrar' : 'Salvar alterações'}
          </Button>
        </>
      )}
    >
      <form id="user-form" className="space-y-7" onSubmit={(e) => { e.preventDefault(); if (valid && !saving) onSubmit(form) }}>
        <section className="space-y-3">
          <h3 className={sectionTitle}>Dados</h3>
          <div className="space-y-1">
            <Label htmlFor="uf-name">Nome</Label>
            <Input id="uf-name" value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="uf-email">E-mail</Label>
            <Input id="uf-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="off" />
            <p className="text-xs text-muted-foreground">É o login da pessoa no Tramita.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="uf-phone">Telefone (opcional)</Label>
            <Input id="uf-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(82) 99999-9999" inputMode="tel" />
          </div>
        </section>

        <section className="space-y-3">
          <h3 id="uf-role-title" className={sectionTitle}>Perfil</h3>
          <div role="radiogroup" aria-labelledby="uf-role-title" className="grid gap-2">
            {ROLE_OPTIONS.map((o) => {
              const selected = form.role === o.value
              return (
                <label
                  key={o.value}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors',
                    selected ? 'border-accent bg-info-bg/40' : 'border-border hover:bg-neutral-bg',
                  )}
                >
                  <input
                    type="radio"
                    name="uf-role"
                    value={o.value}
                    checked={selected}
                    onChange={() => set('role', o.value)}
                    className="mt-1 accent-[var(--color-accent)]"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">{o.label}</span>
                    <span className="block text-xs text-muted-foreground">{o.description}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className={sectionTitle}>Departamentos</h3>
            <p className="text-xs text-muted-foreground">Define os clientes e o trabalho que a pessoa enxerga.</p>
          </div>
          {departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Cadastre um departamento em Configurações antes de cadastrar a equipe.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {departments.map((d) => {
                const checked = form.departmentIds.includes(d.id)
                return (
                  <label
                    key={d.id}
                    className={cn(
                      'inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors',
                      checked ? 'border-accent bg-info-bg/40 text-foreground' : 'border-border text-muted-foreground hover:bg-neutral-bg',
                    )}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleDepartment(d.id)} className="accent-[var(--color-accent)]" />
                    {d.name}
                  </label>
                )
              })}
            </div>
          )}
          {form.departmentIds.length === 0 && departments.length > 0 && (
            <p className="text-xs text-muted-foreground">Escolha pelo menos um departamento.</p>
          )}
          {form.role === 'ORG_MEMBER' && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-neutral-bg/60 p-3">
              <input
                type="checkbox"
                checked={form.seesDepartmentWork}
                onChange={(e) => set('seesDepartmentWork', e.target.checked)}
                className="mt-1 accent-[var(--color-accent)]"
              />
              <span>
                <span className="block text-sm font-medium text-foreground">Ver o trabalho dos colegas do departamento</span>
                <span className="block text-xs text-muted-foreground">Para cobrir uma falta e assumir as tarefas de quem está fora.</span>
              </span>
            </label>
          )}
        </section>
      </form>
    </SidePanel>
  )
}
