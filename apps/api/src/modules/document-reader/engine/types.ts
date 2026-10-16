// Todas as coordenadas são normalizadas (0..1), origem no canto superior esquerdo.
// Assim o modelo independe de zoom/resolução e do tamanho da página.

export interface Item {
  str: string
  x: number
  y: number
  w: number
  h: number
}

export interface Pagina {
  numero: number
  itens: Item[]
  /** tamanho da página em pontos (para desenhar o mapa na tela de modelos) */
  largura?: number
  altura?: number
}

export interface DocumentoExtraido {
  paginas: Pagina[]
  /** false => provavelmente PDF escaneado (precisa de OCR) */
  temTexto: boolean
}

export type TipoCampo = 'cnpj' | 'data' | 'competencia' | 'periodo_apuracao' | 'moeda' | 'texto'

export interface Zona {
  campo: string
  pagina: number
  x: number
  y: number
  w: number
  h: number
  tipo: TipoCampo
  /** se true, a ausência/invalidez do campo não derruba a confiança */
  opcional?: boolean
}

export interface Ancora {
  /** texto fixo do documento (comparação sem acento/caixa) */
  texto: string
  pagina: number
  /** posição do texto no PDF modelo; usada para calcular o deslocamento do layout */
  x?: number
  y?: number
}

export interface Modelo {
  id: string
  nome: string
  tipoImposto: string
  ancoras: Ancora[]
  zonas: Zona[]
  /** refina o tipo de imposto a partir do campo `codigo_receita` */
  subtipos?: Record<string, string>
  /** nome do campo cujo texto (ex.: "IRPJ", "CSLL") define o tipo de imposto; tem prioridade sobre `subtipos` */
  tipoImpostoCampo?: string
}

export interface CampoExtraido {
  bruto: string
  valor: string | number | null
  valido: boolean
}

export interface ResultadoModelo {
  modelo: Modelo
  scoreAncoras: number
  dx: number
  dy: number
}

export interface Resultado {
  arquivo: string
  status: 'ok' | 'revisar' | 'nao_identificado' | 'sem_texto'
  modelo?: string
  tipoImposto?: string
  /** "2026-08" (mensal) ou "2026-T2" (trimestral); vem da linha PA quando existe, senão do campo competencia */
  periodo?: string
  scoreAncoras: number
  confianca: number
  campos: Record<string, CampoExtraido>
  /** informações calculadas a partir dos campos (ex.: cota 1..3 de IRPJ/CSLL trimestral) */
  derivados: Record<string, string | number>
  /** inconsistências entre campos (ex.: mês do cabeçalho não bate com o trimestre da linha PA) */
  avisos: string[]
  decisao: Decisao
}

export interface Decisao {
  acao: 'anexar' | 'revisar' | 'nao_identificado'
  motivo: string
  tarefaId?: string
  clienteId?: string
}

export interface Cliente {
  id: string
  razao: string
  cnpj: string
}

export interface Tarefa {
  id: string
  clienteId: string
  tipoImposto: string
  competencia: string // YYYY-MM
  status: 'aberta' | 'concluida'
}
