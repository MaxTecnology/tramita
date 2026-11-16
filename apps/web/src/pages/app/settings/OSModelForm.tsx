import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Tag, FileText, Settings2, Download, Upload, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PRIORITY_LABEL } from '@/components/shared/TaskDrawer'
import type { OSModel, Department, ObligationType } from '@/types'
import { Section, Field, Segmented, Toggle, DocumentList, fieldCls, type DocumentListItem } from './formBlocks'

type Priority = OSModel['priority']

interface FormState {
  name: string
  description: string
  departmentId: string
  priority: Priority
  deadlineBusinessDays: string
  requiresCompetence: boolean
  autoCompleteOnAllDelivered: boolean
  visibleToClient: boolean
  usableStandalone: boolean
  usableInProcess: boolean
  isActive: boolean
  documentRequests: DocumentListItem[]
  documentDeliveries: DocumentListItem[]
}

const EMPTY_FORM: FormState = {
  name: '', description: '', departmentId: '', priority: 'MEDIUM', deadlineBusinessDays: '',
  requiresCompetence: false, autoCompleteOnAllDelivered: false, visibleToClient: true,
  usableStandalone: true, usableInProcess: false, isActive: true, documentRequests: [], documentDeliveries: [],
}

// Service order model: what an OS asks from the client, what it delivers (robot per delivery), its
// deadline in business days, and where it is used (standalone and/or inside processes)
export default function OSModelForm() {
  const { id } = useParams<{ id: string }>()
  const isEditing = !!id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  const { data: model, isLoading } = useQuery<OSModel>({
    queryKey: ['os-model', id],
    queryFn: () => api.get(`/os-models/${id}`).then((r) => r.data),
    enabled: isEditing,
  })
  const { data: departments = [] } = useQuery<Department[]>({ queryKey: ['departments'], queryFn: () => api.get('/departments').then((r) => r.data) })
  const { data: obligations = [] } = useQuery<ObligationType[]>({
    queryKey: ['document-reader-obrigacoes'],
    queryFn: () => api.get('/document-reader/obrigacoes').then((r) => r.data),
  })

  useEffect(() => {
    if (!model) return
    const docs = (list: OSModel['documentRequests']) => list.map((d) => ({ name: d.name, requiresPayment: d.requiresPayment, obligationTypeId: d.obligationTypeId ?? undefined }))
    setForm({
      name: model.name, description: model.description ?? '', departmentId: model.departmentId, priority: model.priority,
      deadlineBusinessDays: model.deadlineBusinessDays ? String(model.deadlineBusinessDays) : '',
      requiresCompetence: model.requiresCompetence, autoCompleteOnAllDelivered: model.autoCompleteOnAllDelivered,
      visibleToClient: model.visibleToClient, usableStandalone: model.usableStandalone, usableInProcess: model.usableInProcess,
      isActive: model.isActive, documentRequests: docs(model.documentRequests), documentDeliveries: docs(model.documentDeliveries),
    })
  }, [model])

  // The robot matches by client + obligation + competence: a robot delivery forces the competence
  const hasRobot = form.documentDeliveries.some((d) => d.obligationTypeId)
  const requiresCompetence = form.requiresCompetence || hasRobot
  const noUsage = !form.usableStandalone && !form.usableInProcess
  const deadline = form.deadlineBusinessDays.trim() ? Number(form.deadlineBusinessDays) : null
  const deadlineValid = deadline === null || (Number.isInteger(deadline) && deadline >= 1 && deadline <= 365)
  const canSave = form.name.trim().length > 0 && !!form.departmentId && !noUsage && deadlineValid

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(), description: form.description.trim() || null, departmentId: form.departmentId, priority: form.priority,
        deadlineBusinessDays: deadline, requiresCompetence, autoCompleteOnAllDelivered: form.autoCompleteOnAllDelivered,
        visibleToClient: form.visibleToClient, usableStandalone: form.usableStandalone, usableInProcess: form.usableInProcess,
        isActive: form.isActive,
        documentRequests: form.documentRequests.map((d) => ({ name: d.name })),
        documentDeliveries: form.documentDeliveries.map((d) => ({ name: d.name, requiresPayment: !!d.requiresPayment, obligationTypeId: d.obligationTypeId ?? null })),
      }
      return isEditing ? api.patch(`/os-models/${id}`, body) : api.post('/os-models', body)
    },
    onSuccess: () => {
      toast.success(isEditing ? 'Modelo de OS atualizado' : 'Modelo de OS criado')
      qc.invalidateQueries({ queryKey: ['os-models'] })
      navigate('/app/settings/os-models')
    },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao salvar modelo de OS')),
  })

  if (isEditing && isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/app/settings/os-models" aria-label="Voltar" className="text-muted-foreground hover:text-foreground"><ArrowLeft size={18} /></Link>
        <div>
          <h1 className="text-lg md:text-xl font-bold text-foreground">{isEditing ? 'Editar modelo de OS' : 'Novo modelo de OS'}</h1>
          <p className="text-sm text-muted-foreground">Uma OS é uma tarefa só, como a recorrente, mas aberta quando alguém pede.</p>
        </div>
      </div>

      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (canSave) saveMutation.mutate() }}>
        <Section step={1} icon={<Tag size={14} />} title="Identificação">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nome">{(fid) => <Input id={fid} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Recálculo de DAS" />}</Field>
            <Field label="Departamento">
              {(fid) => (
                <select id={fid} className={fieldCls} value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
                  <option value="">Escolha...</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
            </Field>
          </div>
          <Field label="Descrição">{(fid) => <Input id={fid} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Opcional" />}</Field>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-foreground">Prioridade</span>
              <Segmented label="Prioridade" value={form.priority} onChange={(v) => set('priority', v)}
                options={(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
            </div>
            <div className="w-48">
              <Field label="Prazo interno (dias úteis)" hint={!deadlineValid ? 'Entre 1 e 365' : 'Vazio = sem prazo'}>
                {(fid) => <Input id={fid} inputMode="numeric" value={form.deadlineBusinessDays} onChange={(e) => set('deadlineBusinessDays', e.target.value.replace(/\D/g, ''))} placeholder="Ex.: 3" />}
              </Field>
            </div>
          </div>
        </Section>

        <Section step={2} icon={<FileText size={14} />} title="Documentos" hint="O 🤖 na entrega diz qual documento o robô reconhece para preenchê-la.">
          <div className="grid gap-3 md:grid-cols-2">
            <DocumentList title="Documentos a cobrar do cliente" icon={<Download size={14} />} placeholder="Ex.: Extrato bancário"
              items={form.documentRequests} onChange={(v) => set('documentRequests', v)} />
            <DocumentList title="Documentos a entregar ao cliente" icon={<Upload size={14} />} placeholder="Ex.: Guia recalculada"
              items={form.documentDeliveries} onChange={(v) => set('documentDeliveries', v)} withPaymentToggle robotOptions={obligations} />
          </div>
        </Section>

        <Section step={3} icon={<MapPin size={14} />} title="Onde é usada">
          <div className="divide-y divide-border">
            <Toggle checked={form.usableStandalone} onChange={(v) => set('usableStandalone', v)}
              label="Avulsa — o escritório abre e o cliente pode solicitar" hint="Aparece em Nova OS e na lista de serviços do portal." />
            <Toggle checked={form.usableInProcess} onChange={(v) => set('usableInProcess', v)}
              label="Dentro de processos" hint="Pode ser uma etapa de um Modelo de Processo (ex.: Abertura de empresa)." />
          </div>
          {noUsage && <p className="text-xs text-danger-text">Marque onde essa OS é usada</p>}
        </Section>

        <Section step={4} icon={<Settings2 size={14} />} title="Comportamento">
          <div className="divide-y divide-border">
            <label className="flex items-start justify-between gap-4 py-2">
              <span>
                <span className="block text-sm font-medium text-foreground">Pede competência</span>
                <span className="block text-xs text-muted-foreground">{hasRobot ? 'Obrigatório com robô: ele casa o documento pelo mês.' : 'A OS é de um período (ex.: recálculo de 03/2025).'}</span>
              </span>
              <button type="button" role="switch" aria-checked={requiresCompetence} aria-label="Pede competência" disabled={hasRobot}
                onClick={() => set('requiresCompetence', !form.requiresCompetence)}
                className={`relative mt-0.5 h-5 w-9 flex-shrink-0 rounded-full transition-colors disabled:opacity-60 ${requiresCompetence ? 'bg-accent' : 'bg-border'}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${requiresCompetence ? 'left-[1.125rem]' : 'left-0.5'}`} />
              </button>
            </label>
            <Toggle checked={form.autoCompleteOnAllDelivered} onChange={(v) => set('autoCompleteOnAllDelivered', v)}
              label="Concluir sozinha quando tudo for entregue" hint="Documentos do cliente resolvidos e todas as entregas feitas." />
            <Toggle checked={form.visibleToClient} onChange={(v) => set('visibleToClient', v)}
              label="Visível ao cliente" hint="O cliente acompanha a OS e recebe os documentos no portal." />
            <Toggle checked={form.isActive} onChange={(v) => set('isActive', v)} label="Ativo" hint="Inativo não aparece para abrir novas OS." />
          </div>
        </Section>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('/app/settings/os-models')}>Cancelar</Button>
          <Button type="submit" disabled={!canSave || saveMutation.isPending}>{saveMutation.isPending ? 'Salvando...' : 'Salvar'}</Button>
        </div>
      </form>
    </div>
  )
}
