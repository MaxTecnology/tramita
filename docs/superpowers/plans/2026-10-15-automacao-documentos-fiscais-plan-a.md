# Automação de Documentos Fiscais — Plano A (pipeline central) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o pipeline central do robô de documentos fiscais de ponta a ponta — um PDF de
DARF/DAS/PGDAS-D sobe, é lido e classificado pelo motor determinístico, casado contra a Task aberta
certa, e um humano confirma o anexo na fila de revisão (modo sombra: nunca anexa sozinho).

**Architecture:** Motor de extração zonal portado quase como está de `poc-extracao-pdf/` (puro, sem
banco), orquestrado por um service async que resolve cliente/tarefa reais no Prisma. Ingestão via
upload multipart (mesmo padrão de `attachments.routes.ts`) enfileira um job BullMQ (mesmo padrão de
`notification.worker.ts`); o worker roda o motor e grava o resultado; a fila de revisão (tela nova)
usa `createAttachment` já existente pra efetivar o anexo.

**Tech Stack:** Node 22 + TypeScript strict + Fastify v5 + Prisma v6 + BullMQ + Redis (API já
usados); `pdfjs-dist` (novo, só pra extrair texto posicionado de PDF); React 19 + Vite + shadcn/ui
(frontend já usados).

**Spec:** `docs/superpowers/specs/2026-10-15-automacao-documentos-fiscais-design.md`

**Plano B** (tela de modelagem — cadastro de `DocumentModel` novo pelo ORG_ADMIN) vem depois deste,
como plano separado — não faz parte deste escopo.

## Global Constraints

- Motor **puro**, sem Prisma nem HTTP dentro de `engine/` — a spec exige isso pra manter testável
  isoladamente e reaproveitável.
- Todas as âncoras do modelo são obrigatórias (`LIMIAR_ANCORAS = 1`) — nunca um threshold parcial.
- Confiança abaixo de 0.9 nunca gera sugestão forte — sempre cai na fila de revisão.
- V1 roda em **modo sombra**: nenhum anexo acontece sem confirmação humana explícita.
- Anexo sempre via `createAttachment` existente (`apps/api/src/modules/attachments/attachments.service.ts`)
  — nunca um caminho de anexo paralelo.
- Ingestão é só staff (`requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')`) — cliente não usa
  essa rota no v1.
- `ReceivedDocument` com status `REJECTED` expurga (PDF do B2 + campos extraídos) depois de 30 dias.
- Testes com TDD (RED antes de GREEN) em todas as tarefas, seguindo `superpowers:test-driven-development`.

## Review Focus

- **PDF corrompido ou que trava o parser do pdf.js** — o worker não pode derrubar o processo nem
  travar a fila; precisa de timeout e captura de erro, virando `NOT_IDENTIFIED` com motivo claro,
  não um job BullMQ preso pra sempre.
- **Dois escritórios diferentes com `DocumentModel` próprio que reconhecem o mesmo tipo de layout**
  — o motor só vê os modelos da própria org + globais; nunca pode misturar modelo de outra org no
  casamento (isolamento multi-tenant, igual a todo resto do sistema).
  `apps/api/src/lib/date-only.ts` já documenta o padrão de bug de fuso — não se aplica aqui
  diretamente, mas a disciplina de nunca vazar escopo entre orgs é a mesma classe de risco já
  corrigida várias vezes nesta base de código.
- **Reenvio do mesmo PDF duas vezes seguidas (duplo clique, retry de rede)** — precisa virar 409
  claro, não erro bruto de constraint (`P2002`), e nunca processar o mesmo arquivo duas vezes.
- **Documento de CNPJ que não existe em nenhum `Client` da org** — precisa cair em fila de revisão
  com motivo "cliente não encontrado", nunca ficar em limbo nem lançar exceção não tratada pro
  worker.
- **Task já `DONE`/`DISREGARDED` pra aquela competência (obrigação já cumprida, documento chegou
  atrasado)** — não pode ser candidata ao casamento; cai em revisão com motivo "sem tarefa aberta".

---

## Task 1: Motor — tipos e validadores

**Files:**
- Create: `apps/api/src/modules/document-reader/engine/types.ts`
- Create: `apps/api/src/modules/document-reader/engine/validadores.ts`
- Test: `apps/api/src/modules/document-reader/engine/validadores.test.ts`

**Interfaces:**
- Produces: `Item`, `Pagina`, `DocumentoExtraido`, `TipoCampo`, `Zona`, `Ancora`, `Modelo`,
  `CampoExtraido`, `ResultadoModelo`, `Resultado`, `Decisao`, `Cliente`, `Tarefa` (de `types.ts`);
  `normalizar`, `soDigitos`, `cnpjValido`, `cpfValido`, `parseData`, `parsePeriodoApuracao`,
  `parseCompetencia`, `parseMoeda`, `extrairCnpjOuCpf` (de `validadores.ts`) — usados por `ancoras.ts`,
  `zonal.ts`, `pipeline.ts` nas próximas tarefas.

- [ ] **Step 1: Portar `types.ts` da POC**

Copie `poc-extracao-pdf/src/types.ts` pra `apps/api/src/modules/document-reader/engine/types.ts`
sem nenhuma alteração de conteúdo (o arquivo não tem imports, é só definição de tipos).

- [ ] **Step 2: Escrever o teste de `validadores.ts`**

```typescript
// apps/api/src/modules/document-reader/engine/validadores.test.ts
import { describe, it, expect } from 'vitest'
import {
  normalizar, soDigitos, cnpjValido, cpfValido, parseData,
  parsePeriodoApuracao, parseCompetencia, parseMoeda, extrairCnpjOuCpf,
} from './validadores'

describe('normalizar', () => {
  it('remove acento, baixa caixa e espaço duplicado', () => {
    expect(normalizar('  Documento de  Arrecadação  ')).toBe('documento de arrecadacao')
  })
})

describe('cnpjValido', () => {
  it('aceita CNPJ com dígito verificador correto', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true)
  })
  it('rejeita CNPJ com dígito verificador errado', () => {
    expect(cnpjValido('11.222.333/0001-82')).toBe(false)
  })
  it('rejeita sequência de dígitos repetidos', () => {
    expect(cnpjValido('11.111.111/1111-11')).toBe(false)
  })
})

describe('cpfValido', () => {
  it('aceita CPF com dígito verificador correto', () => {
    expect(cpfValido('111.444.777-35')).toBe(true)
  })
  it('rejeita CPF com dígito verificador errado', () => {
    expect(cpfValido('111.444.777-36')).toBe(false)
  })
})

describe('parseData', () => {
  it('converte dd/mm/aaaa pra aaaa-mm-dd', () => {
    expect(parseData('20/10/2026')).toBe('2026-10-20')
  })
  it('rejeita data que não existe (31 de fevereiro)', () => {
    expect(parseData('31/02/2026')).toBeNull()
  })
})

describe('parseCompetencia', () => {
  it('lê mês por extenso', () => {
    expect(parseCompetencia('agosto/2026')).toBe('2026-08')
  })
  it('lê mm/aaaa', () => {
    expect(parseCompetencia('08/2026')).toBe('2026-08')
  })
  it('lê dd/mm/aaaa e deriva o mês', () => {
    expect(parseCompetencia('15/08/2026')).toBe('2026-08')
  })
})

describe('parsePeriodoApuracao', () => {
  it('lê trimestre', () => {
    expect(parsePeriodoApuracao('PA:2º Trimestre/2026')).toBe('2026-T2')
  })
  it('lê mês', () => {
    expect(parsePeriodoApuracao('PA:08/2026')).toBe('2026-08')
  })
})

describe('parseMoeda', () => {
  it('lê valor com separador de milhar', () => {
    expect(parseMoeda('R$ 1.234,56')).toBe(1234.56)
  })
})

describe('extrairCnpjOuCpf', () => {
  it('reconhece CNPJ válido dentro de texto', () => {
    const r = extrairCnpjOuCpf('CNPJ: 11.222.333/0001-81')
    expect(r).toEqual({ valor: '11222333000181', valido: true })
  })
  it('reconhece CNPJ inválido mas ainda extrai o valor (confiança cai depois, não aqui)', () => {
    const r = extrairCnpjOuCpf('CNPJ: 11.222.333/0001-82')
    expect(r).toEqual({ valor: '11222333000182', valido: false })
  })
})
```

- [ ] **Step 3: Rodar o teste pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/engine/validadores.test.ts`
Expected: FAIL — `validadores.ts` não existe ainda.

- [ ] **Step 4: Portar `validadores.ts` da POC**

Copie `poc-extracao-pdf/src/validadores.ts` pra
`apps/api/src/modules/document-reader/engine/validadores.ts` sem alteração — o arquivo não importa
nada (é só funções puras).

- [ ] **Step 5: Rodar o teste pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/engine/validadores.test.ts`
Expected: PASS — 14/14.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/document-reader/engine/types.ts apps/api/src/modules/document-reader/engine/validadores.ts apps/api/src/modules/document-reader/engine/validadores.test.ts
git commit -m "feat(document-reader): porta tipos e validadores do motor da POC"
```

---

## Task 2: Motor — extração de texto e âncoras

**Files:**
- Create: `apps/api/src/modules/document-reader/engine/extrair-texto.ts`
- Create: `apps/api/src/modules/document-reader/engine/ancoras.ts`
- Test: `apps/api/src/modules/document-reader/engine/ancoras.test.ts`
- Modify: `apps/api/package.json` (nova dependência `pdfjs-dist`)

**Interfaces:**
- Consumes: `Item`, `Pagina`, `DocumentoExtraido`, `Ancora`, `Modelo`, `ResultadoModelo` (Task 1).
- Produces: `extrairDocumento(entrada: string | Uint8Array): Promise<DocumentoExtraido>`,
  `localizar(pagina, ancora)`, `pontuarModelos(paginas, modelos): ResultadoModelo[]`,
  `detalharAncoras(paginas, modelo)` — usados por `pipeline.ts` (Task 4).

- [ ] **Step 1: Instalar `pdfjs-dist`**

```bash
pnpm --filter api add pdfjs-dist@^6.4.299
```

- [ ] **Step 2: Portar `extrair-texto.ts`, com limites de segurança**

A spec exige timeout, limite de páginas e `isEvalSupported: false` (PDF é entrada não confiável) —
a POC não tinha isso. Porte com essas adições:

```typescript
// apps/api/src/modules/document-reader/engine/extrair-texto.ts
import { readFile } from 'node:fs/promises'
// @ts-ignore - build legacy roda em Node sem polyfills
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { DocumentoExtraido, Item, Pagina } from './types'

const MAX_PAGINAS = 10
const TIMEOUT_MS = 15_000

/**
 * Lê o PDF e devolve cada trecho de texto com posição normalizada (0..1).
 * Se o PDF quase não tem texto, `temTexto` = false (candidato a OCR).
 * PDF é entrada não confiável: isEvalSupported desligado, limite de páginas e timeout.
 */
export async function extrairDocumento(entrada: string | Uint8Array): Promise<DocumentoExtraido> {
  const data = typeof entrada === 'string' ? new Uint8Array(await readFile(entrada)) : entrada

  const resultado = await Promise.race([
    extrairSemLimite(data),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout ao extrair texto do PDF')), TIMEOUT_MS),
    ),
  ])
  return resultado
}

async function extrairSemLimite(data: Uint8Array): Promise<DocumentoExtraido> {
  const pdf = await getDocument({ data, useSystemFonts: true, verbosity: 0, isEvalSupported: false }).promise

  if (pdf.numPages > MAX_PAGINAS) {
    throw new Error(`PDF com ${pdf.numPages} páginas excede o limite de ${MAX_PAGINAS}`)
  }

  const paginas: Pagina[] = []
  let totalChars = 0

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const vp = page.getViewport({ scale: 1 })
    const W = vp.width
    const H = vp.height
    const content = await page.getTextContent()

    const itens: Item[] = []
    for (const it of content.items as any[]) {
      if (typeof it.str !== 'string' || !it.str.trim()) continue
      const [, , , d, e, f] = it.transform as number[]
      const h = it.height || Math.abs(d)
      itens.push({
        str: it.str,
        x: e / W,
        y: (H - f - h) / H, // topo do trecho, origem no topo
        w: it.width / W,
        h: h / H,
      })
      totalChars += it.str.trim().length
    }
    paginas.push({ numero: n, itens, largura: W, altura: H })
  }

  return { paginas, temTexto: totalChars >= 20 }
}
```

- [ ] **Step 3: Escrever o teste de `ancoras.ts`**

```typescript
// apps/api/src/modules/document-reader/engine/ancoras.test.ts
import { describe, it, expect } from 'vitest'
import { localizar, pontuarModelos, detalharAncoras } from './ancoras'
import type { Pagina, Modelo } from './types'

function pagina(itens: Pagina['itens']): Pagina {
  return { numero: 1, itens }
}

describe('localizar', () => {
  it('prefere correspondência exata sobre "contém"', () => {
    const p = pagina([
      { str: 'Documento de Arrecadação', x: 0.1, y: 0.1, w: 0.2, h: 0.01 },
      { str: 'Composição do Documento de Arrecadação', x: 0.1, y: 0.5, w: 0.3, h: 0.01 },
    ])
    const achado = localizar(p, { texto: 'Documento de Arrecadação', pagina: 1 })
    expect(achado?.y).toBe(0.1)
  })

  it('entre vários candidatos "contém", escolhe o mais próximo da posição do modelo', () => {
    const p = pagina([
      { str: 'Documento de Arrecadação (cabeçalho)', x: 0.1, y: 0.06, w: 0.3, h: 0.01 },
      { str: 'Documento de Arrecadação (rodapé)', x: 0.1, y: 0.9, w: 0.3, h: 0.01 },
    ])
    const achado = localizar(p, { texto: 'Documento de Arrecadação', pagina: 1, x: 0.1, y: 0.08 })
    expect(achado?.y).toBe(0.06)
  })

  it('devolve undefined se a âncora não existe na página', () => {
    const p = pagina([{ str: 'Outro texto qualquer', x: 0, y: 0, w: 0.1, h: 0.01 }])
    expect(localizar(p, { texto: 'Documento de Arrecadação', pagina: 1 })).toBeUndefined()
  })
})

describe('pontuarModelos', () => {
  const modelo: Modelo = {
    id: 'm1',
    nome: 'Modelo 1',
    tipoImposto: 'DARF',
    ancoras: [
      { texto: 'Âncora A', pagina: 1, x: 0.1, y: 0.1 },
      { texto: 'Âncora B', pagina: 1, x: 0.5, y: 0.5 },
    ],
    zonas: [],
  }

  it('score 1 quando todas as âncoras são encontradas', () => {
    const paginas = [pagina([
      { str: 'Âncora A', x: 0.1, y: 0.1, w: 0.1, h: 0.01 },
      { str: 'Âncora B', x: 0.5, y: 0.5, w: 0.1, h: 0.01 },
    ])]
    const [r] = pontuarModelos(paginas, [modelo])
    expect(r.scoreAncoras).toBe(1)
  })

  it('score 0.5 quando só metade das âncoras é encontrada', () => {
    const paginas = [pagina([{ str: 'Âncora A', x: 0.1, y: 0.1, w: 0.1, h: 0.01 }])]
    const [r] = pontuarModelos(paginas, [modelo])
    expect(r.scoreAncoras).toBe(0.5)
  })

  it('calcula o deslocamento (dx, dy) do layout', () => {
    const paginas = [pagina([
      { str: 'Âncora A', x: 0.15, y: 0.12, w: 0.1, h: 0.01 },
      { str: 'Âncora B', x: 0.55, y: 0.52, w: 0.1, h: 0.01 },
    ])]
    const [r] = pontuarModelos(paginas, [modelo])
    expect(r.dx).toBeCloseTo(0.05, 5)
    expect(r.dy).toBeCloseTo(0.02, 5)
  })

  it('ordena por score decrescente', () => {
    const modeloFraco: Modelo = { ...modelo, id: 'm2', ancoras: [{ texto: 'Não existe', pagina: 1 }] }
    const paginas = [pagina([
      { str: 'Âncora A', x: 0.1, y: 0.1, w: 0.1, h: 0.01 },
      { str: 'Âncora B', x: 0.5, y: 0.5, w: 0.1, h: 0.01 },
    ])]
    const [primeiro, segundo] = pontuarModelos(paginas, [modeloFraco, modelo])
    expect(primeiro.modelo.id).toBe('m1')
    expect(segundo.modelo.id).toBe('m2')
  })
})

describe('detalharAncoras', () => {
  it('reporta cada âncora como achada ou não', () => {
    const modelo: Modelo = {
      id: 'm1', nome: 'M', tipoImposto: 'DARF',
      ancoras: [{ texto: 'Existe', pagina: 1 }, { texto: 'Não existe', pagina: 1 }],
      zonas: [],
    }
    const paginas = [pagina([{ str: 'Existe', x: 0, y: 0, w: 0.1, h: 0.01 }])]
    const detalhe = detalharAncoras(paginas, modelo)
    expect(detalhe).toEqual([
      { texto: 'Existe', pagina: 1, achada: true, x: 0, y: 0 },
      { texto: 'Não existe', pagina: 1, achada: false, x: undefined, y: undefined },
    ])
  })
})
```

- [ ] **Step 4: Rodar pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/engine/ancoras.test.ts`
Expected: FAIL — `ancoras.ts` não existe.

- [ ] **Step 5: Portar `ancoras.ts`**

Copie `poc-extracao-pdf/src/ancoras.ts` pra `apps/api/src/modules/document-reader/engine/ancoras.ts`,
trocando o import `from './validadores.js'` por `from './validadores'` (sem extensão, convenção do
projeto) e `from './types.js'` por `from './types'`.

- [ ] **Step 6: Rodar pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/engine/ancoras.test.ts`
Expected: PASS — 7/7.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/modules/document-reader/engine/extrair-texto.ts apps/api/src/modules/document-reader/engine/ancoras.ts apps/api/src/modules/document-reader/engine/ancoras.test.ts
git commit -m "feat(document-reader): porta extração de texto (com limites de segurança) e âncoras"
```

---

## Task 3: Motor — leitura zonal

**Files:**
- Create: `apps/api/src/modules/document-reader/engine/zonal.ts`
- Test: `apps/api/src/modules/document-reader/engine/zonal.test.ts`

**Interfaces:**
- Consumes: `Item`, `Pagina`, `Zona`, `CampoExtraido` (Task 1); `extrairCnpjOuCpf`, `parseCompetencia`,
  `parseData`, `parseMoeda`, `parsePeriodoApuracao` (Task 1).
- Produces: `textoDaZona(pagina, zona, dx?, dy?, margem?): string`,
  `interpretar(bruto: string, tipo: Zona['tipo']): CampoExtraido` — usados por `pipeline.ts` (Task 4).

- [ ] **Step 1: Escrever o teste**

```typescript
// apps/api/src/modules/document-reader/engine/zonal.test.ts
import { describe, it, expect } from 'vitest'
import { textoDaZona, interpretar } from './zonal'
import type { Pagina, Zona } from './types'

describe('textoDaZona', () => {
  const pagina: Pagina = {
    numero: 1,
    itens: [
      { str: '11.222.333/0001-81', x: 0.06, y: 0.158, w: 0.195, h: 0.01 },
      { str: 'Razão Social Ltda', x: 0.263, y: 0.158, w: 0.3, h: 0.01 }, // fora da zona (x diferente)
    ],
  }
  const zona: Zona = { campo: 'cnpj', pagina: 1, x: 0.06, y: 0.158, w: 0.195, h: 0.01, tipo: 'cnpj' }

  it('lê só o texto cujo centro cai dentro da zona', () => {
    expect(textoDaZona(pagina, zona)).toBe('11.222.333/0001-81')
  })

  it('compensa o deslocamento (dx, dy) do layout', () => {
    const paginaDeslocada: Pagina = {
      numero: 1,
      itens: [{ str: '11.222.333/0001-81', x: 0.08, y: 0.178, w: 0.195, h: 0.01 }],
    }
    expect(textoDaZona(paginaDeslocada, zona, 0.02, 0.02)).toBe('11.222.333/0001-81')
  })

  it('junta múltiplas linhas dentro da mesma zona, de cima pra baixo', () => {
    const zonaAlta: Zona = { campo: 'x', pagina: 1, x: 0, y: 0, w: 1, h: 0.05, tipo: 'texto' }
    const p: Pagina = {
      numero: 1,
      itens: [
        { str: 'linha 2', x: 0, y: 0.03, w: 0.1, h: 0.01 },
        { str: 'linha 1', x: 0, y: 0.01, w: 0.1, h: 0.01 },
      ],
    }
    expect(textoDaZona(p, zonaAlta)).toBe('linha 1\nlinha 2')
  })

  it('devolve string vazia quando nenhum item cai na zona', () => {
    const zonaVazia: Zona = { campo: 'x', pagina: 1, x: 0.8, y: 0.8, w: 0.05, h: 0.01, tipo: 'texto' }
    expect(textoDaZona(pagina, zonaVazia)).toBe('')
  })
})

describe('interpretar', () => {
  it('cnpj: válido', () => {
    expect(interpretar('11.222.333/0001-81', 'cnpj')).toEqual({
      bruto: '11.222.333/0001-81', valor: '11222333000181', valido: true,
    })
  })
  it('data: válida', () => {
    expect(interpretar('20/10/2026', 'data')).toEqual({ bruto: '20/10/2026', valor: '2026-10-20', valido: true })
  })
  it('competencia: válida', () => {
    expect(interpretar('agosto/2026', 'competencia')).toEqual({ bruto: 'agosto/2026', valor: '2026-08', valido: true })
  })
  it('periodo_apuracao: válido', () => {
    expect(interpretar('PA:2º Trimestre/2026', 'periodo_apuracao')).toEqual({
      bruto: 'PA:2º Trimestre/2026', valor: '2026-T2', valido: true,
    })
  })
  it('moeda: válida', () => {
    expect(interpretar('R$ 1.234,56', 'moeda')).toEqual({ bruto: 'R$ 1.234,56', valor: 1234.56, valido: true })
  })
  it('texto: sempre válido se não vazio', () => {
    expect(interpretar('  Qualquer  Texto  ', 'texto')).toEqual({
      bruto: '  Qualquer  Texto  ', valor: 'Qualquer Texto', valido: true,
    })
  })
  it('campo inválido fica com valido=false, mas bruto preservado', () => {
    expect(interpretar('não é uma data', 'data')).toEqual({ bruto: 'não é uma data', valor: null, valido: false })
  })
})
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/engine/zonal.test.ts`
Expected: FAIL — `zonal.ts` não existe.

- [ ] **Step 3: Portar `zonal.ts`**

Copie `poc-extracao-pdf/src/zonal.ts` pra `apps/api/src/modules/document-reader/engine/zonal.ts`,
trocando os imports `.js` pela convenção sem extensão (`from './types'`, `from './validadores'`).

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/engine/zonal.test.ts`
Expected: PASS — 11/11.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/document-reader/engine/zonal.ts apps/api/src/modules/document-reader/engine/zonal.test.ts
git commit -m "feat(document-reader): porta leitura zonal do motor"
```

---

## Task 4: Motor — pipeline (extração + decisão separadas)

**Files:**
- Create: `apps/api/src/modules/document-reader/engine/pipeline.ts`
- Test: `apps/api/src/modules/document-reader/engine/pipeline.test.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1-3 (`extrairDocumento`, `pontuarModelos`, `textoDaZona`, `interpretar`,
  todos os tipos).
- Produces:
  - `LIMIAR_ANCORAS = 1`, `LIMIAR_CONFIANCA = 0.9` (constantes).
  - `extrairEInterpretar(arquivo: string | Uint8Array, modelos: Modelo[]): Promise<ResultadoSemDecisao>`
    — **pura em relação a banco**: não recebe `Base`, só extrai/interpreta/calcula confiança. Tipo
    `ResultadoSemDecisao = Omit<Resultado, 'decisao'>`.
  - `decidir(status: Resultado['status'], tipoImposto: string | undefined, periodos: Array<string | null | undefined>, campos: Record<string, CampoExtraido>, avisos: string[], base: Base): Decisao`
    — pura, recebe `Base` já resolvida (candidatos reais, não todo o banco). Usada pelo
    `document-reader.service.ts` (Task 7) depois de consultar o Prisma com o CNPJ/tipo/período que
    `extrairEInterpretar` devolveu.
  - `export interface Base { clientes: Cliente[]; tarefas: Tarefa[] }` (igual à POC).

Essa é a mudança real em relação à POC: lá, `processarPdf` fazia tudo de uma vez (recebia `Base`
inteira e no fim chamava `decidir` internamente). Aqui, `extrairEInterpretar` roda primeiro (sem
precisar saber nada do banco), devolve os campos extraídos (inclusive CNPJ/tipo/período), e só
**depois** o chamador (Task 7) resolve o `Base` de verdade com uma query Prisma baseada nesses
valores, e chama `decidir` separadamente. Isso é exatamente o que
`poc-extracao-pdf/docs/INTEGRACAO.md` pede: "trocar `Base` (carrega tudo em memória) por um
resolvedor assíncrono".

- [ ] **Step 1: Escrever o teste de `extrairEInterpretar`**

```typescript
// apps/api/src/modules/document-reader/engine/pipeline.test.ts
import { describe, it, expect } from 'vitest'
import { extrairEInterpretar, decidir, LIMIAR_CONFIANCA } from './pipeline'
import type { Modelo, Base } from './pipeline'
import PDFDocument from 'pdfkit'
import { PassThrough } from 'node:stream'

async function gerarPdfSimples(linhas: { texto: string; x: number; y: number }[]): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: 'A4', margin: 0 })
  const stream = doc.pipe(new PassThrough())
  const chunks: Buffer[] = []
  stream.on('data', (c) => chunks.push(c))
  for (const l of linhas) doc.fontSize(10).text(l.texto, l.x * doc.page.width, l.y * doc.page.height)
  doc.end()
  await new Promise((resolve) => stream.on('end', resolve))
  return new Uint8Array(Buffer.concat(chunks))
}

const modeloTeste: Modelo = {
  id: 'teste',
  nome: 'Modelo de Teste',
  tipoImposto: 'DARF',
  ancoras: [{ texto: 'Documento de Arrecadação', pagina: 1, x: 0.1, y: 0.05 }],
  zonas: [
    { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
    { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
  ],
}

describe('extrairEInterpretar', () => {
  it('reconhece o modelo certo e lê os campos das zonas', async () => {
    const pdf = await gerarPdfSimples([
      { texto: 'Documento de Arrecadação', x: 0.1, y: 0.05 },
      { texto: '11.222.333/0001-81', x: 0.1, y: 0.1 },
      { texto: 'agosto/2026', x: 0.1, y: 0.15 },
    ])
    const r = await extrairEInterpretar(pdf, [modeloTeste])
    expect(r.modelo).toBe('teste')
    expect(r.campos.cnpj.valor).toBe('11222333000181')
    expect(r.periodo).toBe('2026-08')
    expect(r.confianca).toBe(1)
  })

  it('status nao_identificado quando nenhum modelo reconhece', async () => {
    const pdf = await gerarPdfSimples([{ texto: 'Recibo qualquer sem âncora', x: 0.1, y: 0.1 }])
    const r = await extrairEInterpretar(pdf, [modeloTeste])
    expect(r.status).toBe('nao_identificado')
  })

  it('status revisar quando dois modelos reconhecem o mesmo documento (conflito, nunca escolhe arbitrariamente)', async () => {
    const modeloConflitante: Modelo = { ...modeloTeste, id: 'conflitante', nome: 'Modelo Conflitante' }
    const pdf = await gerarPdfSimples([
      { texto: 'Documento de Arrecadação', x: 0.1, y: 0.05 },
      { texto: '11.222.333/0001-81', x: 0.1, y: 0.1 },
      { texto: 'agosto/2026', x: 0.1, y: 0.15 },
    ])
    const r = await extrairEInterpretar(pdf, [modeloTeste, modeloConflitante])
    expect(r.status).toBe('revisar')
    expect(r.modelo).toBeUndefined() // nenhum dos dois é escolhido
  })

  it('status sem_texto quando o PDF não tem camada de texto', async () => {
    const doc = new PDFDocument({ size: 'A4' })
    const stream = doc.pipe(new PassThrough())
    const chunks: Buffer[] = []
    stream.on('data', (c) => chunks.push(c))
    doc.end()
    await new Promise((resolve) => stream.on('end', resolve))
    const r = await extrairEInterpretar(new Uint8Array(Buffer.concat(chunks)), [modeloTeste])
    expect(r.status).toBe('sem_texto')
  })

  it('confiança abaixo do limiar quando o CNPJ é inválido', async () => {
    const pdf = await gerarPdfSimples([
      { texto: 'Documento de Arrecadação', x: 0.1, y: 0.05 },
      { texto: '11.222.333/0001-82', x: 0.1, y: 0.1 }, // dígito verificador errado
      { texto: 'agosto/2026', x: 0.1, y: 0.15 },
    ])
    const r = await extrairEInterpretar(pdf, [modeloTeste])
    expect(r.confianca).toBeLessThan(LIMIAR_CONFIANCA)
    expect(r.status).toBe('revisar')
  })
})

describe('decidir', () => {
  const base: Base = {
    clientes: [{ id: 'c1', razao: 'Padaria Pão Quente Ltda', cnpj: '11222333000181' }],
    tarefas: [{ id: 't1', clienteId: 'c1', tipoImposto: 'DARF', competencia: '2026-08', status: 'aberta' }],
  }

  it('anexar quando exatamente 1 tarefa candidata', () => {
    const d = decidir(
      'ok', 'DARF', ['2026-08'],
      { cnpj: { bruto: '', valor: '11222333000181', valido: true } },
      [], base,
    )
    expect(d).toEqual({ acao: 'anexar', motivo: 'DARF 2026-08 de Padaria Pão Quente Ltda', tarefaId: 't1', clienteId: 'c1' })
  })

  it('revisar quando cliente não é encontrado pelo CNPJ', () => {
    const d = decidir('ok', 'DARF', ['2026-08'], { cnpj: { bruto: '', valor: '99999999000199', valido: true } }, [], base)
    expect(d.acao).toBe('revisar')
    expect(d.motivo).toContain('Cliente não encontrado')
  })

  it('revisar quando não há tarefa aberta candidata', () => {
    const baseSemTarefa: Base = { ...base, tarefas: [] }
    const d = decidir('ok', 'DARF', ['2026-08'], { cnpj: { bruto: '', valor: '11222333000181', valido: true } }, [], baseSemTarefa)
    expect(d.acao).toBe('revisar')
    expect(d.motivo).toContain('Sem tarefa aberta')
  })

  it('revisar quando há mais de uma tarefa candidata (ambíguo)', () => {
    const baseAmbigua: Base = { ...base, tarefas: [...base.tarefas, { id: 't2', clienteId: 'c1', tipoImposto: 'DARF', competencia: '2026-08', status: 'aberta' }] }
    const d = decidir('ok', 'DARF', ['2026-08'], { cnpj: { bruto: '', valor: '11222333000181', valido: true } }, [], baseAmbigua)
    expect(d.acao).toBe('revisar')
    expect(d.motivo).toContain('ambíguo')
  })
})
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/engine/pipeline.test.ts`
Expected: FAIL — `pipeline.ts` não existe. (Vai precisar de `pdfkit` como devDependency pra gerar
PDF sintético no teste — adicione com `pnpm --filter api add -D pdfkit @types/pdfkit`.)

- [ ] **Step 3: Escrever `pipeline.ts`**

```typescript
// apps/api/src/modules/document-reader/engine/pipeline.ts
import { pontuarModelos } from './ancoras'
import { extrairDocumento } from './extrair-texto'
import type { CampoExtraido, Cliente, Decisao, Modelo, Resultado, Tarefa } from './types'
import { interpretar, textoDaZona } from './zonal'

// Âncoras são os textos fixos que identificam o layout: se qualquer uma faltar, é outro documento.
// (Com threshold parcial, um documento de layout parecido mas diferente pode ser mal-classificado.)
export const LIMIAR_ANCORAS = 1
export const LIMIAR_CONFIANCA = 0.9 // abaixo disso: nunca sugestão forte

export interface Base {
  clientes: Cliente[]
  tarefas: Tarefa[]
}

export type ResultadoSemDecisao = Omit<Resultado, 'decisao'>

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
  return { status, modelo: modelo.id, tipoImposto, periodo, scoreAncoras: melhor.scoreAncoras, confianca, campos, derivados, avisos }
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
```

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/engine/pipeline.test.ts`
Expected: PASS — 10/10.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/modules/document-reader/engine/pipeline.ts apps/api/src/modules/document-reader/engine/pipeline.test.ts
git commit -m "feat(document-reader): porta pipeline do motor, separando extração/interpretação de decisão"
```

---

## Task 5: Schema Prisma

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration via `pnpm --filter api migrate:dev -- --name document_reader`

**Interfaces:**
- Produces: `TaxObligationType`, `DocumentModel`, `ReceivedDocument`, `ReceivedDocumentStatus` (novos
  models/enum); `Client.cei`/`caepf`/`inscricaoEstadual` (campos novos);
  `RecurringTaskTemplate.taxObligationTypeId` (campo novo) — usados pelas Tasks 6-12.

- [ ] **Step 1: Adicionar os campos novos em `Client`**

No model `Client` existente (`apps/api/prisma/schema.prisma`), logo abaixo de `cpf String?`:

```prisma
  cei               String?
  caepf             String?
  inscricaoEstadual String?
```

- [ ] **Step 2: Adicionar `taxObligationTypeId` em `RecurringTaskTemplate`**

No model `RecurringTaskTemplate` existente, logo abaixo de `departmentId String`:

```prisma
  // Só preenchido pra templates que geram obrigação fiscal — permite ao robô de documentos casar
  // (cliente, obrigação, competência) com confiança, em vez de comparar title (texto livre).
  taxObligationTypeId String?
```

E na seção de relações do mesmo model:

```prisma
  taxObligationType TaxObligationType? @relation(fields: [taxObligationTypeId], references: [id])
```

- [ ] **Step 3: Adicionar os models novos**

No final do `schema.prisma`:

```prisma
model TaxObligationType {
  id             String   @id @default(cuid())
  code           String   // "IRPJ", "DAS", "CSLL", "PGDAS-D"
  name           String
  organizationId String?  // null = global (AutoHubs); preenchido = só do escritório
  isActive       Boolean  @default(true)
  createdById    String?  // null pros globais
  createdAt      DateTime @default(now())

  organization         Organization?            @relation(fields: [organizationId], references: [id])
  createdBy             User?                    @relation(fields: [createdById], references: [id])
  documentModels         DocumentModel[]
  recurringTaskTemplates RecurringTaskTemplate[]

  @@unique([organizationId, code])
  @@map("tax_obligation_types")
}

model DocumentModel {
  id                  String   @id @default(cuid())
  organizationId      String?  // null = global
  taxObligationTypeId String
  name                String
  version             Int      @default(1)
  isActive            Boolean  @default(true)
  // Formato: { ancoras: Ancora[], zonas: Zona[], tipoImpostoCampo?: string, subtipos?: Record<string,string> }
  definicao           Json
  createdById         String?
  createdAt           DateTime @default(now())

  taxObligationType TaxObligationType  @relation(fields: [taxObligationTypeId], references: [id])
  organization      Organization?      @relation(fields: [organizationId], references: [id])
  createdBy         User?              @relation(fields: [createdById], references: [id])
  documentos        ReceivedDocument[]

  @@map("document_models")
}

model ReceivedDocument {
  id              String   @id @default(cuid())
  organizationId  String
  attachmentId    String?  @unique
  fileHash        String
  documentNumber  String?
  storageKey      String
  uploadedById    String?
  status          ReceivedDocumentStatus @default(PENDING)
  documentModelId String?
  modelVersion    Int?
  confidence      Float?
  extractedFields Json?
  taskId          String?
  how             String?
  reviewedById    String?
  reviewedAt      DateTime?
  createdAt       DateTime @default(now())

  organization  Organization    @relation(fields: [organizationId], references: [id])
  documentModel DocumentModel?  @relation(fields: [documentModelId], references: [id])
  task          Task?           @relation(fields: [taskId], references: [id])
  attachment    Attachment?     @relation(fields: [attachmentId], references: [id])
  uploadedBy    User?           @relation("ReceivedDocumentUploadedBy", fields: [uploadedById], references: [id])
  reviewedBy    User?           @relation("ReceivedDocumentReviewedBy", fields: [reviewedById], references: [id])

  @@unique([organizationId, fileHash])
  @@map("received_documents")
}

enum ReceivedDocumentStatus {
  PENDING
  ATTACHED
  NOT_IDENTIFIED
  REJECTED
}
```

- [ ] **Step 4: Adicionar as relações reversas nos models já existentes**

Em `Organization`: `taxObligationTypes TaxObligationType[]`, `documentModels DocumentModel[]`,
`receivedDocuments ReceivedDocument[]`.
Em `User`: `createdTaxObligationTypes TaxObligationType[]`, `createdDocumentModels DocumentModel[]`,
`uploadedDocuments ReceivedDocument[] @relation("ReceivedDocumentUploadedBy")`,
`reviewedDocuments ReceivedDocument[] @relation("ReceivedDocumentReviewedBy")`.
Em `Task`: `receivedDocuments ReceivedDocument[]`.
Em `Attachment`: `receivedDocument ReceivedDocument?`.

- [ ] **Step 5: Rodar a migration**

```bash
pnpm --filter api migrate:dev -- --name document_reader
```

Expected: migration criada e aplicada em `DATABASE_URL` sem erro.

- [ ] **Step 6: Verificar tipagem**

Run: `pnpm --filter api exec tsc --noEmit`
Expected: sem erros (o client Prisma foi regerado pela migration).

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(document-reader): schema de TaxObligationType, DocumentModel, ReceivedDocument"
```

---

## Task 6: Seed dos 3 modelos globais

**Files:**
- Create: `apps/api/prisma/seed-data/document-models/darf-rfb.json` (copiado da POC)
- Create: `apps/api/prisma/seed-data/document-models/das-guia.json` (copiado da POC)
- Create: `apps/api/prisma/seed-data/document-models/pgdas-recibo.json` (copiado da POC)
- Create: `apps/api/prisma/seed-data/document-models/pgdas-declaracao.json` (copiado da POC)
- Modify: `apps/api/prisma/seed.ts` (adiciona chamada ao seed de document models)
- Create: `apps/api/prisma/seed-document-models.ts`
- Test: `apps/api/src/modules/document-reader/document-reader.service.test.ts` (parte 1 — setup, ver
  Task 7 pro resto)

**Interfaces:**
- Produces: dados semeados (`TaxObligationType` com `code` IRPJ, CSLL, DAS, PGDAS-D;
  `DocumentModel` global `darf-rfb`, `das-guia`, `pgdas-recibo`, `pgdas-declaracao`) — usados pelas
  Tasks 7-8 no casamento e pela validação com conjunto separado (Task 14).

- [ ] **Step 1: Copiar os 4 JSONs de modelo da POC**

```bash
cp /home/max/job/autohubs/POC/poc-extracao-pdf/modelos-app/darf-rfb.json apps/api/prisma/seed-data/document-models/
cp /home/max/job/autohubs/POC/poc-extracao-pdf/modelos-app/das-guia.json apps/api/prisma/seed-data/document-models/
cp /home/max/job/autohubs/POC/poc-extracao-pdf/modelos-app/pgdas-recibo.json apps/api/prisma/seed-data/document-models/
cp /home/max/job/autohubs/POC/poc-extracao-pdf/modelos-app/pgdas-declaracao.json apps/api/prisma/seed-data/document-models/
```

Confira cada JSON: `tipoImposto` do DARF é `"DARF"` fixo mas `tipoImpostoCampo: "tributo"` —
precisamos de dois `TaxObligationType` (`IRPJ`, `CSLL`), não um `DARF` — o nome do modelo de
**layout** (`DocumentModel`) é diferente do nome da **obrigação** (`TaxObligationType`); um
`DocumentModel` pode servir a mais de uma obrigação via `subtipos`/`tipoImpostoCampo`. Ajuste o
script de seed (próximo passo) pra isso: o `DocumentModel` referencia **um** `TaxObligationType`
como "principal" só pra fins de organização (ex: IRPJ), mas o `tipoImposto` real do documento lido
em tempo de execução pode ser IRPJ ou CSLL — o casamento (Task 7) usa o `tipoImposto` **extraído**
pelo motor (via `tipoImpostoCampo`), comparado contra o `code` de qualquer `TaxObligationType`
daquela org/global, não só o vinculado ao `DocumentModel`.

- [ ] **Step 2: Escrever `seed-document-models.ts`**

```typescript
// apps/api/prisma/seed-document-models.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/prisma'

const OBRIGACOES = [
  { code: 'IRPJ', name: 'IRPJ' },
  { code: 'CSLL', name: 'CSLL' },
  { code: 'DAS', name: 'DAS — Simples Nacional' },
  { code: 'PGDAS-D', name: 'PGDAS-D — Declaração do Simples Nacional' },
]

const MODELOS = [
  { arquivo: 'darf-rfb.json', obrigacaoPrincipal: 'IRPJ' },
  { arquivo: 'das-guia.json', obrigacaoPrincipal: 'DAS' },
  { arquivo: 'pgdas-recibo.json', obrigacaoPrincipal: 'PGDAS-D' },
  { arquivo: 'pgdas-declaracao.json', obrigacaoPrincipal: 'PGDAS-D' },
]

export async function seedDocumentModels() {
  const obrigacoesPorCode = new Map<string, string>()
  for (const o of OBRIGACOES) {
    const criada = await prisma.taxObligationType.upsert({
      where: { organizationId_code: { organizationId: null as unknown as string, code: o.code } },
      update: {},
      create: { code: o.code, name: o.name, organizationId: null },
    })
    obrigacoesPorCode.set(o.code, criada.id)
  }

  for (const m of MODELOS) {
    const definicao = JSON.parse(
      readFileSync(join(import.meta.dirname, 'seed-data/document-models', m.arquivo), 'utf-8'),
    )
    const taxObligationTypeId = obrigacoesPorCode.get(m.obrigacaoPrincipal)!
    const existente = await prisma.documentModel.findFirst({
      where: { organizationId: null, name: definicao.nome },
    })
    if (existente) continue // seed idempotente — não duplica em reruns
    await prisma.documentModel.create({
      data: { organizationId: null, taxObligationTypeId, name: definicao.nome, definicao },
    })
  }

  console.log(`Seed: ${OBRIGACOES.length} obrigações fiscais + ${MODELOS.length} modelos globais`)
}
```

Nota: `@@unique([organizationId, code])` com `organizationId` nulo — Postgres trata múltiplos
`NULL` como distintos por padrão em índice único, então o `upsert` acima por si só não garante
idempotência real entre reruns do seed. Ajuste: troque a condição de unicidade por um
`findFirst({ where: { organizationId: null, code: o.code } })` antes do create, igual já foi feito
pro `DocumentModel` acima — aplique o mesmo padrão no loop de `OBRIGACOES`.

- [ ] **Step 3: Chamar no seed principal**

Em `apps/api/prisma/seed.ts`, adicione a chamada (olhe o arquivo pra ver onde os outros seeds —
planos padrão etc. — são chamados, e siga o mesmo padrão):

```typescript
import { seedDocumentModels } from './seed-document-models'
// ... no corpo do main():
await seedDocumentModels()
```

- [ ] **Step 4: Rodar o seed e conferir**

```bash
pnpm --filter api prisma db seed
```

Expected: saída "Seed: 4 obrigações fiscais + 4 modelos globais", sem erro. Rodar de novo deve
imprimir a mesma coisa sem duplicar (idempotente).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/seed-data apps/api/prisma/seed-document-models.ts apps/api/prisma/seed.ts
git commit -m "feat(document-reader): semeia obrigações e modelos globais (DARF/IRPJ/CSLL, DAS, PGDAS-D)"
```

---

## Task 7: Resolvedores assíncronos e orquestração

**Files:**
- Create: `apps/api/src/modules/document-reader/document-reader.service.ts`
- Test: `apps/api/src/modules/document-reader/document-reader.service.test.ts`

**Interfaces:**
- Consumes: `extrairEInterpretar`, `decidir`, `Base`, `Modelo` (Task 4); `prisma` (`@/lib/prisma`).
- Produces: `processarDocumento(receivedDocumentId: string): Promise<void>` — roda o motor, resolve
  cliente/tarefas reais, chama `decidir`, grava o resultado em `ReceivedDocument` — usado pelo
  worker (Task 9).

- [ ] **Step 1: Escrever o teste**

```typescript
// apps/api/src/modules/document-reader/document-reader.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { processarDocumento } from './document-reader.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient,
  createTestBoard, createTestColumn, createTestDepartment,
} from '@/test/helpers'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

vi.mock('@/lib/b2', () => ({
  uploadFile: vi.fn(),
  getSignedDownloadUrl: vi.fn(),
  downloadFile: vi.fn(),
}))

async function setupObrigacaoETarefa(org: { id: string }, cnpj: string) {
  const dept = await createTestDepartment(org.id)
  const client = await createTestClient(org.id, { cnpj })
  const board = await createTestBoard(org.id, client.id)
  const column = await createTestColumn(board.id)
  const obrigacao = await prisma.taxObligationType.create({
    data: { code: 'TESTE', name: 'Obrigação de Teste', organizationId: null },
  })
  const template = await prisma.recurringTaskTemplate.create({
    data: {
      organizationId: org.id, departmentId: dept.id, title: 'Teste', periodicity: 'MONTHLY',
      dueDayOfPeriod: 10, generationDayOfPeriod: 1, taxObligationTypeId: obrigacao.id,
    },
  })
  const task = await prisma.task.create({
    data: {
      title: 'Obrigação de Teste — 2026-08', columnId: column.id, departmentId: dept.id,
      competence: new Date(Date.UTC(2026, 7, 1)), recurringTemplateId: template.id, position: 0,
    },
  })
  const modelo = await prisma.documentModel.create({
    data: {
      organizationId: null, taxObligationTypeId: obrigacao.id, name: 'Modelo de Teste',
      definicao: {
        ancoras: [{ texto: 'Documento de Arrecadação', pagina: 1, x: 0.1, y: 0.05 }],
        zonas: [
          { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
          { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
          { campo: 'numero_documento', pagina: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.02, tipo: 'texto', opcional: true },
        ],
        tipoImpostoCampo: undefined,
      },
    },
  })
  return { task, modelo, client }
}

describe('processarDocumento', () => {
  it('anexa automaticamente a sugestão quando confiança alta e única tarefa candidata — mas fica PENDING (modo sombra v1 não anexa sozinho)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task } = await setupObrigacaoETarefa(org, '11222333000181')

    // PDF sintético gerado via pdfkit, mesmo padrão do teste de pipeline.test.ts — ver helper abaixo
    const pdf = await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'agosto/2026')
    const doc = await prisma.receivedDocument.create({
      data: {
        organizationId: org.id, fileHash: 'hash-1', storageKey: 'k1',
        uploadedById: admin.id, status: 'PENDING',
      },
    })
    vi.spyOn(await import('@/lib/b2'), 'downloadFile').mockResolvedValue(Buffer.from(pdf))

    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('PENDING') // v1: nunca ATTACHED sozinho, só sugere
    expect(atualizado.taskId).toBe(task.id)
    expect(atualizado.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('status NOT_IDENTIFIED quando nenhum modelo reconhece o PDF', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const pdf = await gerarPdfComDocumentoArrecadacao('', '') // sem âncora nenhuma reconhecível
    const doc = await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'hash-2', storageKey: 'k2', uploadedById: admin.id, status: 'PENDING' },
    })
    vi.spyOn(await import('@/lib/b2'), 'downloadFile').mockResolvedValue(Buffer.from('%PDF-1.4 sem texto algum'))

    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('NOT_IDENTIFIED')
  })

  it('isola modelos por organização — não reconhece com DocumentModel de outra org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const outraOrg = await createTestOrg(plan.id, { slug: 'outra-org-document-reader' })
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { modelo } = await setupObrigacaoETarefa(outraOrg, '11222333000181') // modelo pertence a OUTRA org

    const pdf = await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'agosto/2026')
    const doc = await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'hash-3', storageKey: 'k3', uploadedById: admin.id, status: 'PENDING' },
    })
    vi.spyOn(await import('@/lib/b2'), 'downloadFile').mockResolvedValue(Buffer.from(pdf))

    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.documentModelId).not.toBe(modelo.id)
    expect(atualizado.status).toBe('NOT_IDENTIFIED') // org atual não tem nenhum modelo que reconheça
  })

  it('PDF corrompido/com erro de parsing vira NOT_IDENTIFIED com o motivo registrado, não fica preso em PENDING', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const doc = await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'hash-corrompido', storageKey: 'k-corrompido', uploadedById: admin.id, status: 'PENDING' },
    })
    vi.spyOn(await import('@/lib/b2'), 'downloadFile').mockResolvedValue(Buffer.from('não é um PDF de verdade, vai falhar no parse'))

    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('NOT_IDENTIFIED')
    expect((atualizado.extractedFields as any)._erro).toBeDefined()
  })

  it('não sugere uma Task já DONE pra mesma competência — fica sem tarefa candidata', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task } = await setupObrigacaoETarefa(org, '11222333000181')
    await prisma.task.update({ where: { id: task.id }, data: { status: 'DONE' } })

    const pdf = await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'agosto/2026')
    const doc = await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'hash-4', storageKey: 'k4', uploadedById: admin.id, status: 'PENDING' },
    })
    vi.spyOn(await import('@/lib/b2'), 'downloadFile').mockResolvedValue(Buffer.from(pdf))

    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.taskId).toBeNull() // obrigação já cumprida — nenhuma tarefa aberta candidata
  })

  it('marca aviso de possível duplicata quando outro ReceivedDocument da mesma org já tem o mesmo numero_documento', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    await setupObrigacaoETarefa(org, '11222333000181')
    await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'hash-anterior', storageKey: 'k-anterior', uploadedById: admin.id, status: 'ATTACHED', documentNumber: '12345678901' },
    })

    const pdf = await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'agosto/2026', '12345678901')
    const doc = await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'hash-5', storageKey: 'k5', uploadedById: admin.id, status: 'PENDING' },
    })
    vi.spyOn(await import('@/lib/b2'), 'downloadFile').mockResolvedValue(Buffer.from(pdf))

    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.documentNumber).toBe('12345678901')
    expect((atualizado.extractedFields as any)._possivelDuplicataDe).toBeDefined()
  })
})
```

Esse teste usa um helper `gerarPdfComDocumentoArrecadacao` que ainda não existe — crie em
`apps/api/src/test/pdf-helpers.ts` (mesma técnica do teste de `pipeline.test.ts`, Task 4, só
parametrizado):

```typescript
// apps/api/src/test/pdf-helpers.ts
import PDFDocument from 'pdfkit'
import { PassThrough } from 'node:stream'

export async function gerarPdfComDocumentoArrecadacao(
  cnpj: string,
  competencia: string,
  numeroDocumento?: string,
): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: 'A4', margin: 0 })
  const stream = doc.pipe(new PassThrough())
  const chunks: Buffer[] = []
  stream.on('data', (c) => chunks.push(c))
  if (cnpj) doc.fontSize(10).text('Documento de Arrecadação', 0.1 * doc.page.width, 0.05 * doc.page.height)
  if (cnpj) doc.fontSize(10).text(cnpj, 0.1 * doc.page.width, 0.1 * doc.page.height)
  if (competencia) doc.fontSize(10).text(competencia, 0.1 * doc.page.width, 0.15 * doc.page.height)
  if (numeroDocumento) doc.fontSize(10).text(numeroDocumento, 0.1 * doc.page.width, 0.2 * doc.page.height)
  doc.end()
  await new Promise((resolve) => stream.on('end', resolve))
  return new Uint8Array(Buffer.concat(chunks))
}
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader.service.test.ts`
Expected: FAIL — `document-reader.service.ts` não existe, nem `downloadFile` em `@/lib/b2`.

- [ ] **Step 3: Adicionar `downloadFile` em `@/lib/b2.ts`**

Esse helper não existe ainda (o B2 client só tem upload/signed-url/delete). Adicione, seguindo o
mesmo padrão dos outros:

```typescript
// em apps/api/src/lib/b2.ts, junto dos outros exports
export async function downloadFile(key: string): Promise<Buffer> {
  const response = await b2.send(new GetObjectCommand({ Bucket: process.env.B2_BUCKET_NAME, Key: key }))
  const chunks: Uint8Array[] = []
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) chunks.push(chunk)
  return Buffer.concat(chunks)
}
```

- [ ] **Step 4: Escrever `document-reader.service.ts` (parte 1: `processarDocumento`)**

```typescript
// apps/api/src/modules/document-reader/document-reader.service.ts
import { prisma } from '@/lib/prisma'
import { downloadFile } from '@/lib/b2'
import { extrairEInterpretar, decidir, type Modelo, type Base } from './engine/pipeline'

async function carregarModelosDaOrg(organizationId: string): Promise<Modelo[]> {
  const registros = await prisma.documentModel.findMany({
    where: { isActive: true, OR: [{ organizationId: null }, { organizationId }] },
  })
  return registros.map((r) => ({ id: r.id, ...(r.definicao as object) }) as Modelo)
}

export async function processarDocumento(receivedDocumentId: string): Promise<void> {
  const doc = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: receivedDocumentId } })
  // downloadFile fora do try: falha de infra (B2 fora do ar) é transiente, vale a pena o retry do
  // BullMQ (attempts: 3, ver Task 8). Já a extração/interpretação do PDF em si é determinística —
  // um PDF corrompido ou grande demais nunca vai "dar certo" numa segunda tentativa, então captura
  // aqui e marca NOT_IDENTIFIED com o motivo, em vez de deixar o job se esgotar silenciosamente e o
  // documento ficar PENDING pra sempre sem nenhum sinal do que aconteceu.
  const buffer = await downloadFile(doc.storageKey)
  const modelos = await carregarModelosDaOrg(doc.organizationId)

  let resultado
  try {
    resultado = await extrairEInterpretar(buffer, modelos)
  } catch (err) {
    await prisma.receivedDocument.update({
      where: { id: receivedDocumentId },
      data: { status: 'NOT_IDENTIFIED', extractedFields: { _erro: err instanceof Error ? err.message : String(err) } },
    })
    return
  }

  if (resultado.status === 'sem_texto' || resultado.status === 'nao_identificado') {
    await prisma.receivedDocument.update({
      where: { id: receivedDocumentId },
      data: { status: 'NOT_IDENTIFIED', confidence: resultado.confianca, extractedFields: resultado.campos as object },
    })
    return
  }

  const documentModelRecord = resultado.modelo
    ? await prisma.documentModel.findUnique({ where: { id: resultado.modelo } })
    : null

  const documentNumber = resultado.campos['numero_documento']?.valor
  const possivelDuplicata = typeof documentNumber === 'string' && documentNumber
    ? await prisma.receivedDocument.findFirst({
        where: { organizationId: doc.organizationId, documentNumber, id: { not: receivedDocumentId } },
        select: { id: true },
      })
    : null

  const cnpj = resultado.campos['cnpj']?.valor
  const base: Base = { clientes: [], tarefas: [] }
  if (typeof cnpj === 'string') {
    const cliente = await prisma.client.findFirst({
      where: {
        organizationId: doc.organizationId,
        OR: [{ cnpj }, { cpf: cnpj }, { cei: cnpj }, { caepf: cnpj }, { inscricaoEstadual: cnpj }],
      },
    })
    if (cliente) {
      base.clientes = [{ id: cliente.id, razao: cliente.name, cnpj }]
      const periodos = [resultado.periodo].filter((p): p is string => !!p)
      const tarefas = await prisma.task.findMany({
        where: {
          status: { notIn: ['DONE', 'DISREGARDED'] },
          column: { board: { clientId: cliente.id, organizationId: doc.organizationId } },
          recurringTemplate: { taxObligationTypeId: { not: null } },
        },
        select: { id: true, competence: true, recurringTemplate: { select: { taxObligationType: { select: { code: true } } } } },
      })
      base.tarefas = tarefas
        .filter((t) => t.recurringTemplate?.taxObligationType)
        .map((t) => ({
          id: t.id,
          clienteId: cliente.id,
          tipoImposto: t.recurringTemplate!.taxObligationType!.code,
          competencia: competenciaParaRotulo(t.competence),
          status: 'aberta' as const,
        }))
        .filter((t) => periodos.includes(t.competencia))
    }
  }

  const decisao = decidir(resultado.status, resultado.tipoImposto, [resultado.periodo], resultado.campos, resultado.avisos, base)

  await prisma.receivedDocument.update({
    where: { id: receivedDocumentId },
    data: {
      status: 'PENDING', // v1 modo sombra: nunca grava ATTACHED aqui, só sugere — fila de revisão decide
      documentModelId: documentModelRecord?.id,
      modelVersion: documentModelRecord?.version,
      confidence: resultado.confianca,
      extractedFields: resultado.campos as object,
      documentNumber: typeof documentNumber === 'string' ? documentNumber : undefined,
      // Não bloqueia — só um aviso pra fila de revisão (ver Task 10/14). Guardamos o id do
      // possível duplicado dentro de extractedFields pra não precisar de coluna nova só pra isso.
      taskId: decisao.acao === 'anexar' ? decisao.tarefaId : undefined,
    },
  })

  if (possivelDuplicata) {
    await prisma.receivedDocument.update({
      where: { id: receivedDocumentId },
      data: { extractedFields: { ...(resultado.campos as object), _possivelDuplicataDe: possivelDuplicata.id } },
    })
  }
}

// Task.competence é um mês-âncora (DateTime, UTC) — converte pro rótulo "2026-08" que o motor usa
// no casamento. Trimestral/anual também guardam um único mês-âncora (sem campo de cota — ver spec).
function competenciaParaRotulo(competence: Date | null): string {
  if (!competence) return ''
  return `${competence.getUTCFullYear()}-${String(competence.getUTCMonth() + 1).padStart(2, '0')}`
}
```

- [ ] **Step 5: Rodar pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader.service.test.ts`
Expected: PASS — 6/6.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/b2.ts apps/api/src/test/pdf-helpers.ts apps/api/src/modules/document-reader/document-reader.service.ts apps/api/src/modules/document-reader/document-reader.service.test.ts
git commit -m "feat(document-reader): orquestra motor + resolve cliente/tarefa reais (processarDocumento)"
```

---

## Task 8: Ingestão (upload + dedupe + fila)

**Files:**
- Modify: `apps/api/src/modules/document-reader/document-reader.service.ts`
- Modify: `apps/api/src/modules/document-reader/document-reader.service.test.ts`
- Create: `apps/api/src/lib/document-reader-queue.ts`

**Interfaces:**
- Consumes: `Prisma` (pra capturar `P2002`), `uploadFile` (`@/lib/b2`).
- Produces: `ingerirDocumento(organizationId: string, actor: { id: string }, payload: { filename: string; mimeType: string; size: number; buffer: Buffer }): Promise<ReceivedDocument>` —
  usado pela rota (Task 10). `enqueueDocumentReader(receivedDocumentId: string): Promise<void>` —
  usado por `ingerirDocumento` e consumido pelo worker (Task 9).

- [ ] **Step 1: Escrever o teste de `ingerirDocumento`**

```typescript
// adiciona em document-reader.service.test.ts
import { ingerirDocumento } from './document-reader.service'

describe('ingerirDocumento', () => {
  it('cria ReceivedDocument PENDING e enfileira o processamento', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const enqueueSpy = vi.spyOn(await import('@/lib/document-reader-queue'), 'enqueueDocumentReader').mockResolvedValue()

    const doc = await ingerirDocumento(org.id, { id: admin.id }, {
      filename: 'guia.pdf', mimeType: 'application/pdf', size: 100, buffer: Buffer.from('%PDF-1.4'),
    })

    expect(doc.status).toBe('PENDING')
    expect(doc.uploadedById).toBe(admin.id)
    expect(enqueueSpy).toHaveBeenCalledWith(doc.id)
  })

  it('lança 409 (não 500 de constraint bruta) ao reenviar o mesmo arquivo duas vezes', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    vi.spyOn(await import('@/lib/document-reader-queue'), 'enqueueDocumentReader').mockResolvedValue()
    const payload = { filename: 'guia.pdf', mimeType: 'application/pdf', size: 100, buffer: Buffer.from('conteúdo idêntico') }

    await ingerirDocumento(org.id, { id: admin.id }, payload)

    await expect(ingerirDocumento(org.id, { id: admin.id }, payload)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('mesmo arquivo em orgs diferentes não colide (hash é por organização)', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id, { slug: 'org-b-document-reader' })
    const adminA = await createTestUser(orgA.id, { role: 'ORG_ADMIN' })
    const adminB = await createTestUser(orgB.id, { role: 'ORG_ADMIN' })
    vi.spyOn(await import('@/lib/document-reader-queue'), 'enqueueDocumentReader').mockResolvedValue()
    const payload = { filename: 'guia.pdf', mimeType: 'application/pdf', size: 100, buffer: Buffer.from('mesmo conteúdo') }

    await expect(ingerirDocumento(orgA.id, { id: adminA.id }, payload)).resolves.toBeDefined()
    await expect(ingerirDocumento(orgB.id, { id: adminB.id }, payload)).resolves.toBeDefined()
  })
})
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader.service.test.ts -t ingerirDocumento`
Expected: FAIL — `ingerirDocumento`/`enqueueDocumentReader` não existem.

- [ ] **Step 3: Criar a fila**

```typescript
// apps/api/src/lib/document-reader-queue.ts
import { Queue } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'

export const documentReaderQueue = new Queue('document-reader-queue', { connection: bullmqRedis })

export async function enqueueDocumentReader(receivedDocumentId: string): Promise<void> {
  await documentReaderQueue.add('processar', { receivedDocumentId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  })
}
```

- [ ] **Step 4: Adicionar `ingerirDocumento` em `document-reader.service.ts`**

```typescript
// adiciona em document-reader.service.ts
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { AppError } from '@/errors/AppError'
import { uploadFile } from '@/lib/b2'
import { enqueueDocumentReader } from '@/lib/document-reader-queue'

async function getOrgSlug(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { slug: true } })
  return org?.slug ?? organizationId
}

export async function ingerirDocumento(
  organizationId: string,
  actor: { id: string },
  payload: { filename: string; mimeType: string; size: number; buffer: Buffer },
) {
  const fileHash = createHash('sha256').update(payload.buffer).digest('hex')

  const existente = await prisma.receivedDocument.findUnique({
    where: { organizationId_fileHash: { organizationId, fileHash } },
  })
  if (existente) throw new AppError(409, 'Esse arquivo já foi enviado antes')

  const orgSlug = await getOrgSlug(organizationId)
  const storageKey = `document-reader/${orgSlug}/${Date.now()}-${payload.filename}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  let doc
  try {
    doc = await prisma.receivedDocument.create({
      data: { organizationId, fileHash, storageKey, uploadedById: actor.id, status: 'PENDING' },
    })
  } catch (err) {
    // Janela de corrida: duas requisições concorrentes com o mesmo arquivo passam juntas pelo
    // findUnique acima — mesma classe de proteção já usada em protocols.service.ts::createProtocol.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'Esse arquivo já foi enviado antes')
    }
    throw err
  }

  await enqueueDocumentReader(doc.id)
  return doc
}
```

- [ ] **Step 5: Rodar pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader.service.test.ts -t ingerirDocumento`
Expected: PASS — 3/3.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/document-reader-queue.ts apps/api/src/modules/document-reader/document-reader.service.ts apps/api/src/modules/document-reader/document-reader.service.test.ts
git commit -m "feat(document-reader): ingestão com dedupe por hash e fila BullMQ"
```

---

## Task 9: Worker

**Files:**
- Create: `apps/api/src/workers/document-reader.worker.ts`
- Test: `apps/api/src/workers/document-reader.worker.test.ts`
- Modify: `apps/api/src/worker.ts`

**Interfaces:**
- Consumes: `processarDocumento` (Task 7).
- Produces: `processDocumentReaderJob(job): Promise<void>`, `startDocumentReaderWorker(): Worker`.

- [ ] **Step 1: Escrever o teste**

```typescript
// apps/api/src/workers/document-reader.worker.test.ts
import { describe, it, expect, vi } from 'vitest'
import { processDocumentReaderJob } from './document-reader.worker'
import * as service from '@/modules/document-reader/document-reader.service'

describe('processDocumentReaderJob', () => {
  it('chama processarDocumento com o id do job', async () => {
    const spy = vi.spyOn(service, 'processarDocumento').mockResolvedValue()
    await processDocumentReaderJob({ data: { receivedDocumentId: 'doc-1' } })
    expect(spy).toHaveBeenCalledWith('doc-1')
  })

  it('erro ao processar não trava o job pra sempre — propaga pro retry do BullMQ (attempts: 3 já configurado na fila)', async () => {
    vi.spyOn(service, 'processarDocumento').mockRejectedValue(new Error('PDF corrompido'))
    await expect(processDocumentReaderJob({ data: { receivedDocumentId: 'doc-2' } })).rejects.toThrow('PDF corrompido')
  })
})
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/workers/document-reader.worker.test.ts`
Expected: FAIL — arquivo não existe.

- [ ] **Step 3: Escrever o worker**

```typescript
// apps/api/src/workers/document-reader.worker.ts
import { Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { processarDocumento } from '@/modules/document-reader/document-reader.service'

export async function processDocumentReaderJob(job: { data: { receivedDocumentId: string } }): Promise<void> {
  await processarDocumento(job.data.receivedDocumentId)
}

export function startDocumentReaderWorker() {
  return new Worker('document-reader-queue', processDocumentReaderJob, {
    connection: bullmqRedis,
    concurrency: 2, // PDF é entrada não confiável — baixa concorrência, mesmo espírito do INTEGRACAO.md
  })
}
```

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/workers/document-reader.worker.test.ts`
Expected: PASS — 2/2.

- [ ] **Step 5: Ligar o worker em `worker.ts`**

```typescript
// apps/api/src/worker.ts — adicione o import e a chamada
import { startDocumentReaderWorker } from '@/workers/document-reader.worker'
// ... no main():
startDocumentReaderWorker()
```

Atualize também a mensagem de log final pra mencionar o novo worker.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workers/document-reader.worker.ts apps/api/src/workers/document-reader.worker.test.ts apps/api/src/worker.ts
git commit -m "feat(document-reader): worker BullMQ processa job de leitura de documento"
```

---

## Task 10: Ações da fila de revisão

**Files:**
- Modify: `apps/api/src/modules/document-reader/document-reader.service.ts`
- Modify: `apps/api/src/modules/document-reader/document-reader.service.test.ts`

**Interfaces:**
- Consumes: `createAttachment` (`@/modules/attachments/attachments.service.ts`), `downloadFile`
  (`@/lib/b2`).
- Produces: `listarFilaDeRevisao(organizationId): Promise<ReceivedDocument[]>`,
  `confirmarSugestao(id, organizationId, actor): Promise<Attachment>`,
  `trocarTarefa(id, organizationId, taskId, actor): Promise<Attachment>`,
  `rejeitarDocumento(id, organizationId, actor): Promise<void>`,
  `reabrirDocumento(id, organizationId): Promise<void>` — usados pelas rotas (Task 11).

- [ ] **Step 1: Escrever o teste**

```typescript
// adiciona em document-reader.service.test.ts
import { confirmarSugestao, trocarTarefa, rejeitarDocumento, reabrirDocumento, listarFilaDeRevisao } from './document-reader.service'

describe('ações da fila de revisão', () => {
  async function docComSugestao() {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, admin.id, { departmentId: dept.id })
    const doc = await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'h', storageKey: 'k', uploadedById: admin.id, status: 'PENDING', taskId: task.id },
    })
    return { org, admin, task, doc }
  }

  it('confirmarSugestao anexa via createAttachment e marca ATTACHED', async () => {
    const { org, admin, task, doc } = await docComSugestao()
    vi.spyOn(await import('@/lib/b2'), 'downloadFile').mockResolvedValue(Buffer.from('%PDF-1.4'))
    vi.spyOn(await import('@/lib/b2'), 'uploadFile').mockResolvedValue(undefined as never)

    await confirmarSugestao(doc.id, org.id, { id: admin.id, role: 'ORG_ADMIN' })

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('ATTACHED')
    expect(atualizado.how).toBe('confirmado')
    expect(atualizado.attachmentId).not.toBeNull()
    const attachment = await prisma.attachment.findUniqueOrThrow({ where: { id: atualizado.attachmentId! } })
    expect(attachment.taskId).toBe(task.id)
  })

  it('trocarTarefa anexa na tarefa escolhida pelo revisor, não na sugerida', async () => {
    const { org, admin, doc } = await docComSugestao()
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const outraTask = await createTestTask(column.id, admin.id, { departmentId: dept.id })
    vi.spyOn(await import('@/lib/b2'), 'downloadFile').mockResolvedValue(Buffer.from('%PDF-1.4'))
    vi.spyOn(await import('@/lib/b2'), 'uploadFile').mockResolvedValue(undefined as never)

    await trocarTarefa(doc.id, org.id, outraTask.id, { id: admin.id, role: 'ORG_ADMIN' })

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.how).toBe('trocado')
    const attachment = await prisma.attachment.findUniqueOrThrow({ where: { id: atualizado.attachmentId! } })
    expect(attachment.taskId).toBe(outraTask.id)
  })

  it('rejeitarDocumento marca REJECTED sem criar anexo', async () => {
    const { org, admin, doc } = await docComSugestao()

    await rejeitarDocumento(doc.id, org.id, { id: admin.id, role: 'ORG_ADMIN' })

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('REJECTED')
    expect(atualizado.attachmentId).toBeNull()
  })

  it('reabrirDocumento volta REJECTED pra PENDING', async () => {
    const { org, admin, doc } = await docComSugestao()
    await rejeitarDocumento(doc.id, org.id, { id: admin.id, role: 'ORG_ADMIN' })

    await reabrirDocumento(doc.id, org.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('PENDING')
  })

  it('listarFilaDeRevisao só mostra PENDING/NOT_IDENTIFIED da própria org', async () => {
    const { org, doc } = await docComSugestao()
    const plan = await createTestPlan()
    const outraOrg = await createTestOrg(plan.id)
    const outroAdmin = await createTestUser(outraOrg.id, { role: 'ORG_ADMIN' })
    await prisma.receivedDocument.create({
      data: { organizationId: outraOrg.id, fileHash: 'h2', storageKey: 'k2', uploadedById: outroAdmin.id, status: 'PENDING' },
    })

    const fila = await listarFilaDeRevisao(org.id)

    expect(fila.map((d) => d.id)).toEqual([doc.id])
  })
})
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader.service.test.ts -t "fila de revisão"`
Expected: FAIL — funções não existem.

- [ ] **Step 3: Implementar**

```typescript
// adiciona em document-reader.service.ts
import { createAttachment } from '@/modules/attachments/attachments.service'

export async function listarFilaDeRevisao(organizationId: string) {
  return prisma.receivedDocument.findMany({
    where: { organizationId, status: { in: ['PENDING', 'NOT_IDENTIFIED'] } },
    orderBy: { createdAt: 'asc' },
  })
}

async function anexarDocumento(
  receivedDocumentId: string,
  organizationId: string,
  taskId: string,
  actor: { id: string; role: string },
  how: 'confirmado' | 'trocado' | 'criado',
) {
  const doc = await prisma.receivedDocument.findFirst({ where: { id: receivedDocumentId, organizationId } })
  if (!doc) throw new AppError(404, 'Documento não encontrado')

  const buffer = await downloadFile(doc.storageKey)
  const filename = doc.storageKey.split('/').pop() ?? 'documento.pdf'
  const attachment = await createAttachment(taskId, organizationId, actor, {
    filename, mimeType: 'application/pdf', size: buffer.length, buffer,
  })

  await prisma.receivedDocument.update({
    where: { id: receivedDocumentId },
    data: { status: 'ATTACHED', taskId, attachmentId: attachment.id, how, reviewedById: actor.id, reviewedAt: new Date() },
  })
  return attachment
}

export async function confirmarSugestao(receivedDocumentId: string, organizationId: string, actor: { id: string; role: string }) {
  const doc = await prisma.receivedDocument.findFirst({ where: { id: receivedDocumentId, organizationId } })
  if (!doc) throw new AppError(404, 'Documento não encontrado')
  if (!doc.taskId) throw new AppError(422, 'Esse documento não tem tarefa sugerida — use trocarTarefa')
  return anexarDocumento(receivedDocumentId, organizationId, doc.taskId, actor, 'confirmado')
}

export async function trocarTarefa(receivedDocumentId: string, organizationId: string, taskId: string, actor: { id: string; role: string }) {
  return anexarDocumento(receivedDocumentId, organizationId, taskId, actor, 'trocado')
}

export async function rejeitarDocumento(receivedDocumentId: string, organizationId: string, actor: { id: string; role: string }) {
  const doc = await prisma.receivedDocument.findFirst({ where: { id: receivedDocumentId, organizationId } })
  if (!doc) throw new AppError(404, 'Documento não encontrado')
  await prisma.receivedDocument.update({
    where: { id: receivedDocumentId },
    data: { status: 'REJECTED', how: 'rejeitado', reviewedById: actor.id, reviewedAt: new Date() },
  })
}

export async function reabrirDocumento(receivedDocumentId: string, organizationId: string) {
  const doc = await prisma.receivedDocument.findFirst({ where: { id: receivedDocumentId, organizationId } })
  if (!doc) throw new AppError(404, 'Documento não encontrado')
  await prisma.receivedDocument.update({ where: { id: receivedDocumentId }, data: { status: 'PENDING' } })
}
```

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader.service.test.ts -t "fila de revisão"`
Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/document-reader/document-reader.service.ts apps/api/src/modules/document-reader/document-reader.service.test.ts
git commit -m "feat(document-reader): ações da fila de revisão (confirmar/trocar/rejeitar/reabrir)"
```

---

## Task 11: Rotas Fastify

**Files:**
- Create: `apps/api/src/modules/document-reader/document-reader.schema.ts`
- Create: `apps/api/src/modules/document-reader/document-reader.routes.ts`
- Test: `apps/api/src/modules/document-reader/document-reader.routes.test.ts`
- Modify: `apps/api/src/app.ts` (registra as rotas novas)

**Interfaces:**
- Consumes: `ingerirDocumento`, `listarFilaDeRevisao`, `confirmarSugestao`, `trocarTarefa`,
  `rejeitarDocumento`, `reabrirDocumento` (Tasks 8-10).

- [ ] **Step 1: Escrever o schema Zod**

```typescript
// apps/api/src/modules/document-reader/document-reader.schema.ts
import { z } from 'zod'

export const trocarTarefaBodySchema = z.object({
  taskId: z.string().cuid(),
})
```

- [ ] **Step 2: Escrever o teste das rotas**

```typescript
// apps/api/src/modules/document-reader/document-reader.routes.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildApp } from '@/server'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestUser, loginAsTestUser } from '@/test/helpers'

vi.mock('@/lib/b2', () => ({ uploadFile: vi.fn(), downloadFile: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4')), getSignedDownloadUrl: vi.fn() }))
vi.mock('@/lib/document-reader-queue', () => ({ enqueueDocumentReader: vi.fn() }))

describe('POST /document-reader/upload', () => {
  it('ORG_MEMBER sobe um PDF e recebe o ReceivedDocument criado', async () => {
    const app = buildApp()
    await app.ready()
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const token = await loginAsTestUser(member)

    const form = new FormData()
    form.append('file', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), 'guia.pdf')
    const res = await app.inject({ method: 'POST', url: '/document-reader/upload', headers: { authorization: `Bearer ${token}` }, payload: form })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).status).toBe('PENDING')
    await app.close()
  })
})

describe('GET /document-reader/fila', () => {
  it('lista só os documentos pendentes da própria org', async () => {
    const app = buildApp()
    await app.ready()
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const token = await loginAsTestUser(admin)
    await prisma.receivedDocument.create({ data: { organizationId: org.id, fileHash: 'h', storageKey: 'k', uploadedById: admin.id, status: 'PENDING' } })

    const res = await app.inject({ method: 'GET', url: '/document-reader/fila', headers: { authorization: `Bearer ${token}` } })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toHaveLength(1)
    await app.close()
  })
})

describe('POST /document-reader/:id/confirmar', () => {
  it('lança 422 quando o documento não tem tarefa sugerida', async () => {
    const app = buildApp()
    await app.ready()
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const token = await loginAsTestUser(admin)
    const doc = await prisma.receivedDocument.create({ data: { organizationId: org.id, fileHash: 'h', storageKey: 'k', uploadedById: admin.id, status: 'PENDING' } })

    const res = await app.inject({ method: 'POST', url: `/document-reader/${doc.id}/confirmar`, headers: { authorization: `Bearer ${token}` } })

    expect(res.statusCode).toBe(422)
    await app.close()
  })
})
```

Verifique se `loginAsTestUser` já existe em `@/test/helpers` — se não existir, veja como outros
testes de rota (ex: `protocols.routes.test.ts`) geram o token de teste e siga o mesmo padrão.

- [ ] **Step 3: Rodar pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader.routes.test.ts`
Expected: FAIL — rotas não existem.

- [ ] **Step 4: Escrever as rotas**

```typescript
// apps/api/src/modules/document-reader/document-reader.routes.ts
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import {
  ingerirDocumento, listarFilaDeRevisao, confirmarSugestao, trocarTarefa, rejeitarDocumento, reabrirDocumento,
} from './document-reader.service'
import { trocarTarefaBodySchema } from './document-reader.schema'

const MAX_FILE_SIZE = 20 * 1024 * 1024
const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] as const

export async function documentReaderRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })
  app.addHook('preHandler', verifyJWT)

  app.post('/document-reader/upload', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    let file: Awaited<ReturnType<typeof request.file>>
    try {
      file = await request.file()
    } catch (err: unknown) {
      const e = err as { statusCode?: number; code?: string }
      if (e?.statusCode === 413 || e?.code === 'FST_FILES_LIMIT' || e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(413, 'Arquivo excede o limite de 20MB')
      }
      throw err
    }
    if (!file) throw new AppError(400, 'Nenhum arquivo enviado')
    if (file.mimetype !== 'application/pdf') {
      await file.toBuffer().catch(() => {})
      throw new AppError(422, 'Só PDF é aceito')
    }

    const buffer = await file.toBuffer()
    if (buffer.length > MAX_FILE_SIZE) throw new AppError(413, 'Arquivo excede o limite de 20MB')

    const doc = await ingerirDocumento(request.user.organizationId!, { id: request.user.sub }, {
      filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer,
    })
    return reply.status(201).send(doc)
  })

  app.get('/document-reader/fila', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    return reply.send(await listarFilaDeRevisao(request.user.organizationId!))
  })

  app.post('/document-reader/:id/confirmar', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await confirmarSugestao(id, request.user.organizationId!, { id: request.user.sub, role: request.user.role }))
  })

  app.post('/document-reader/:id/trocar-tarefa', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = trocarTarefaBodySchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await trocarTarefa(id, request.user.organizationId!, result.data.taskId, { id: request.user.sub, role: request.user.role }))
  })

  app.post('/document-reader/:id/rejeitar', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await rejeitarDocumento(id, request.user.organizationId!, { id: request.user.sub, role: request.user.role })
    return reply.status(204).send()
  })

  app.post('/document-reader/:id/reabrir', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await reabrirDocumento(id, request.user.organizationId!)
    return reply.status(204).send()
  })
}
```

- [ ] **Step 5: Registrar as rotas em `app.ts`**

Olhe como `protocolsRoutes`/`attachmentsRoutes` são registradas em `apps/api/src/app.ts` e siga o
mesmo padrão pra `documentReaderRoutes`.

- [ ] **Step 6: Rodar pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader.routes.test.ts`
Expected: PASS — 3/3.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/document-reader/document-reader.schema.ts apps/api/src/modules/document-reader/document-reader.routes.ts apps/api/src/modules/document-reader/document-reader.routes.test.ts apps/api/src/app.ts
git commit -m "feat(document-reader): rotas de upload e fila de revisão"
```

---

## Task 12: Expurgo de documentos rejeitados (LGPD)

**Files:**
- Create: `apps/api/src/workers/document-reader-purge.cron.ts`
- Test: `apps/api/src/workers/document-reader-purge.cron.test.ts`
- Modify: `apps/api/src/worker.ts`

**Interfaces:**
- Consumes: `deleteFile` (`@/lib/b2`).
- Produces: `purgeRejectedDocuments(now?: Date): Promise<number>`, `startDocumentReaderPurgeCronWorker()`.

- [ ] **Step 1: Escrever o teste**

```typescript
// apps/api/src/workers/document-reader-purge.cron.test.ts
import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { purgeRejectedDocuments } from './document-reader-purge.cron'
import { createTestPlan, createTestOrg, createTestUser } from '@/test/helpers'

vi.mock('@/lib/b2', () => ({ deleteFile: vi.fn() }))

describe('purgeRejectedDocuments', () => {
  it('expurga REJECTED com mais de 30 dias, apagando do B2 e limpando campos extraídos', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const antigo = await prisma.receivedDocument.create({
      data: {
        organizationId: org.id, fileHash: 'h1', storageKey: 'k1', uploadedById: admin.id,
        status: 'REJECTED', extractedFields: { cnpj: { valor: '11222333000181' } },
        reviewedAt: new Date(Date.UTC(2026, 8, 1)),
      },
    })

    const count = await purgeRejectedDocuments(new Date(Date.UTC(2026, 9, 15))) // 44 dias depois

    expect(count).toBe(1)
    const deleteFileSpy = await import('@/lib/b2')
    expect(deleteFileSpy.deleteFile).toHaveBeenCalledWith('k1')
    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: antigo.id } })
    expect(atualizado.extractedFields).toBeNull()
  })

  it('não expurga REJECTED com menos de 30 dias', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    await prisma.receivedDocument.create({
      data: {
        organizationId: org.id, fileHash: 'h2', storageKey: 'k2', uploadedById: admin.id,
        status: 'REJECTED', reviewedAt: new Date(Date.UTC(2026, 9, 1)),
      },
    })

    const count = await purgeRejectedDocuments(new Date(Date.UTC(2026, 9, 15))) // 14 dias depois

    expect(count).toBe(0)
  })

  it('não mexe em PENDING/NOT_IDENTIFIED, mesmo antigo — é trabalho em aberto', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    await prisma.receivedDocument.create({
      data: {
        organizationId: org.id, fileHash: 'h3', storageKey: 'k3', uploadedById: admin.id,
        status: 'PENDING', createdAt: new Date(Date.UTC(2026, 1, 1)),
      },
    })

    const count = await purgeRejectedDocuments(new Date(Date.UTC(2026, 9, 15)))

    expect(count).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/workers/document-reader-purge.cron.test.ts`
Expected: FAIL — arquivo não existe.

- [ ] **Step 3: Escrever o cron**

```typescript
// apps/api/src/workers/document-reader-purge.cron.ts
import { Queue, Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { deleteFile } from '@/lib/b2'

const DIAS_RETENCAO_REJECTED = 30

export async function purgeRejectedDocuments(now: Date = new Date()): Promise<number> {
  const limite = new Date(now.getTime() - DIAS_RETENCAO_REJECTED * 24 * 60 * 60 * 1000)
  const expirados = await prisma.receivedDocument.findMany({
    where: { status: 'REJECTED', reviewedAt: { lt: limite } },
    select: { id: true, storageKey: true },
  })

  for (const doc of expirados) {
    await deleteFile(doc.storageKey)
    await prisma.receivedDocument.update({ where: { id: doc.id }, data: { extractedFields: undefined, storageKey: '' } })
  }

  return expirados.length
}

export async function startDocumentReaderPurgeCronWorker() {
  const cronQueue = new Queue('document-reader-purge-cron', { connection: bullmqRedis })
  await cronQueue.add('purge', {}, {
    repeat: { pattern: '0 3 * * *', tz: 'America/Sao_Paulo' }, // 3h BRT, fora do horário dos outros crons
    jobId: 'document-reader-purge',
  })
  return new Worker('document-reader-purge-cron', async () => {
    await purgeRejectedDocuments()
  }, { connection: bullmqRedis })
}
```

Nota: `data: { extractedFields: undefined, storageKey: '' }` com Prisma não limpa `extractedFields`
pra `null` (undefined é "não mude este campo" no Prisma, não "apague"). Corrija pra
`data: { extractedFields: Prisma.JsonNull, storageKey: '' }` (importe `Prisma` de `@prisma/client`).

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/workers/document-reader-purge.cron.test.ts`
Expected: PASS — 3/3.

- [ ] **Step 5: Ligar o worker em `worker.ts`**

Mesmo padrão da Task 9 — importe `startDocumentReaderPurgeCronWorker` e chame com `await` no `main()`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workers/document-reader-purge.cron.ts apps/api/src/workers/document-reader-purge.cron.test.ts apps/api/src/worker.ts
git commit -m "feat(document-reader): cron de expurgo LGPD (REJECTED > 30 dias)"
```

---

## Task 13: Métricas

**Files:**
- Modify: `apps/api/src/modules/document-reader/document-reader.service.ts`
- Modify: `apps/api/src/modules/document-reader/document-reader.service.test.ts`
- Modify: `apps/api/src/modules/document-reader/document-reader.routes.ts`
- Modify: `apps/api/src/modules/document-reader/document-reader.routes.test.ts`

**Interfaces:**
- Produces: `obterMetricas(organizationId): Promise<{ porModelo: { documentModelId: string; nome: string; confirmados: number; trocados: number; rejeitados: number }[] }>`.

- [ ] **Step 1: Escrever o teste**

```typescript
// adiciona em document-reader.service.test.ts
import { obterMetricas } from './document-reader.service'

describe('obterMetricas', () => {
  it('conta só decisão humana (how), por modelo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await prisma.taxObligationType.create({ data: { code: 'T', name: 'T', organizationId: null } })
    const modelo = await prisma.documentModel.create({ data: { organizationId: null, taxObligationTypeId: obrigacao.id, name: 'Modelo X', definicao: {} } })
    await prisma.receivedDocument.createMany({
      data: [
        { organizationId: org.id, fileHash: 'h1', storageKey: 'k1', uploadedById: admin.id, status: 'ATTACHED', how: 'confirmado', documentModelId: modelo.id },
        { organizationId: org.id, fileHash: 'h2', storageKey: 'k2', uploadedById: admin.id, status: 'ATTACHED', how: 'trocado', documentModelId: modelo.id },
        { organizationId: org.id, fileHash: 'h3', storageKey: 'k3', uploadedById: admin.id, status: 'REJECTED', how: 'rejeitado', documentModelId: modelo.id },
        { organizationId: org.id, fileHash: 'h4', storageKey: 'k4', uploadedById: admin.id, status: 'PENDING' }, // ainda não é decisão humana
      ],
    })

    const metricas = await obterMetricas(org.id)

    expect(metricas.porModelo).toEqual([
      { documentModelId: modelo.id, nome: 'Modelo X', confirmados: 1, trocados: 1, rejeitados: 1 },
    ])
  })
})
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader.service.test.ts -t obterMetricas`
Expected: FAIL — `obterMetricas` não existe.

- [ ] **Step 3: Implementar**

```typescript
// adiciona em document-reader.service.ts
export async function obterMetricas(organizationId: string) {
  const docs = await prisma.receivedDocument.findMany({
    where: { organizationId, how: { in: ['confirmado', 'trocado', 'rejeitado'] }, documentModelId: { not: null } },
    select: { how: true, documentModel: { select: { id: true, name: true } } },
  })

  const porModeloMap = new Map<string, { documentModelId: string; nome: string; confirmados: number; trocados: number; rejeitados: number }>()
  for (const d of docs) {
    if (!d.documentModel) continue
    const entry = porModeloMap.get(d.documentModel.id) ?? {
      documentModelId: d.documentModel.id, nome: d.documentModel.name, confirmados: 0, trocados: 0, rejeitados: 0,
    }
    if (d.how === 'confirmado') entry.confirmados++
    else if (d.how === 'trocado') entry.trocados++
    else if (d.how === 'rejeitado') entry.rejeitados++
    porModeloMap.set(d.documentModel.id, entry)
  }

  return { porModelo: [...porModeloMap.values()] }
}
```

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader.service.test.ts -t obterMetricas`
Expected: PASS — 1/1.

- [ ] **Step 5: Adicionar a rota**

```typescript
// adiciona em document-reader.routes.ts
app.get('/document-reader/metricas', {
  preHandler: [requireRole(...ORG_ROLES)],
}, async (request, reply) => {
  return reply.send(await obterMetricas(request.user.organizationId!))
})
```

Não esqueça de importar `obterMetricas` no topo do arquivo.

- [ ] **Step 6: Teste da rota**

```typescript
// adiciona em document-reader.routes.test.ts
describe('GET /document-reader/metricas', () => {
  it('devolve porModelo vazio quando não há decisão humana ainda', async () => {
    const app = buildApp()
    await app.ready()
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const token = await loginAsTestUser(admin)

    const res = await app.inject({ method: 'GET', url: '/document-reader/metricas', headers: { authorization: `Bearer ${token}` } })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ porModelo: [] })
    await app.close()
  })
})
```

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader.routes.test.ts`
Expected: PASS — 4/4.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/document-reader/document-reader.service.ts apps/api/src/modules/document-reader/document-reader.service.test.ts apps/api/src/modules/document-reader/document-reader.routes.ts apps/api/src/modules/document-reader/document-reader.routes.test.ts
git commit -m "feat(document-reader): métricas por modelo (só decisão humana)"
```

---

## Task 14: Frontend — fila de revisão

**Files:**
- Create: `apps/web/src/pages/app/document-reader/ReviewQueue.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/components/layout/AppLayout.tsx` (ou onde o menu lateral é definido — link novo)

**Interfaces:**
- Consumes: `GET /document-reader/fila`, `POST /document-reader/upload`,
  `POST /document-reader/:id/confirmar`, `POST /document-reader/:id/trocar-tarefa`,
  `POST /document-reader/:id/rejeitar`, `POST /document-reader/:id/reabrir`,
  `GET /document-reader/metricas` (Tasks 8, 10, 11, 13).

- [ ] **Step 1: Adicionar os tipos**

```typescript
// adiciona em apps/web/src/types/index.ts
export interface ReceivedDocument {
  id: string
  status: 'PENDING' | 'ATTACHED' | 'NOT_IDENTIFIED' | 'REJECTED'
  documentModelId: string | null
  confidence: number | null
  extractedFields: Record<string, { bruto: string; valor: string | number | null; valido: boolean }> | null
  taskId: string | null
  how: string | null
  createdAt: string
}
```

- [ ] **Step 2: Escrever a tela**

```tsx
// apps/web/src/pages/app/document-reader/ReviewQueue.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ReceivedDocument } from '@/types'
import { toast } from 'sonner'

export default function ReviewQueue() {
  const queryClient = useQueryClient()
  const [trocandoId, setTrocandoId] = useState<string | null>(null)
  const [novaTaskId, setNovaTaskId] = useState('')

  const { data: fila = [], isLoading } = useQuery<ReceivedDocument[]>({
    queryKey: ['document-reader-fila'],
    queryFn: () => api.get('/document-reader/fila').then((r) => r.data),
  })

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ['document-reader-fila'] })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post('/document-reader/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: () => { toast.success('Documento enviado pra leitura'); invalidar() },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Erro ao enviar documento'),
  })

  const confirmarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/document-reader/${id}/confirmar`),
    onSuccess: () => { toast.success('Documento anexado'); invalidar() },
    onError: () => toast.error('Erro ao confirmar'),
  })

  const trocarMutation = useMutation({
    mutationFn: ({ id, taskId }: { id: string; taskId: string }) => api.post(`/document-reader/${id}/trocar-tarefa`, { taskId }),
    onSuccess: () => { toast.success('Documento anexado na tarefa escolhida'); setTrocandoId(null); setNovaTaskId(''); invalidar() },
    onError: () => toast.error('Erro ao trocar tarefa'),
  })

  const rejeitarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/document-reader/${id}/rejeitar`),
    onSuccess: () => { toast.success('Documento rejeitado'); invalidar() },
    onError: () => toast.error('Erro ao rejeitar'),
  })

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Fila de revisão — documentos fiscais</h1>
        <label className="cursor-pointer">
          <Button asChild>
            <span>Enviar PDF</span>
          </Button>
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) uploadMutation.mutate(file)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {fila.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum documento pendente.</p>
      ) : (
        <div className="space-y-2">
          {fila.map((doc) => (
            <div key={doc.id} className="rounded-lg border border-border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  {doc.status === 'NOT_IDENTIFIED' ? 'Não identificado' : 'Aguardando revisão'}
                </span>
                {doc.confidence !== null && (
                  <span className="text-xs text-muted-foreground">
                    Confiança: {Math.round(doc.confidence * 100)}%
                  </span>
                )}
              </div>

              {doc.extractedFields && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {Object.entries(doc.extractedFields).map(([campo, v]) => (
                    <p key={campo}>
                      {campo}: {String(v.valor ?? v.bruto)} {!v.valido && <span className="text-danger-text">(inválido)</span>}
                    </p>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                {doc.taskId && (
                  <Button size="sm" onClick={() => confirmarMutation.mutate(doc.id)} disabled={confirmarMutation.isPending}>
                    Confirmar anexo
                  </Button>
                )}
                {trocandoId === doc.id ? (
                  <div className="flex gap-2 items-center">
                    <Input
                      placeholder="ID da tarefa"
                      value={novaTaskId}
                      onChange={(e) => setNovaTaskId(e.target.value)}
                      className="h-8 w-48"
                    />
                    <Button size="sm" variant="outline" onClick={() => trocarMutation.mutate({ id: doc.id, taskId: novaTaskId })}>
                      Anexar nessa tarefa
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setTrocandoId(doc.id)}>
                    Trocar tarefa
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => rejeitarMutation.mutate(doc.id)}>
                  Rejeitar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

Nota: "Trocar tarefa" aqui pede o ID da tarefa digitado manualmente — é o mínimo funcional pro v1.
Um seletor com busca (igual outras telas do app, ex. `app/Requests.tsx`) é uma melhoria de UX
natural, mas não bloqueia a entrega; pode entrar numa iteração rápida depois sem mudar a API.

- [ ] **Step 3: Registrar a rota**

Em `apps/web/src/router.tsx`, adicione (olhe como outras páginas lazy-loaded são registradas e
siga o mesmo padrão):

```typescript
const DocumentReaderQueue = lazy(() => import('@/pages/app/document-reader/ReviewQueue'))
// ...
{ path: 'document-reader', element: <DocumentReaderQueue /> },
```

- [ ] **Step 4: Adicionar o link no menu lateral**

Em `AppLayout.tsx` (ou onde estiver o menu — confira o arquivo real), adicione um item de
navegação "Documentos Fiscais" apontando pra `/app/document-reader`, visível pra `ORG_ADMIN`,
`ORG_MANAGER` e `ORG_MEMBER` (mesmo grupo que já vê "Processos").

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/app/document-reader apps/web/src/router.tsx apps/web/src/types/index.ts apps/web/src/components/layout/AppLayout.tsx
git commit -m "feat(document-reader): tela da fila de revisão"
```

---

## Task 15: Validação com conjunto separado (não é código)

**Files:**
- Nenhum arquivo novo — tarefa de verificação manual.

- [ ] **Step 1: Separar um conjunto de PDFs reais não usados no desenho das zonas**

Peça ao Max 2-3 PDFs de DARF/DAS/PGDAS-D de **clientes e meses diferentes** dos já usados nos
`modelos-app/*.json` originais da POC (que vieram de `amostras-reais/` e `amostras-das/`).

- [ ] **Step 2: Rodar o motor contra esse conjunto, via o endpoint de upload real**

Suba cada PDF por `/document-reader/upload` (ou um script simples chamando `ingerirDocumento`
diretamente) contra uma organização de teste com os 3 modelos globais seedados (Task 6) e clientes/
tarefas reais cadastrados pra bater.

- [ ] **Step 3: Medir e registrar o resultado**

Pra cada PDF: o modelo certo foi reconhecido? Os campos (CNPJ, competência) saíram corretos? A
tarefa certa foi sugerida? Registre quantos de quantos acertaram. Se a taxa ficar baixa, é sinal de
ajuste necessário nas zonas/âncoras do modelo global antes de liberar uso real — não é um bug de
código, é um ajuste do `DocumentModel` (fora do escopo de código desta tarefa).

- [ ] **Step 4: Documentar o resultado**

Anote o resultado (quantos de quantos, por modelo) na ledger do plano antes de prosseguir pra
Task 16 — essa é a evidência de que o motor generaliza além dos PDFs usados pra desenhá-lo, não só
"os mesmos 11 PDFs da POC continuam passando".

---

## Task 16: Documentação e verificação final

**Files:**
- Modify: `docs/TASKS.md`

- [ ] **Step 1: Marcar o item 6 do roadmap como "pipeline central concluído"**

Localize a entrada do item 6 em `docs/TASKS.md` e marque como parcialmente concluída — só o
Plano A (pipeline central); o Plano B (modelagem) ainda está pendente, não marcar como 100%
concluído.

- [ ] **Step 2: Suíte completa da API**

Run: `pnpm --filter api test`
Expected: tudo passando, sem regressão nos módulos existentes.

- [ ] **Step 3: Suíte completa do frontend**

Run: `pnpm --filter web test`
Expected: tudo passando.

- [ ] **Step 4: Typecheck dos dois workspaces**

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter web exec tsc --noEmit
```

Expected: sem erros.

- [ ] **Step 5: Build de produção do frontend**

Run: `pnpm --filter web build`
Expected: build concluído sem erros.

- [ ] **Step 6: Commit final**

```bash
git add docs/TASKS.md
git commit -m "docs: marca pipeline central do robô de documentos fiscais como concluído (Plano A)"
```
