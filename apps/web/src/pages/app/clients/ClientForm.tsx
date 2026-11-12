import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn, mensagemDeErro } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import {
  computeClientFormStatus,
  type ClientFormState,
  type ClientType,
  type ClientUserLinkForm,
  type CompanyForm,
  type CoverageRow,
} from './clientFormStatus'

type Tab = 'empresa' | 'departamentos' | 'acesso'

interface Department { id: string; name: string }
interface TeamMember { id: string; name: string }
interface ClientUserSearchResult { id: string; name: string; email: string; phone: string | null }

interface Props {
  initial: ClientFormState
  submitLabel: string
  isSaving: boolean
  onSubmit: (state: ClientFormState) => void
  onCancel: () => void
}

export function ClientForm({ initial, submitLabel, isSaving, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState<ClientFormState>(initial)
  const [tab, setTab] = useState<Tab>('empresa')

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
  })
  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ['team-members'],
    queryFn: () => api.get('/dashboard/team-members').then((r) => r.data),
  })

  const departmentNames = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments])
  const status = computeClientFormStatus(form, departmentNames)

  const tabs: { id: Tab; label: string; complete: boolean }[] = [
    { id: 'empresa', label: 'Empresa', complete: status.empresa },
    { id: 'departamentos', label: 'Departamentos', complete: status.departamentos },
    { id: 'acesso', label: 'Acesso ao portal', complete: status.acesso },
  ]

  function setCompany(patch: Partial<CompanyForm>) {
    setForm((f) => ({ ...f, company: { ...f.company, ...patch } }))
  }

  function toggleDepartment(departmentId: string) {
    setForm((f) => {
      const isServed = f.departments.some((d) => d.departmentId === departmentId)
      if (!isServed) {
        return { ...f, departments: [...f.departments, { departmentId, responsibleUserId: '' }] }
      }
      // Desmarcar tira o departamento também dos acessos dos usuários (só existe acesso a depto atendido).
      return {
        ...f,
        departments: f.departments.filter((d) => d.departmentId !== departmentId),
        clientUsers: f.clientUsers.map((u) => ({ ...u, departmentIds: u.departmentIds.filter((id) => id !== departmentId) })),
      }
    })
  }

  function setResponsible(departmentId: string, responsibleUserId: string) {
    setForm((f) => ({
      ...f,
      departments: f.departments.map((d) => (d.departmentId === departmentId ? { ...d, responsibleUserId } : d)),
    }))
  }

  function setClientUsers(clientUsers: ClientUserLinkForm[]) {
    setForm((f) => ({ ...f, clientUsers }))
  }

  return (
    <div className="space-y-4">
      <div className="flex border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.id ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {!t.complete && <span aria-label="incompleta" className="h-2 w-2 rounded-full bg-danger-text" />}
          </button>
        ))}
      </div>

      {tab === 'empresa' && <CompanyTab company={form.company} onChange={setCompany} />}

      {tab === 'departamentos' && (
        <DepartmentsTab
          departments={departments}
          teamMembers={teamMembers}
          served={form.departments}
          onToggle={toggleDepartment}
          onResponsible={setResponsible}
        />
      )}

      {tab === 'acesso' && (
        <PortalAccessTab
          served={form.departments.map((d) => ({ id: d.departmentId, name: departmentNames.get(d.departmentId) ?? '' }))}
          clientUsers={form.clientUsers}
          coverage={status.coverage}
          onChange={setClientUsers}
        />
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border">
        {!status.canSave && (
          <p className="text-xs text-muted-foreground mr-auto">
            Complete as abas marcadas em vermelho para salvar.
          </p>
        )}
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button
          onClick={() => onSubmit(form)}
          disabled={!status.canSave || isSaving}
          className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
        >
          {isSaving ? 'Salvando...' : submitLabel}
        </Button>
      </div>
    </div>
  )
}

function TypeToggle({ value, onChange }: { value: ClientType; onChange: (v: ClientType) => void }) {
  return (
    <div className="flex rounded-md border border-border overflow-hidden w-fit">
      {(['PJ', 'PF'] as ClientType[]).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={cn(
            'px-4 py-1.5 text-sm font-medium transition-colors',
            value === t ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground hover:bg-neutral-bg',
          )}
        >
          {t === 'PJ' ? 'Pessoa Jurídica' : 'Pessoa Física'}
        </button>
      ))}
    </div>
  )
}

interface CnpjLookupResult {
  razaoSocial: string
  cep: string | null
  estado: string | null
  cidade: string | null
  bairro: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
}

function Field({
  id, label, value, onChange, placeholder, required, className, maxLength,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void
  placeholder?: string; required?: boolean; className?: string; maxLength?: number
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={id}>{label}{required && ' *'}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength} />
    </div>
  )
}

function CompanyTab({ company, onChange }: { company: CompanyForm; onChange: (patch: Partial<CompanyForm>) => void }) {
  const isPJ = company.clientType === 'PJ'
  const cnpjDigits = company.cnpj.replace(/\D/g, '')

  const lookupMutation = useMutation({
    mutationFn: () => api.get<CnpjLookupResult>(`/clients/lookup-cnpj/${cnpjDigits}`).then((r) => r.data),
    onSuccess: (data) => {
      toast.success('Dados do CNPJ carregados')
      onChange({
        name: company.name || data.razaoSocial,
        cep: data.cep ?? company.cep,
        estado: data.estado ?? company.estado,
        cidade: data.cidade ?? company.cidade,
        bairro: data.bairro ?? company.bairro,
        logradouro: data.logradouro ?? company.logradouro,
        numero: data.numero ?? company.numero,
        complemento: data.complemento ?? company.complemento,
      })
    },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao consultar CNPJ')),
  })

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Tipo</Label>
        <TypeToggle value={company.clientType} onChange={(v) => onChange({ clientType: v })} />
      </div>

      {isPJ ? (
        <div className="space-y-1">
          <Label htmlFor="cf-cnpj">CNPJ *</Label>
          <div className="flex gap-2">
            <Input id="cf-cnpj" value={company.cnpj} onChange={(e) => onChange({ cnpj: e.target.value })} placeholder="00.000.000/0001-00" className="flex-1" />
            <Button
              type="button"
              variant="outline"
              disabled={cnpjDigits.length !== 14 || lookupMutation.isPending}
              onClick={() => lookupMutation.mutate()}
              className="gap-1.5 flex-shrink-0"
            >
              <Search size={14} />
              {lookupMutation.isPending ? 'Buscando...' : 'Buscar CNPJ'}
            </Button>
          </div>
        </div>
      ) : (
        <Field id="cf-cpf" label="CPF" required value={company.cpf} onChange={(v) => onChange({ cpf: v })} placeholder="000.000.000-00" />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field id="cf-name" label={isPJ ? 'Razão social' : 'Nome'} required className="sm:col-span-2" value={company.name} onChange={(v) => onChange({ name: v })} />
        <Field id="cf-codigo" label="Código (ERP)" required value={company.codigo} onChange={(v) => onChange({ codigo: v })} placeholder="Ex: 0123" />
      </div>

      {isPJ && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field id="cf-cei" label="CEI" value={company.cei} onChange={(v) => onChange({ cei: v })} placeholder="Opcional" />
          <Field id="cf-caepf" label="CAEPF" value={company.caepf} onChange={(v) => onChange({ caepf: v })} placeholder="Opcional" />
          <Field id="cf-ie" label="Inscrição Estadual" value={company.inscricaoEstadual} onChange={(v) => onChange({ inscricaoEstadual: v })} placeholder="Opcional" />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field id="cf-whatsapp" label="WhatsApp da empresa (contato)" value={company.whatsapp} onChange={(v) => onChange({ whatsapp: v })} placeholder="Opcional" />
        <Field id="cf-phone" label="Telefone fixo" value={company.phone} onChange={(v) => onChange({ phone: v })} placeholder="Opcional" />
      </div>

      <div className="space-y-1">
        <Label htmlFor="cf-notes">Observações internas</Label>
        <textarea
          id="cf-notes"
          value={company.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          rows={2}
          placeholder="Notas visíveis apenas para o escritório..."
          className="flex w-full rounded-md border border-border bg-surface text-foreground px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent resize-none"
        />
      </div>

      <p className="pt-2 border-t border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Endereço {isPJ ? '(obrigatório para pessoa jurídica)' : '(opcional)'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field id="cf-cep" label="CEP" required={isPJ} value={company.cep} onChange={(v) => onChange({ cep: v })} placeholder="57000-000" />
        <Field id="cf-estado" label="Estado" required={isPJ} value={company.estado} onChange={(v) => onChange({ estado: v })} placeholder="AL" maxLength={2} />
        <Field id="cf-cidade" label="Cidade" required={isPJ} value={company.cidade} onChange={(v) => onChange({ cidade: v })} />
        <Field id="cf-bairro" label="Bairro" required={isPJ} value={company.bairro} onChange={(v) => onChange({ bairro: v })} />
        <Field id="cf-logradouro" label="Logradouro" required={isPJ} className="sm:col-span-2" value={company.logradouro} onChange={(v) => onChange({ logradouro: v })} />
        <Field id="cf-numero" label="Número" required={isPJ} value={company.numero} onChange={(v) => onChange({ numero: v })} />
        <Field id="cf-complemento" label="Complemento" value={company.complemento} onChange={(v) => onChange({ complemento: v })} />
      </div>
    </div>
  )
}

function DepartmentsTab({
  departments, teamMembers, served, onToggle, onResponsible,
}: {
  departments: Department[]
  teamMembers: TeamMember[]
  served: ClientFormState['departments']
  onToggle: (departmentId: string) => void
  onResponsible: (departmentId: string, userId: string) => void
}) {
  if (departments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        Cadastre ao menos um departamento em{' '}
        <Link to="/app/settings/departments" className="text-accent hover:underline">Configurações › Departamentos</Link>
        {' '}antes de cadastrar clientes.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Marque os departamentos que atendem este cliente e escolha o responsável do escritório por cada um.
      </p>
      {departments.map((d) => {
        const entry = served.find((s) => s.departmentId === d.id)
        return (
          <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2">
            <label className="flex items-center gap-2 text-sm text-foreground flex-1 min-w-[10rem] cursor-pointer">
              <input type="checkbox" checked={!!entry} onChange={() => onToggle(d.id)} className="h-4 w-4" />
              {d.name}
            </label>
            {entry && (
              <select
                aria-label={`Responsável por ${d.name}`}
                value={entry.responsibleUserId}
                onChange={(e) => onResponsible(d.id, e.target.value)}
                className={cn(
                  'h-8 rounded-md border bg-surface text-foreground px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent',
                  entry.responsibleUserId ? 'border-border' : 'border-danger-text',
                )}
              >
                <option value="">Escolha o responsável…</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            )}
          </div>
        )
      })}
    </div>
  )
}

function PortalAccessTab({
  served, clientUsers, coverage, onChange,
}: {
  served: Department[]
  clientUsers: ClientUserLinkForm[]
  coverage: CoverageRow[]
  onChange: (users: ClientUserLinkForm[]) => void
}) {
  const [mode, setMode] = useState<'search' | 'create'>('create')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState({ name: '', email: '', password: '', phone: '' })
  const allServedIds = served.map((d) => d.id)

  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const { data: results = [] } = useQuery<ClientUserSearchResult[]>({
    queryKey: ['client-user-search', debouncedSearch],
    queryFn: () => api.get('/clients/search-users', { params: { q: debouncedSearch } }).then((r) => r.data),
    enabled: debouncedSearch.length >= 2,
  })

  if (served.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Marque antes os departamentos que atendem o cliente.</p>
  }

  // Usuário novo entra com todos os departamentos atendidos marcados — o caso comum é um contato só.
  function addExisting(u: ClientUserSearchResult) {
    if (clientUsers.some((l) => l.existingId === u.id)) return
    onChange([...clientUsers, { existingId: u.id, name: u.name, email: u.email, phone: u.phone, departmentIds: allServedIds }])
    setSearch('')
  }

  function addNew() {
    onChange([...clientUsers, { ...draft, phone: draft.phone || null, departmentIds: allServedIds }])
    setDraft({ name: '', email: '', password: '', phone: '' })
  }

  function toggleAccess(index: number, departmentId: string) {
    onChange(clientUsers.map((u, i) => {
      if (i !== index) return u
      const has = u.departmentIds.includes(departmentId)
      return { ...u, departmentIds: has ? u.departmentIds.filter((id) => id !== departmentId) : [...u.departmentIds, departmentId] }
    }))
  }

  const draftValid = draft.name.trim().length >= 2 && /\S+@\S+\.\S+/.test(draft.email) && draft.password.length >= 8

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex rounded-md border border-border overflow-hidden w-fit">
          {(['create', 'search'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={cn('px-3 py-1.5 text-sm font-medium', mode === m ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground')}>
              {m === 'create' ? 'Criar novo' : 'Buscar existente'}
            </button>
          ))}
        </div>

        {mode === 'search' ? (
          <div className="space-y-1.5">
            <Input placeholder="Buscar por nome ou e-mail..." value={search} onChange={(e) => setSearch(e.target.value)} />
            {results.length > 0 && (
              <ul className="border border-border rounded-md divide-y divide-border">
                {results.map((u) => (
                  <li key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{u.name} — {u.email}</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => addExisting(u)}>Adicionar</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input aria-label="Nome do usuário" placeholder="Nome" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <Input aria-label="E-mail do usuário" placeholder="E-mail" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            <Input aria-label="Senha do usuário" placeholder="Senha (mín. 8 caracteres)" type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
            <Input aria-label="WhatsApp do usuário" placeholder="WhatsApp (opcional)" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            <Button type="button" variant="outline" className="sm:col-span-2" disabled={!draftValid} onClick={addNew}>
              Adicionar usuário
            </Button>
          </div>
        )}
      </div>

      {clientUsers.length > 0 && (
        <ul className="space-y-2">
          {clientUsers.map((u, i) => (
            <li key={u.existingId ?? `new-${i}`} className="rounded-md border border-border px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-foreground">
                  {u.name} <span className="text-muted-foreground">— {u.email}{u.phone ? ` · ${u.phone}` : ' · sem WhatsApp'}</span>
                  {u.isActive === false && <span className="ml-1 text-xs text-danger-text">(inativo — não conta na cobertura)</span>}
                </span>
                <button type="button" aria-label={`Remover ${u.name}`} onClick={() => onChange(clientUsers.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-danger-text">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {served.map((d) => (
                  <button key={d.id} type="button" onClick={() => toggleAccess(i, d.id)}
                    className={cn('text-xs px-2 py-1 rounded-full border',
                      u.departmentIds.includes(d.id) ? 'bg-[#185FA5] text-white border-[#185FA5]' : 'bg-surface text-muted-foreground border-border')}>
                    {d.name}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cobertura por departamento</p>
        {coverage.map((row) => (
          <div
            key={row.departmentId}
            className={cn(
              'flex items-center justify-between rounded-md px-3 py-1.5 text-sm',
              row.status === 'sem_usuario' && 'bg-danger-bg text-danger-text',
              row.status === 'sem_whatsapp' && 'bg-warning-bg text-warning-text',
              row.status === 'ok' && 'bg-neutral-bg text-foreground',
            )}
          >
            <span>{row.departmentName}</span>
            <span className="text-xs">
              {row.status === 'sem_usuario' && 'Nenhum usuário do cliente — obrigatório'}
              {row.status === 'sem_whatsapp' && `${row.userCount} usuário(s) — ninguém aqui recebe por WhatsApp`}
              {row.status === 'ok' && `${row.userCount} usuário(s), ${row.withPhoneCount} com WhatsApp`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
