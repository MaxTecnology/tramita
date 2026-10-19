// apps/web/src/pages/app/settings/DocumentModelForm.tsx
import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { mensagemDeErro } from '@/lib/utils'
import type { DocumentoExtraido, DocumentoExtraidoItem, ObligationType } from '@/types'

interface Ancora { texto: string; pagina: number; x: number; y: number }
// Mesmo union do backend (zonaSchema.tipo em document-reader-models.schema.ts).
type TipoCampo = 'cnpj' | 'data' | 'competencia' | 'periodo_apuracao' | 'moeda' | 'texto'
interface Zona { campo: string; pagina: number; x: number; y: number; w: number; h: number; tipo: TipoCampo; opcional?: boolean }

// O motor (engine/pipeline.ts) lê o período pelo NOME literal do campo — "pa" ou "competencia" —
// não pelo tipo. Por isso "Período (trimestral)" é um 5º campo PADRÃO com nome travado em "pa",
// não um tipo disponível no campo customizado abaixo: um campo customizado chamado "trimestre" do
// tipo periodo_apuracao nunca seria lido pelo motor, porque ele nunca olha uma chave "trimestre".
const CAMPOS_PADRAO: { campo: string; label: string; tipo: TipoCampo }[] = [
  { campo: 'cnpj', label: 'CNPJ', tipo: 'cnpj' },
  { campo: 'competencia', label: 'Competência', tipo: 'competencia' },
  { campo: 'pa', label: 'Período (trimestral)', tipo: 'periodo_apuracao' },
  { campo: 'vencimento', label: 'Vencimento', tipo: 'data' },
  { campo: 'valor', label: 'Valor', tipo: 'moeda' },
]

// Tipos disponíveis pro campo CUSTOMIZADO (nome livre) — sem cnpj/competencia/periodo_apuracao,
// que só fazem sentido com o nome exato que os campos padrão acima já travam. Campo customizado é
// só pra informação extra que o motor não precisa casar por nome (ex.: "numero_documento").
const TIPOS_CAMPO: { tipo: TipoCampo; label: string }[] = [
  { tipo: 'data', label: 'Data' },
  { tipo: 'moeda', label: 'Valor em dinheiro' },
  { tipo: 'texto', label: 'Texto livre' },
]

// Nomes travados pelos campos padrão acima — um campo "customizado" com um desses nomes
// substituiria silenciosamente a zona padrão (campoJaMarcado só olha o nome), derrubando
// temCnpj/temPeriodo sem nenhuma explicação pro usuário. Bloqueado no input em vez disso.
const NOMES_RESERVADOS = new Set(CAMPOS_PADRAO.map((c) => c.campo))

type Alvo = { modo: 'ancora' } | { modo: 'campo'; campo: string; tipo: TipoCampo } | null

export default function DocumentModelForm() {
  const { id } = useParams<{ id: string }>()
  const isEditing = !!id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [extraido, setExtraido] = useState<DocumentoExtraido | null>(null)
  const [pagina, setPagina] = useState(0)
  const [nome, setNome] = useState('')
  const [obligationTypeId, setObligationTypeId] = useState('')
  const [novaObrigacaoNome, setNovaObrigacaoNome] = useState('')
  const [mostrarNovaObrigacao, setMostrarNovaObrigacao] = useState(false)
  const [ancoras, setAncoras] = useState<Ancora[]>([])
  const [zonas, setZonas] = useState<Zona[]>([])
  const [alvo, setAlvo] = useState<Alvo>(null)
  const [novoCampoNome, setNovoCampoNome] = useState('')
  const [novoCampoTipo, setNovoCampoTipo] = useState<TipoCampo>('texto')
  const [mostrarNovoCampo, setMostrarNovoCampo] = useState(false)

  const { data: obrigacoes = [], refetch: refetchObrigacoes } = useQuery<ObligationType[]>({
    queryKey: ['document-reader-obrigacoes'],
    queryFn: () => api.get('/document-reader/obrigacoes').then((r) => r.data),
  })

  // Busca a lista inteira e filtra pelo id no cliente, em vez de um GET /modelos/:id dedicado —
  // list já é pequena (modelos de uma org); ver Nota 2 do plano (Task 8) pra justificativa.
  const { data: modelos, isError: erroAoCarregarModelo } = useQuery<{ id: string; nome: string; obligationType: { id: string } }[]>({
    queryKey: ['document-models'],
    queryFn: () => api.get('/document-reader/modelos').then((r) => r.data),
    enabled: isEditing,
  })

  useEffect(() => {
    if (!modelos) return
    const modelo = modelos.find((m) => m.id === id)
    if (modelo) { setNome(modelo.nome); setObligationTypeId(modelo.obligationType.id) }
    else toast.error('Modelo não encontrado')
  }, [modelos, id])

  useEffect(() => {
    if (erroAoCarregarModelo) toast.error('Erro ao carregar modelo')
  }, [erroAoCarregarModelo])

  const analisarMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post<DocumentoExtraido>('/document-reader/modelos/analisar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data)
    },
    onSuccess: (data) => { setExtraido(data); setPagina(0) },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao ler o PDF')),
  })

  const criarObrigacaoMutation = useMutation({
    mutationFn: (payload: { code: string; name: string }) => api.post<ObligationType>('/document-reader/obrigacoes', payload).then((r) => r.data),
    onSuccess: (obrigacao) => {
      toast.success('Obrigação criada')
      setObligationTypeId(obrigacao.id)
      setMostrarNovaObrigacao(false)
      setNovaObrigacaoNome('')
      refetchObrigacoes()
    },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao criar obrigação')),
  })

  const salvarMutation = useMutation({
    mutationFn: async () => {
      const payload = { nome, obligationTypeId, ancoras, zonas }

      // Aviso não-bloqueante: se a amostra também bate com outro modelo ativo da org, salvar
      // mesmo assim pode fazer o motor empatar entre os dois e parar de reconhecer documentos
      // que hoje já funcionam (ver nota em verificarColisaoModelo, document-reader-models.service.ts).
      // Falha na própria checagem não deve impedir o salvar — é só um aviso.
      if (extraido) {
        try {
          const { data } = await api.post<{ modelosColidentes: { id: string; nome: string }[] }>(
            '/document-reader/modelos/verificar-colisao',
            { paginas: extraido.paginas, ancoras, excluirModeloId: isEditing ? id : undefined },
          )
          if (data.modelosColidentes.length > 0) {
            toast.warning(
              `Essa amostra também bate com "${data.modelosColidentes.map((m) => m.nome).join('", "')}" — salvar pode fazer o robô parar de reconhecer documentos desse(s) modelo(s) de forma automática.`,
              { duration: 10000 },
            )
          }
        } catch {
          // checagem é só um aviso — se falhar, segue pro salvar normal sem travar o fluxo.
        }
      }

      return isEditing
        ? api.patch(`/document-reader/modelos/${id}`, payload)
        : api.post('/document-reader/modelos', payload)
    },
    onSuccess: () => {
      toast.success(isEditing ? 'Modelo atualizado' : 'Modelo criado')
      qc.invalidateQueries({ queryKey: ['document-models'] })
      navigate('/app/settings/document-models')
    },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao salvar modelo')),
  })

  const paginaAtual = extraido?.paginas[pagina]

  // O backend rejeita x/y/w/h fora de [0,1] (document-reader-models.schema.ts). O pdf.js já
  // normaliza nessa faixa, mas arredondamento de ponto flutuante pode passar de 1 por uma
  // fração mínima — clampar aqui evita um 400 no Salvar por causa de um item legítimo.
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

  // A validação com conjunto separado da Task 15 do Plano A já mostrou o motor perder campos em
  // variações pequenas de layout (ex.: CNPJ com nome de filial mais longo empurra o texto um
  // pouco pra fora da zona marcada). O clique do admin marca o tamanho EXATO do item nesse PDF de
  // amostra — sem folga, qualquer documento real um pouco diferente já cai fora. MARGEM_ZONA
  // expande w/h em 20% (10% de cada lado) ao redor do item clicado, igual intenção da margem fixa
  // que `textoDaZona` (engine/zonal.ts) já aplica no motor, mas proporcional ao tamanho do campo
  // em vez de um valor fixo de página — campos maiores (ex. nome) precisam de mais folga que
  // campos pequenos (ex. CNPJ).
  const MARGEM_ZONA = 0.1
  function expandirZona(item: DocumentoExtraidoItem) {
    const mx = item.w * MARGEM_ZONA
    const my = item.h * MARGEM_ZONA
    return {
      x: clamp01(item.x - mx),
      y: clamp01(item.y - my),
      w: clamp01(item.w + mx * 2),
      h: clamp01(item.h + my * 2),
    }
  }

  function aoClicarItem(item: DocumentoExtraidoItem) {
    if (!alvo) return
    if (alvo.modo === 'ancora') {
      const x = clamp01(item.x)
      const y = clamp01(item.y)
      // texto+pagina sozinhos colidem quando dois itens do PDF têm o mesmo texto na mesma
      // página (ex.: cabeçalho repetido em tabela) — x/y do item clicado desempatam, já que
      // dois itens nunca ocupam exatamente a mesma posição.
      const existe = ancoras.some((a) => a.texto === item.str && a.pagina === (paginaAtual?.numero ?? 1) && a.x === x && a.y === y)
      if (existe) {
        setAncoras(ancoras.filter((a) => !(a.texto === item.str && a.pagina === (paginaAtual?.numero ?? 1) && a.x === x && a.y === y)))
      } else {
        setAncoras([...ancoras, { texto: item.str, pagina: paginaAtual?.numero ?? 1, x, y }])
      }
      return
    }
    const { x, y, w, h } = expandirZona(item)
    setZonas([
      ...zonas.filter((z) => z.campo !== alvo.campo),
      { campo: alvo.campo, pagina: paginaAtual?.numero ?? 1, x, y, w, h, tipo: alvo.tipo },
    ])
    setAlvo(null)
  }

  const campoJaMarcado = (campo: string) => zonas.some((z) => z.campo === campo)
  // Mesma regra de validarCamposObrigatorios() no backend (document-reader-models.service.ts,
  // Task 3, corrigida pra exigir nome E tipo juntos — o motor lê os campos por nome literal, não
  // por tipo): "cnpj"/tipo cnpj é obrigatório; "competencia"/tipo competencia OU "pa"/tipo
  // periodo_apuracao serve pro período. Os botões de CAMPOS_PADRAO acima já travam nome+tipo
  // juntos, então checar só o nome do campo aqui já basta (campo customizado nunca usa esses
  // nomes — ver TIPOS_CAMPO).
  const temCnpj = zonas.some((z) => z.campo === 'cnpj' && z.tipo === 'cnpj')
  const temPeriodo = zonas.some((z) => (z.campo === 'competencia' && z.tipo === 'competencia') || (z.campo === 'pa' && z.tipo === 'periodo_apuracao'))
  const podeSalvar = nome.trim() && obligationTypeId && ancoras.length > 0 && temCnpj && temPeriodo

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <Link to="/app/settings/document-models" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
        <ArrowLeft size={12} /> Modelos de Documento
      </Link>
      <h1 className="text-lg md:text-xl font-bold text-foreground mb-4">
        {isEditing ? 'Editar modelo' : 'Novo modelo'}
      </h1>

      {!extraido ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Suba um PDF de amostra do documento que o robô vai aprender a reconhecer. O arquivo não
            é salvo — só usamos o texto dele pra você marcar os campos.
          </p>
          <Button onClick={() => fileInputRef.current?.click()} disabled={analisarMutation.isPending}>
            {analisarMutation.isPending ? 'Lendo...' : 'Escolher PDF de amostra'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) analisarMutation.mutate(file)
              e.target.value = ''
            }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          <div className="space-y-3">
            {extraido.paginas.length > 1 && (
              <div className="flex gap-2 items-center text-sm">
                <span className="text-muted-foreground">Página:</span>
                {extraido.paginas.map((p, i) => (
                  <button
                    key={p.numero}
                    onClick={() => setPagina(i)}
                    className={`px-2 py-1 rounded ${i === pagina ? 'bg-accent text-accent-foreground' : 'bg-neutral-bg text-muted-foreground'}`}
                  >
                    {p.numero}
                  </button>
                ))}
              </div>
            )}

            {alvo && (
              <p className="text-xs text-accent font-medium">
                {alvo.modo === 'ancora' ? 'Clique num texto fixo do documento pra marcar como âncora.' : `Clique no valor do campo "${alvo.campo}".`}
              </p>
            )}

            <div
              className="relative w-full bg-surface border border-border rounded-md overflow-hidden"
              style={{ aspectRatio: paginaAtual?.largura && paginaAtual?.altura ? `${paginaAtual.largura} / ${paginaAtual.altura}` : '210 / 297' }}
            >
              {paginaAtual?.itens.map((item, i) => {
                const ehAncora = ancoras.some((a) => a.texto === item.str && a.pagina === (paginaAtual?.numero ?? 1) && a.x === clamp01(item.x) && a.y === clamp01(item.y))
                // zona.x/y/w/h não são mais os mesmos do item clicado (expandirZona adiciona
                // MARGEM_ZONA) — achar pelo centro do item caindo dentro do retângulo da zona, não
                // por igualdade de coordenada.
                const cx = item.x + item.w / 2
                const cy = item.y + item.h / 2
                const zonaDoItem = zonas.find((z) =>
                  z.pagina === (paginaAtual?.numero ?? 1) &&
                  cx >= z.x && cx <= z.x + z.w &&
                  cy >= z.y && cy <= z.y + z.h
                )
                return (
                  <div
                    key={i}
                    onClick={() => aoClicarItem(item)}
                    className={`absolute text-[8px] leading-none whitespace-nowrap overflow-hidden cursor-pointer rounded-sm ${
                      ehAncora ? 'bg-accent/30 outline outline-1 outline-accent' : zonaDoItem ? 'bg-success-bg' : 'text-foreground hover:bg-accent/20'
                    }`}
                    style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.w * 100}%`, height: `${item.h * 100}%` }}
                    title={zonaDoItem ? `Campo: ${zonaDoItem.campo}` : item.str}
                  >
                    {item.str}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Nome do modelo</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Recibo de Pagamento RH" />
            </div>

            <div className="space-y-1">
              <Label>Obrigação</Label>
              {mostrarNovaObrigacao ? (
                <div className="space-y-1">
                  <Input value={novaObrigacaoNome} onChange={(e) => setNovaObrigacaoNome(e.target.value)} placeholder="Nome da nova obrigação" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => criarObrigacaoMutation.mutate({ code: novaObrigacaoNome, name: novaObrigacaoNome })} disabled={!novaObrigacaoNome.trim()}>
                      Criar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setMostrarNovaObrigacao(false)}>Cancelar</Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={obligationTypeId}
                    onChange={(e) => setObligationTypeId(e.target.value)}
                    className="h-9 flex-1 rounded-md border border-border bg-surface text-foreground px-2 text-sm"
                  >
                    <option value="">Selecione</option>
                    {obrigacoes.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <Button size="sm" variant="outline" onClick={() => setMostrarNovaObrigacao(true)}>+ Nova</Button>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label>Âncoras ({ancoras.length})</Label>
              <p className="text-xs text-muted-foreground">Textos fixos que identificam esse layout.</p>
              <Button size="sm" variant={alvo?.modo === 'ancora' ? 'default' : 'outline'} onClick={() => setAlvo(alvo?.modo === 'ancora' ? null : { modo: 'ancora' })}>
                {alvo?.modo === 'ancora' ? 'Marcando... (clique de novo pra parar)' : 'Marcar âncoras'}
              </Button>
              {ancoras.map((a, i) => (
                <p key={i} className="text-xs text-muted-foreground truncate">«{a.texto}»</p>
              ))}
            </div>

            <div className="space-y-1">
              <Label>Campos</Label>
              {CAMPOS_PADRAO.map((c) => (
                <div key={c.campo} className="flex items-center justify-between text-xs">
                  <span className={campoJaMarcado(c.campo) ? 'text-foreground' : 'text-muted-foreground'}>
                    {c.label} {campoJaMarcado(c.campo) && '✓'}
                  </span>
                  <Button size="sm" variant={alvo?.modo === 'campo' && alvo.campo === c.campo ? 'default' : 'outline'} onClick={() => setAlvo({ modo: 'campo', campo: c.campo, tipo: c.tipo })}>
                    Marcar
                  </Button>
                </div>
              ))}
              {zonas.filter((z) => !CAMPOS_PADRAO.some((c) => c.campo === z.campo)).map((z) => (
                <div key={z.campo} className="flex items-center justify-between text-xs">
                  <span className="text-foreground">{z.campo} ✓</span>
                  <Button size="sm" variant="ghost" onClick={() => setZonas(zonas.filter((x) => x.campo !== z.campo))}>Remover</Button>
                </div>
              ))}

              {mostrarNovoCampo ? (
                <div className="space-y-1 pt-1">
                  <Input value={novoCampoNome} onChange={(e) => setNovoCampoNome(e.target.value)} placeholder="Nome do campo (ex: cota)" />
                  {NOMES_RESERVADOS.has(novoCampoNome.trim().toLowerCase()) && (
                    <p className="text-xs text-danger-text">
                      "{novoCampoNome.trim()}" já é um campo padrão — use o botão "Marcar" dele acima.
                    </p>
                  )}
                  <select
                    value={novoCampoTipo}
                    onChange={(e) => setNovoCampoTipo(e.target.value as TipoCampo)}
                    className="h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
                  >
                    {TIPOS_CAMPO.map((t) => <option key={t.tipo} value={t.tipo}>{t.label}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!novoCampoNome.trim() || NOMES_RESERVADOS.has(novoCampoNome.trim().toLowerCase())}
                      onClick={() => {
                        setAlvo({ modo: 'campo', campo: novoCampoNome.trim(), tipo: novoCampoTipo })
                        setMostrarNovoCampo(false)
                        setNovoCampoNome('')
                      }}
                    >
                      Marcar no PDF
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setMostrarNovoCampo(false)}>Cancelar</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setMostrarNovoCampo(true)}>+ Campo customizado</Button>
              )}
            </div>

            <Button className="w-full" disabled={!podeSalvar || salvarMutation.isPending} onClick={() => salvarMutation.mutate()}>
              {salvarMutation.isPending ? 'Salvando...' : 'Salvar modelo'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
