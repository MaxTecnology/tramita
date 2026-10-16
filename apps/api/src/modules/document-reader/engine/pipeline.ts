import { pontuarModelos } from './ancoras'
import { extrairDocumento } from './extrair-texto'
import type { CampoExtraido, Cliente, Decisao, Modelo, Resultado, Tarefa } from './types'
import { interpretar, textoDaZona } from './zonal'

// Reexportado como conveniência pra quem consome o pipeline (document-reader.service.ts) não
// precisar importar de dois módulos diferentes pros tipos que usa com mais frequência.
export type { Modelo } from './types'

// Âncoras são os textos fixos que identificam o layout: se qualquer uma faltar, é outro documento.
// (Com threshold parcial, um documento de layout parecido mas diferente pode ser mal-classificado.)
export const LIMIAR_ANCORAS = 1
export const LIMIAR_CONFIANCA = 0.9 // abaixo disso: nunca sugestão forte

export interface Base {
  clientes: Cliente[]
  tarefas: Tarefa[]
}

// `arquivo` existe em Resultado só pro relatório de CLI da POC (run.ts imprime qual arquivo foi
// processado) — extrairEInterpretar trabalha com um buffer, sem nome de arquivo inerente; quem
// chama (document-reader.service.ts) já sabe o storageKey e não precisa que o motor repita isso.
export type ResultadoSemDecisao = Omit<Resultado, 'decisao' | 'arquivo'>

/**
 * Extrai e interpreta um PDF contra os modelos fornecidos — não sabe nada de banco de dados.
 * O chamador usa `campos`/`tipoImposto`/`periodo` daqui pra resolver cliente/tarefas reais e
 * depois chamar `decidir` separadamente.
 */
export async function extrairEInterpretar(arquivo: string | Uint8Array, modelos: Modelo[]): Promise<ResultadoSemDecisao> {
  const vazio = {
    scoreAncoras: 0,
    confianca: 0,
    campos: {} as Record<string, CampoExtraido>,
    derivados: {} as Record<string, string | number>,
    avisos: [] as string[],
  }
  const doc = await extrairDocumento(arquivo)

  if (!doc.temTexto) {
    return { ...vazio, status: 'sem_texto' }
  }

  const [melhor, segundo] = pontuarModelos(doc.paginas, modelos)
  if (melhor && segundo && melhor.scoreAncoras >= LIMIAR_ANCORAS && segundo.scoreAncoras >= LIMIAR_ANCORAS) {
    return { ...vazio, scoreAncoras: melhor.scoreAncoras, status: 'revisar' }
  }
  if (!melhor || melhor.scoreAncoras < LIMIAR_ANCORAS) {
    return { ...vazio, scoreAncoras: melhor?.scoreAncoras ?? 0, status: 'nao_identificado' }
  }

  const { modelo, dx, dy } = melhor
  const campos: Record<string, CampoExtraido> = {}
  for (const z of modelo.zonas) {
    const pagina = doc.paginas[z.pagina - 1]
    const bruto = pagina ? textoDaZona(pagina, z, dx, dy) : ''
    campos[z.campo] = interpretar(bruto, z.tipo)
  }

  const avisos: string[] = []
  const derivados: Record<string, string | number> = {}
  const pa = campos['pa']?.valido ? String(campos['pa'].valor) : null
  const competenciaCab = campos['competencia']?.valido ? String(campos['competencia'].valor) : null
  const periodo = pa ?? competenciaCab ?? undefined

  const tri = pa?.match(/^(\d{4})-T(\d)$/)
  if (pa && competenciaCab) {
    const esperadoNoCabecalho = tri ? `${tri[1]}-${String(Number(tri[2]) * 3).padStart(2, '0')}` : pa
    if (competenciaCab !== esperadoNoCabecalho) {
      avisos.push(`Período do cabeçalho (${competenciaCab}) não bate com a linha PA (${pa})`)
    }
  }
  const venc = campos['vencimento']?.valido ? String(campos['vencimento'].valor) : null
  if (tri && venc && venc.startsWith(tri[1])) {
    const cota = Number(venc.slice(5, 7)) - Number(tri[2]) * 3
    if (cota >= 1 && cota <= 3) derivados['cota'] = cota
  }

  const obrigatorias = modelo.zonas.filter((z) => !z.opcional)
  const validas = obrigatorias.filter((z) => campos[z.campo]?.valido).length
  let confianca = melhor.scoreAncoras * (obrigatorias.length ? validas / obrigatorias.length : 1)
  if (avisos.length) confianca *= 0.5

  const doCampo = modelo.tipoImpostoCampo ? campos[modelo.tipoImpostoCampo]?.valor : null
  const codigo = campos['codigo_receita']?.valor
  const tipoImposto =
    (typeof doCampo === 'string' && /^[A-Z0-9]{2,10}$/.test(doCampo) ? doCampo : null) ??
    (typeof codigo === 'string' ? modelo.subtipos?.[codigo] : undefined) ??
    modelo.tipoImposto

  const status = confianca >= LIMIAR_CONFIANCA ? 'ok' : 'revisar'
  return {
    status, modelo: modelo.id, tipoImposto, periodo, competenciaCab: competenciaCab ?? undefined,
    scoreAncoras: melhor.scoreAncoras, confianca, campos, derivados, avisos,
  }
}

/** Decide anexar/revisar/não-identificado dado um `Base` já resolvido (cliente/tarefas candidatas reais). */
export function decidir(
  status: string,
  tipoImposto: string | undefined,
  periodos: Array<string | null | undefined>,
  campos: Record<string, CampoExtraido>,
  avisos: string[],
  base: Base,
): Decisao {
  if (status !== 'ok') {
    const ruins = Object.entries(campos).filter(([, c]) => !c.valido && c.bruto !== '').map(([k]) => k)
    const extra = [ruins.length ? `campos inválidos: ${ruins.join(', ')}` : '', ...avisos].filter(Boolean).join('; ')
    return { acao: 'revisar', motivo: `Confiança baixa${extra ? `; ${extra}` : ''}` }
  }

  const cnpj = campos['cnpj']?.valor
  const cliente = base.clientes.find((c) => c.cnpj === cnpj)
  if (!cliente) return { acao: 'revisar', motivo: `Cliente não encontrado para o identificador ${cnpj}` }

  const aceitos = new Set(periodos.filter((p): p is string => !!p))
  const rotulo = periodos[0] ?? periodos[1]
  const candidatas = base.tarefas.filter(
    (t) => t.status === 'aberta' && t.clienteId === cliente.id && t.tipoImposto === tipoImposto && aceitos.has(t.competencia),
  )

  if (candidatas.length === 1) {
    return { acao: 'anexar', motivo: `${tipoImposto} ${rotulo} de ${cliente.razao}`, tarefaId: candidatas[0].id, clienteId: cliente.id }
  }
  if (candidatas.length === 0) {
    return { acao: 'revisar', motivo: `Sem tarefa aberta de ${tipoImposto} ${rotulo} para ${cliente.razao}`, clienteId: cliente.id }
  }
  return { acao: 'revisar', motivo: `${candidatas.length} tarefas abertas candidatas (ambíguo)`, clienteId: cliente.id }
}
