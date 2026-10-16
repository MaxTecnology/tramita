# Modelagem de Documentos (Plano B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao `ORG_ADMIN` uma tela pra cadastrar o próprio `DocumentModel` (âncoras + zonas,
vinculado a um `ObligationType`), em vez de depender só dos 4 modelos globais semeados via script.

**Architecture:** Reusa o motor já existente do Plano A (`extrairDocumento`) pra extrair os itens
de texto de um PDF de amostra, devolve isso ao frontend, que reconstrói a página posicionando
cada item como elemento clicável (sem renderizar o PDF como imagem — mesma técnica da POC). O
usuário marca âncoras/campos clicando nos itens certos; salvar grava um `DocumentModel` privado
da própria organização (nunca global). Backend ganha 2 arquivos novos de módulo
(`document-reader-models.schema.ts`/`.service.ts`/`.routes.ts`) em vez de inchar os arquivos do
Plano A — responsabilidade distinta (cadastro de modelo vs. leitura/revisão de documento).

**Tech Stack:** Fastify + Zod + Prisma (API), React 19 + Vite + TailwindCSS + @tanstack/react-query
(web) — mesmo stack do resto do projeto, sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-16-modelagem-documentos-design.md`

## Global Constraints

- Todas as rotas novas exigem `ORG_ADMIN` (`requireRole('ORG_ADMIN')`) — nunca `ORG_MANAGER`/
  `ORG_MEMBER`, nem para leitura (`GET /document-reader/modelos` incluso).
- Um `DocumentModel` global (`organizationId: null`) nunca é editável nem arquivável por nenhuma
  rota nova — só existe via seed/script, como já era no Plano A.
- Um `DocumentModel`/`ObligationType` privado de uma org nunca é visível, editável ou arquivável
  por outra organização.
- O PDF de amostra enviado pra modelagem nunca é persistido (nem no banco, nem no B2) — só a
  *definição* (âncoras/zonas) salva no final.
- Nenhuma mudança de schema Prisma é necessária — `DocumentModel`/`ObligationType` já existem
  (Plano A + renomeação `3e0c831`).
- `definicao` gravada nunca inclui campo `id` próprio (ficou provado no commit `e31b5b2` que isso
  quebra a resolução de `documentModelId` em `processarDocumento` — o `id` real do `DocumentModel`
  é sempre o cuid do banco).

## Review Focus

- **Editar/arquivar um `DocumentModel` global pela rota nova** — precisa 404 (a query
  `findFirst({ id, organizationId })` com `organizationId` da própria org nunca bate com um
  registro `organizationId: null`), nunca deve ser possível transformar um global em privado ou
  vice-versa.
- **`obligationTypeId` de outra organização no corpo de criar/editar modelo** — precisa 404, nunca
  pode vincular um modelo ao `ObligationType` privado de outro escritório.
- **Modelo salvo sem campo `cnpj` ou sem `competencia`/`periodo_apuracao`** — precisa falhar com
  mensagem clara (400), nunca gravar um modelo que o motor nunca vai conseguir casar com cliente/
  tarefa nenhuma.
- **PDF de amostra sem camada de texto (escaneado)** no endpoint de análise — precisa devolver erro
  claro (422, mesma mensagem de `temTexto: false` que o motor já usa), nunca travar nem devolver
  uma lista de itens vazia sem explicação.
- **Dois campos com o mesmo nome (`campo`) na mesma definição** — precisa falhar com mensagem
  clara (400), nunca sobrescrever um pelo outro silenciosamente na hora de interpretar o PDF.

---

### Task 1: Criar `ObligationType` inline

**Files:**
- Create: `apps/api/src/modules/document-reader/document-reader-models.schema.ts`
- Create: `apps/api/src/modules/document-reader/document-reader-models.service.ts`
- Test: `apps/api/src/modules/document-reader/document-reader-models.service.test.ts`

**Interfaces:**
- Produces: `createObligationTypeSchema` (Zod), `CreateObligationTypeBody` (type),
  `criarObligationType(organizationId: string, actor: { id: string }, data: CreateObligationTypeBody): Promise<ObligationType>`
  — usado pela Task 5 (rota).

- [ ] **Step 1: Escrever o teste**

```typescript
// apps/api/src/modules/document-reader/document-reader-models.service.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { criarObligationType } from './document-reader-models.service'
import { createTestPlan, createTestOrg, createTestUser } from '@/test/helpers'

describe('criarObligationType', () => {
  it('cria uma obrigação privada da org, com code normalizado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })

    const obrigacao = await criarObligationType(org.id, { id: admin.id }, { code: 'recibo rh', name: 'Recibo de Pagamento' })

    expect(obrigacao.code).toBe('RECIBO-RH')
    expect(obrigacao.organizationId).toBe(org.id)
    expect(obrigacao.createdById).toBe(admin.id)
  })

  it('lança 409 se já existe uma obrigação com o mesmo code nesta org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    await prisma.obligationType.create({ data: { code: 'DUPLICADA', name: 'Primeira', organizationId: org.id } })

    await expect(criarObligationType(org.id, { id: admin.id }, { code: 'duplicada', name: 'Segunda' }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('não colide com o code de outra organização (unicidade é por org)', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id, { slug: 'org-b-obligation-type' })
    const adminA = await createTestUser(orgA.id, { role: 'ORG_ADMIN' })
    const adminB = await createTestUser(orgB.id, { role: 'ORG_ADMIN' })
    await criarObligationType(orgA.id, { id: adminA.id }, { code: 'RECIBO', name: 'Recibo A' })

    await expect(criarObligationType(orgB.id, { id: adminB.id }, { code: 'RECIBO', name: 'Recibo B' }))
      .resolves.toBeDefined()
  })
})
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader-models.service.test.ts`
Expected: FAIL — o módulo `document-reader-models.service.ts` não existe.

- [ ] **Step 3: Escrever o schema Zod**

```typescript
// apps/api/src/modules/document-reader/document-reader-models.schema.ts
import { z } from 'zod'

export const createObligationTypeSchema = z.object({
  code: z.string().trim().min(1, 'Código obrigatório'),
  name: z.string().trim().min(1, 'Nome obrigatório'),
})
export type CreateObligationTypeBody = z.infer<typeof createObligationTypeSchema>

const ancoraSchema = z.object({
  texto: z.string().trim().min(1),
  pagina: z.number().int().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})

const zonaSchema = z.object({
  campo: z.string().trim().min(1),
  pagina: z.number().int().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  tipo: z.enum(['cnpj', 'data', 'competencia', 'periodo_apuracao', 'moeda', 'texto']),
  opcional: z.boolean().optional(),
})

export const criarModeloSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório'),
  obligationTypeId: z.string().cuid(),
  ancoras: z.array(ancoraSchema).min(1, 'Marque pelo menos 1 âncora'),
  zonas: z.array(zonaSchema).min(1, 'Marque pelo menos 1 campo'),
})
export type CriarModeloBody = z.infer<typeof criarModeloSchema>

// PATCH usa o mesmo formato do POST — edição é sempre substituição completa da definição.
export const atualizarModeloSchema = criarModeloSchema
export type AtualizarModeloBody = z.infer<typeof atualizarModeloSchema>
```

Nota: `criarModeloSchema`/`atualizarModeloSchema` já ficam prontos aqui pra Task 3/4 não precisar
mexer neste arquivo de novo — só a Task 1 usa `createObligationTypeSchema` por enquanto.

- [ ] **Step 4: Escrever `criarObligationType`**

```typescript
// apps/api/src/modules/document-reader/document-reader-models.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateObligationTypeBody } from './document-reader-models.schema'

// Mesmo princípio dos codes globais existentes (IRPJ, DAS, PGDAS-D): maiúsculas, hífen no lugar
// de espaço, qualquer caractere fora de [A-Z0-9-] removido. "Recibo RH" -> "RECIBO-RH".
function normalizarCodigo(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '')
}

export async function criarObligationType(organizationId: string, actor: { id: string }, data: CreateObligationTypeBody) {
  const code = normalizarCodigo(data.code)
  if (!code) throw new AppError(400, 'Código inválido')

  const existente = await prisma.obligationType.findFirst({ where: { organizationId, code } })
  if (existente) throw new AppError(409, `Já existe uma obrigação com o código "${code}" nesta organização`)

  return prisma.obligationType.create({
    data: { code, name: data.name, organizationId, createdById: actor.id },
  })
}
```

- [ ] **Step 5: Rodar pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader-models.service.test.ts`
Expected: PASS — 3/3.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/document-reader/document-reader-models.schema.ts apps/api/src/modules/document-reader/document-reader-models.service.ts apps/api/src/modules/document-reader/document-reader-models.service.test.ts
git commit -m "feat(document-reader): cria ObligationType privado da org (modelagem, Plano B)"
```

---

### Task 2: Analisar PDF de amostra (sem persistir)

**Files:**
- Modify: `apps/api/src/modules/document-reader/document-reader-models.service.ts`
- Modify: `apps/api/src/modules/document-reader/document-reader-models.service.test.ts`

**Interfaces:**
- Consumes: `extrairDocumento` (`./engine/extrair-texto`, já existe — Plano A).
- Produces: `analisarPdfParaModelagem(buffer: Buffer): Promise<DocumentoExtraido>` — usado pela
  Task 5 (rota).

- [ ] **Step 1: Escrever o teste**

```typescript
// adiciona em document-reader-models.service.test.ts
import { analisarPdfParaModelagem } from './document-reader-models.service'
import { gerarPdfComDocumentoArrecadacao } from '@/test/pdf-helpers'

describe('analisarPdfParaModelagem', () => {
  it('devolve os itens de texto já extraídos, com posição normalizada', async () => {
    const pdf = await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'agosto/2026')

    const resultado = await analisarPdfParaModelagem(Buffer.from(pdf))

    expect(resultado.temTexto).toBe(true)
    expect(resultado.paginas).toHaveLength(1)
    const textos = resultado.paginas[0].itens.map((i) => i.str)
    expect(textos.some((t) => t.includes('11.222.333/0001-81'))).toBe(true)
  })

  it('lança 422 com mensagem clara quando o PDF não tem camada de texto (escaneado)', async () => {
    await expect(analisarPdfParaModelagem(Buffer.from('%PDF-1.4 sem texto algum')))
      .rejects.toMatchObject({ statusCode: 422 })
  })
})
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader-models.service.test.ts -t analisarPdfParaModelagem`
Expected: FAIL — `analisarPdfParaModelagem` não existe.

- [ ] **Step 3: Implementar**

```typescript
// adiciona em document-reader-models.service.ts
import { extrairDocumento } from './engine/extrair-texto'
import type { DocumentoExtraido } from './engine/types'

export async function analisarPdfParaModelagem(buffer: Buffer): Promise<DocumentoExtraido> {
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  let resultado: DocumentoExtraido
  try {
    resultado = await extrairDocumento(bytes)
  } catch (err) {
    throw new AppError(422, `Não foi possível ler o PDF: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!resultado.temTexto) {
    throw new AppError(422, 'PDF sem camada de texto (provavelmente escaneado) — OCR ainda não é suportado')
  }
  return resultado
}
```

Nota: igual ao `downloadFile`/`extrairEInterpretar` do Plano A, o buffer precisa virar um
`Uint8Array` "puro" (não um `Buffer`) antes de chegar no pdf.js — ele rejeita `Buffer` mesmo sendo
subclasse de `Uint8Array` (`Please provide binary data as Uint8Array, rather than Buffer`).

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader-models.service.test.ts`
Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/document-reader/document-reader-models.service.ts apps/api/src/modules/document-reader/document-reader-models.service.test.ts
git commit -m "feat(document-reader): analisa PDF de amostra pra modelagem (sem persistir)"
```

---

### Task 3: Listar e criar `DocumentModel`

**Files:**
- Modify: `apps/api/src/modules/document-reader/document-reader-models.service.ts`
- Modify: `apps/api/src/modules/document-reader/document-reader-models.service.test.ts`

**Interfaces:**
- Consumes: `criarModeloSchema`/`CriarModeloBody` (Task 1, já escrito).
- Produces: `listarModelos(organizationId: string)`,
  `criarModelo(organizationId: string, actor: { id: string }, data: CriarModeloBody): Promise<DocumentModel>`
  — usados pela Task 5 (rotas) e pela Task 4 (`atualizarModelo` reusa a validação).

- [ ] **Step 1: Escrever o teste**

```typescript
// adiciona em document-reader-models.service.test.ts
import { listarModelos, criarModelo } from './document-reader-models.service'

describe('criarModelo', () => {
  async function setupObrigacao(orgId: string | null) {
    return prisma.obligationType.create({ data: { code: 'TESTE-MODELO', name: 'Teste', organizationId: orgId } })
  }

  it('cria um modelo privado da org, com tipoImposto derivado do code da obrigação', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await setupObrigacao(org.id)

    const modelo = await criarModelo(org.id, { id: admin.id }, {
      nome: 'Recibo RH modelo', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Recibo de Pagamento', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })

    expect(modelo.organizationId).toBe(org.id)
    expect((modelo.definicao as any).tipoImposto).toBe('TESTE-MODELO')
    expect((modelo.definicao as any).id).toBeUndefined() // nunca grava id próprio (commit e31b5b2)
  })

  it('lança 400 quando falta o campo cnpj', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await setupObrigacao(org.id)

    await expect(criarModelo(org.id, { id: admin.id }, {
      nome: 'Sem CNPJ', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [{ campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' }],
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lança 400 quando falta competencia/periodo_apuracao', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await setupObrigacao(org.id)

    await expect(criarModelo(org.id, { id: admin.id }, {
      nome: 'Sem competência', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [{ campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' }],
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lança 400 quando há dois campos com o mesmo nome', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await setupObrigacao(org.id)

    await expect(criarModelo(org.id, { id: admin.id }, {
      nome: 'Campo repetido', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'cnpj', pagina: 1, x: 0.5, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lança 404 quando obligationTypeId pertence a outra organização', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const outraOrg = await createTestOrg(plan.id, { slug: 'outra-org-criar-modelo' })
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacaoDeOutraOrg = await setupObrigacao(outraOrg.id)

    await expect(criarModelo(org.id, { id: admin.id }, {
      nome: 'Modelo', obligationTypeId: obrigacaoDeOutraOrg.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('aceita obligationTypeId global (organizationId null)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacaoGlobal = await setupObrigacao(null)

    await expect(criarModelo(org.id, { id: admin.id }, {
      nome: 'Modelo com obrigação global', obligationTypeId: obrigacaoGlobal.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })).resolves.toBeDefined()
  })
})

describe('listarModelos', () => {
  it('lista modelos globais e privados da org, marcando isGlobal, não lista os de outra org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const outraOrg = await createTestOrg(plan.id, { slug: 'outra-org-listar-modelo' })
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await setupObrigacao(org.id)
    const outraObrigacao = await setupObrigacao(outraOrg.id)

    const meu = await criarModelo(org.id, { id: admin.id }, {
      nome: 'Meu modelo', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })
    const outroAdmin = await createTestUser(outraOrg.id, { role: 'ORG_ADMIN' })
    const deOutraOrg = await criarModelo(outraOrg.id, { id: outroAdmin.id }, {
      nome: 'Modelo de outra org', obligationTypeId: outraObrigacao.id,
      ancoras: [{ texto: 'Fixo2', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })

    const modelos = await listarModelos(org.id)
    const idsListados = modelos.map((m) => m.id)

    expect(idsListados).toContain(meu.id)
    expect(idsListados).not.toContain(deOutraOrg.id)
    const meuNaLista = modelos.find((m) => m.id === meu.id)!
    expect(meuNaLista.isGlobal).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader-models.service.test.ts -t "criarModelo|listarModelos"`
Expected: FAIL — `criarModelo`/`listarModelos` não existem.

- [ ] **Step 3: Implementar**

```typescript
// adiciona em document-reader-models.service.ts
import type { CriarModeloBody } from './document-reader-models.schema'

function validarCamposObrigatorios(zonas: CriarModeloBody['zonas']) {
  const nomes = new Set<string>()
  for (const z of zonas) {
    if (nomes.has(z.campo)) throw new AppError(400, `Campo "${z.campo}" repetido`)
    nomes.add(z.campo)
  }
  if (!nomes.has('cnpj')) {
    throw new AppError(400, 'Marque o campo "cnpj" — sem ele não há como achar o cliente')
  }
  if (!nomes.has('competencia') && !zonas.some((z) => z.tipo === 'periodo_apuracao')) {
    throw new AppError(400, 'Marque o campo "competencia" ou um campo do tipo período de apuração')
  }
}

async function obterObligationTypeOuFalhar(organizationId: string, obligationTypeId: string) {
  const obrigacao = await prisma.obligationType.findFirst({
    where: { id: obligationTypeId, OR: [{ organizationId: null }, { organizationId }] },
  })
  if (!obrigacao) throw new AppError(404, 'Obrigação não encontrada')
  return obrigacao
}

export async function listarModelos(organizationId: string) {
  const modelos = await prisma.documentModel.findMany({
    where: { isActive: true, OR: [{ organizationId: null }, { organizationId }] },
    include: { obligationType: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
  })
  return modelos.map((m) => ({
    id: m.id,
    nome: m.name,
    version: m.version,
    createdAt: m.createdAt,
    isGlobal: m.organizationId === null,
    obligationType: m.obligationType,
  }))
}

export async function criarModelo(organizationId: string, actor: { id: string }, data: CriarModeloBody) {
  validarCamposObrigatorios(data.zonas)
  const obrigacao = await obterObligationTypeOuFalhar(organizationId, data.obligationTypeId)

  return prisma.documentModel.create({
    data: {
      organizationId,
      obligationTypeId: obrigacao.id,
      name: data.nome,
      createdById: actor.id,
      definicao: { nome: data.nome, tipoImposto: obrigacao.code, ancoras: data.ancoras, zonas: data.zonas },
    },
  })
}
```

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader-models.service.test.ts`
Expected: PASS — 12/12.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/document-reader/document-reader-models.service.ts apps/api/src/modules/document-reader/document-reader-models.service.test.ts
git commit -m "feat(document-reader): lista e cria DocumentModel privado da org (modelagem)"
```

---

### Task 4: Editar e arquivar `DocumentModel`

**Files:**
- Modify: `apps/api/src/modules/document-reader/document-reader-models.service.ts`
- Modify: `apps/api/src/modules/document-reader/document-reader-models.service.test.ts`

**Interfaces:**
- Consumes: `validarCamposObrigatorios`, `obterObligationTypeOuFalhar` (Task 3, funções internas
  do mesmo arquivo).
- Produces: `atualizarModelo(id: string, organizationId: string, data: AtualizarModeloBody): Promise<DocumentModel>`,
  `arquivarModelo(id: string, organizationId: string): Promise<DocumentModel>` — usados pela
  Task 5 (rotas).

- [ ] **Step 1: Escrever o teste**

```typescript
// adiciona em document-reader-models.service.test.ts
import { atualizarModelo, arquivarModelo } from './document-reader-models.service'

describe('atualizarModelo', () => {
  async function setupModeloPrivado(orgId: string, adminId: string) {
    const obrigacao = await prisma.obligationType.create({ data: { code: 'TESTE-EDIT', name: 'Teste', organizationId: orgId } })
    return criarModelo(orgId, { id: adminId }, {
      nome: 'Original', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })
  }

  it('edita um modelo privado da org e incrementa version', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const modelo = await setupModeloPrivado(org.id, admin.id)

    const editado = await atualizarModelo(modelo.id, org.id, {
      nome: 'Editado', obligationTypeId: modelo.obligationTypeId,
      ancoras: [{ texto: 'Fixo novo', pagina: 1, x: 0.2, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })

    expect(editado.name).toBe('Editado')
    expect(editado.version).toBe(2)
  })

  it('lança 404 ao tentar editar um modelo global', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const obrigacaoGlobal = await prisma.obligationType.create({ data: { code: 'GLOBAL-EDIT-TESTE', name: 'Global', organizationId: null } })
    const modeloGlobal = await prisma.documentModel.create({
      data: {
        organizationId: null, obligationTypeId: obrigacaoGlobal.id, name: 'Global',
        definicao: { nome: 'Global', tipoImposto: 'GLOBAL-EDIT-TESTE', ancoras: [], zonas: [] },
      },
    })

    await expect(atualizarModelo(modeloGlobal.id, org.id, {
      nome: 'Tentativa', obligationTypeId: obrigacaoGlobal.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('lança 404 ao tentar editar um modelo de outra organização', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const outraOrg = await createTestOrg(plan.id, { slug: 'outra-org-editar-modelo' })
    const outroAdmin = await createTestUser(outraOrg.id, { role: 'ORG_ADMIN' })
    const modeloDeOutraOrg = await setupModeloPrivado(outraOrg.id, outroAdmin.id)

    await expect(atualizarModelo(modeloDeOutraOrg.id, org.id, {
      nome: 'Tentativa', obligationTypeId: modeloDeOutraOrg.obligationTypeId,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('arquivarModelo', () => {
  it('marca isActive false e some de listarModelos', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await prisma.obligationType.create({ data: { code: 'TESTE-ARQUIVAR', name: 'Teste', organizationId: org.id } })
    const modelo = await criarModelo(org.id, { id: admin.id }, {
      nome: 'Pra arquivar', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })

    await arquivarModelo(modelo.id, org.id)

    const lista = await listarModelos(org.id)
    expect(lista.map((m) => m.id)).not.toContain(modelo.id)
  })

  it('lança 404 ao tentar arquivar um modelo global', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const obrigacaoGlobal = await prisma.obligationType.create({ data: { code: 'GLOBAL-ARQUIVAR-TESTE', name: 'Global', organizationId: null } })
    const modeloGlobal = await prisma.documentModel.create({
      data: {
        organizationId: null, obligationTypeId: obrigacaoGlobal.id, name: 'Global',
        definicao: { nome: 'Global', tipoImposto: 'GLOBAL-ARQUIVAR-TESTE', ancoras: [], zonas: [] },
      },
    })

    await expect(arquivarModelo(modeloGlobal.id, org.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader-models.service.test.ts -t "atualizarModelo|arquivarModelo"`
Expected: FAIL — `atualizarModelo`/`arquivarModelo` não existem.

- [ ] **Step 3: Implementar**

```typescript
// adiciona em document-reader-models.service.ts
import type { AtualizarModeloBody } from './document-reader-models.schema'

export async function atualizarModelo(id: string, organizationId: string, data: AtualizarModeloBody) {
  const modelo = await prisma.documentModel.findFirst({ where: { id, organizationId } })
  if (!modelo) throw new AppError(404, 'Modelo não encontrado')

  validarCamposObrigatorios(data.zonas)
  const obrigacao = await obterObligationTypeOuFalhar(organizationId, data.obligationTypeId)

  return prisma.documentModel.update({
    where: { id },
    data: {
      obligationTypeId: obrigacao.id,
      name: data.nome,
      version: { increment: 1 },
      definicao: { nome: data.nome, tipoImposto: obrigacao.code, ancoras: data.ancoras, zonas: data.zonas },
    },
  })
}

export async function arquivarModelo(id: string, organizationId: string) {
  const modelo = await prisma.documentModel.findFirst({ where: { id, organizationId } })
  if (!modelo) throw new AppError(404, 'Modelo não encontrado')
  return prisma.documentModel.update({ where: { id }, data: { isActive: false } })
}
```

Nota: `findFirst({ where: { id, organizationId } })` com `organizationId` sendo sempre a string da
própria org (nunca `null`) já garante sozinho que um modelo global (`organizationId: null` no
banco) nunca bate nessa busca — é o mesmo padrão de `os-templates.service.ts::deleteOSTemplate`.
Não precisa de um `if (modelo.organizationId === null)` redundante depois.

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader-models.service.test.ts`
Expected: PASS — 17/17.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/document-reader/document-reader-models.service.ts apps/api/src/modules/document-reader/document-reader-models.service.test.ts
git commit -m "feat(document-reader): edita e arquiva DocumentModel privado da org (modelagem)"
```

---

### Task 5: Rotas Fastify

**Files:**
- Create: `apps/api/src/modules/document-reader/document-reader-models.routes.ts`
- Test: `apps/api/src/modules/document-reader/document-reader-models.routes.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: todas as funções das Tasks 1-4 (`criarObligationType`, `analisarPdfParaModelagem`,
  `listarModelos`, `criarModelo`, `atualizarModelo`, `arquivarModelo`) e os schemas Zod da Task 1.
- Produces: `documentReaderModelsRoutes` (plugin Fastify) — registrado em `server.ts`.

- [ ] **Step 1: Escrever o teste**

```typescript
// apps/api/src/modules/document-reader/document-reader-models.routes.test.ts
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'
import { gerarPdfComDocumentoArrecadacao } from '@/test/pdf-helpers'

describe('POST /document-reader/obrigacoes', () => {
  it('ORG_ADMIN cria uma obrigação privada', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST', url: '/document-reader/obrigacoes',
      headers: { authorization: auth }, payload: { code: 'recibo rh', name: 'Recibo de Pagamento' },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).code).toBe('RECIBO-RH')
  })

  it('ORG_MEMBER não pode criar obrigação (403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const auth = await getAuthHeader(member.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST', url: '/document-reader/obrigacoes',
      headers: { authorization: auth }, payload: { code: 'X', name: 'X' },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('POST /document-reader/modelos/analisar', () => {
  it('devolve os itens de texto extraídos do PDF enviado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    const pdf = await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'agosto/2026')
    const boundary = 'boundary-modelagem-1'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="amostra.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      Buffer.from(pdf),
      Buffer.from(`\r\n--${boundary}--`),
    ])

    const res = await app.inject({
      method: 'POST', url: '/document-reader/modelos/analisar',
      headers: { authorization: auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).temTexto).toBe(true)
  })
})

describe('GET/POST/PATCH/DELETE /document-reader/modelos', () => {
  it('ciclo completo: cria, lista, edita e arquiva um modelo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    const obrigacao = await prisma.obligationType.create({ data: { code: 'TESTE-ROTA', name: 'Teste', organizationId: org.id } })

    const payload = {
      nome: 'Modelo via rota', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    }

    const criado = await app.inject({ method: 'POST', url: '/document-reader/modelos', headers: { authorization: auth }, payload })
    expect(criado.statusCode).toBe(201)
    const modeloId = JSON.parse(criado.body).id

    const lista = await app.inject({ method: 'GET', url: '/document-reader/modelos', headers: { authorization: auth } })
    expect(lista.statusCode).toBe(200)
    expect(JSON.parse(lista.body).map((m: { id: string }) => m.id)).toContain(modeloId)

    const editado = await app.inject({
      method: 'PATCH', url: `/document-reader/modelos/${modeloId}`,
      headers: { authorization: auth }, payload: { ...payload, nome: 'Modelo editado' },
    })
    expect(editado.statusCode).toBe(200)
    expect(JSON.parse(editado.body).version).toBe(2)

    const arquivado = await app.inject({ method: 'DELETE', url: `/document-reader/modelos/${modeloId}`, headers: { authorization: auth } })
    expect(arquivado.statusCode).toBe(204)

    const listaDepois = await app.inject({ method: 'GET', url: '/document-reader/modelos', headers: { authorization: auth } })
    expect(JSON.parse(listaDepois.body).map((m: { id: string }) => m.id)).not.toContain(modeloId)
  })
})
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader-models.routes.test.ts`
Expected: FAIL — as rotas não existem (404 em todas as chamadas).

- [ ] **Step 3: Escrever as rotas**

```typescript
// apps/api/src/modules/document-reader/document-reader-models.routes.ts
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import {
  criarObligationType, analisarPdfParaModelagem, listarModelos, criarModelo, atualizarModelo, arquivarModelo,
} from './document-reader-models.service'
import { createObligationTypeSchema, criarModeloSchema, atualizarModeloSchema } from './document-reader-models.schema'

const MAX_FILE_SIZE = 20 * 1024 * 1024

export async function documentReaderModelsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })
  app.addHook('preHandler', verifyJWT)
  // Toda rota deste arquivo é ORG_ADMIN-only (inclusive leitura) — só quem administra o
  // escritório mexe em modelo. Ao contrário de os-templates.routes.ts (que mistura leitura
  // ampla com escrita restrita), aqui TODAS as rotas têm a mesma exigência de role, então um
  // addHook global é seguro e mais simples que repetir requireRole('ORG_ADMIN') em cada rota.
  app.addHook('preHandler', requireRole('ORG_ADMIN'))

  app.post('/document-reader/obrigacoes', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = createObligationTypeSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await criarObligationType(request.user.organizationId!, { id: request.user.sub }, result.data))
  })

  app.post('/document-reader/modelos/analisar', async (request, reply) => {
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

    return reply.send(await analisarPdfParaModelagem(buffer))
  })

  app.get('/document-reader/modelos', async (request, reply) => {
    return reply.send(await listarModelos(request.user.organizationId!))
  })

  app.post('/document-reader/modelos', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = criarModeloSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await criarModelo(request.user.organizationId!, { id: request.user.sub }, result.data))
  })

  app.patch('/document-reader/modelos/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = atualizarModeloSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await atualizarModelo(id, request.user.organizationId!, result.data))
  })

  app.delete('/document-reader/modelos/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await arquivarModelo(id, request.user.organizationId!)
    return reply.status(204).send()
  })
}
```

- [ ] **Step 4: Registrar em `server.ts`**

```typescript
// apps/api/src/server.ts — adicione o import junto dos outros e o register junto de documentReaderRoutes
import { documentReaderModelsRoutes } from '@/modules/document-reader/document-reader-models.routes'
// ...
app.register(documentReaderModelsRoutes)
```

- [ ] **Step 5: Rodar pra confirmar que passa**

Run: `pnpm --filter api exec vitest run src/modules/document-reader/document-reader-models.routes.test.ts`
Expected: PASS — 4/4.

- [ ] **Step 6: Rodar a suíte completa da API**

Run: `pnpm --filter api test`
Expected: tudo passando, sem regressão.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/document-reader/document-reader-models.routes.ts apps/api/src/modules/document-reader/document-reader-models.routes.test.ts apps/api/src/server.ts
git commit -m "feat(document-reader): rotas de modelagem (obrigação, analisar, CRUD de modelo)"
```

---

### Task 6: Frontend — tipos, rota e tela de lista

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/pages/app/settings/SettingsHub.tsx`
- Create: `apps/web/src/pages/app/settings/DocumentModels.tsx`

**Interfaces:**
- Consumes: `GET /document-reader/modelos`, `DELETE /document-reader/modelos/:id` (Task 5).
- Produces: tipos `DocumentModelListItem`, `DocumentoExtraidoItem`, `DocumentoExtraidoPagina`,
  `DocumentoExtraido` (usados pela Task 7); rota `/app/settings/document-models` (lista),
  `/app/settings/document-models/new` e `/app/settings/document-models/:id/edit` registradas
  (ainda sem componente real nas duas últimas — Task 7 cria `DocumentModelForm.tsx`).

- [ ] **Step 1: Adicionar os tipos**

```typescript
// adiciona em apps/web/src/types/index.ts
export interface DocumentModelListItem {
  id: string
  nome: string
  version: number
  createdAt: string
  isGlobal: boolean
  obligationType: { id: string; name: string }
}

export interface DocumentoExtraidoItem {
  str: string
  x: number
  y: number
  w: number
  h: number
}

export interface DocumentoExtraidoPagina {
  numero: number
  largura?: number
  altura?: number
  itens: DocumentoExtraidoItem[]
}

export interface DocumentoExtraido {
  paginas: DocumentoExtraidoPagina[]
  temTexto: boolean
}
```

- [ ] **Step 2: Escrever a tela de lista**

```tsx
// apps/web/src/pages/app/settings/DocumentModels.tsx
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Plus, Pencil, Trash2, FileText, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import type { DocumentModelListItem } from '@/types'

function mensagemDeErro(err: unknown, padrao: string): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? padrao
}

export default function DocumentModels() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: modelos = [], isLoading } = useQuery<DocumentModelListItem[]>({
    queryKey: ['document-models'],
    queryFn: () => api.get('/document-reader/modelos').then((r) => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/document-reader/modelos/${id}`),
    onSuccess: () => { toast.success('Modelo arquivado'); qc.invalidateQueries({ queryKey: ['document-models'] }) },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao arquivar modelo')),
  })

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <Link to="/app/settings" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={12} /> Configurações
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-lg md:text-xl font-bold text-foreground">Modelos de Documento</h1>
          <Button onClick={() => navigate('/app/settings/document-models/new')} className="gap-2">
            <Plus size={16} />
            Novo modelo
          </Button>
        </div>
      </div>

      {modelos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <FileText size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhum modelo cadastrado</p>
          <p className="text-xs mt-1">Crie um modelo marcando um PDF de amostra pra o robô reconhecer esse layout.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {modelos.map((m) => (
            <Card key={m.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{m.nome}</span>
                  {m.isGlobal && <span className="text-xs px-1.5 py-0.5 rounded-full bg-neutral-bg text-muted-foreground">AutoHubs</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{m.obligationType.name} · versão {m.version}</p>
              </div>
              {!m.isGlobal && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Link to={`/app/settings/document-models/${m.id}/edit`} className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-bg hover:text-foreground" aria-label="Editar">
                    <Pencil size={14} />
                  </Link>
                  <button
                    onClick={() => { if (window.confirm(`Arquivar o modelo "${m.nome}"?`)) deleteMutation.mutate(m.id) }}
                    className="p-1.5 rounded-md text-muted-foreground hover:bg-danger-bg hover:text-danger-text"
                    aria-label="Arquivar"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Registrar a rota**

Em `apps/web/src/router.tsx`, siga o mesmo padrão de `settings/os-templates` (import no topo,
rotas filhas de `/app` protegidas por `ADMIN_ROLES`):

```typescript
import DocumentModels from '@/pages/app/settings/DocumentModels'
// ...
{
  path: 'settings/document-models',
  element: (
    <ProtectedRoute allowedRoles={ADMIN_ROLES}>
      <DocumentModels />
    </ProtectedRoute>
  ),
},
```

As rotas `settings/document-models/new` e `settings/document-models/:id/edit` entram na Task 7
(precisam de `DocumentModelForm`, que ainda não existe).

- [ ] **Step 4: Link no Settings Hub**

```typescript
// adiciona no array `cards` de apps/web/src/pages/app/settings/SettingsHub.tsx
{ to: '/app/settings/document-models', icon: <FileText size={20} />, title: 'Modelos de Documento', description: 'Ensina o robô a reconhecer o layout dos seus documentos', roles: ADMIN_ROLES },
```

Lembre de importar `FileText` de `lucide-react` no topo do arquivo (junto dos outros ícones já
importados).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/router.tsx apps/web/src/pages/app/settings/SettingsHub.tsx apps/web/src/pages/app/settings/DocumentModels.tsx
git commit -m "feat(document-reader): tela de lista de modelos de documento"
```

---

### Task 7: Frontend — reconstrução da página (upload + itens clicáveis)

**Files:**
- Create: `apps/web/src/pages/app/settings/DocumentModelForm.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Consumes: `POST /document-reader/modelos/analisar` (Task 5), tipos `DocumentoExtraido`/
  `DocumentoExtraidoItem` (Task 6).
- Produces: componente `DocumentModelForm` renderizado nas rotas `new`/`:id/edit` — Task 8
  completa a lógica de marcação por cima deste esqueleto visual.

- [ ] **Step 1: Escrever o esqueleto com upload + reconstrução pura**

```tsx
// apps/web/src/pages/app/settings/DocumentModelForm.tsx
import { useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import type { DocumentoExtraido, DocumentoExtraidoItem } from '@/types'

function mensagemDeErro(err: unknown, padrao: string): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? padrao
}

export default function DocumentModelForm() {
  const { id } = useParams<{ id: string }>()
  const isEditing = !!id
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [extraido, setExtraido] = useState<DocumentoExtraido | null>(null)
  const [pagina, setPagina] = useState(0)

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

  const paginaAtual = extraido?.paginas[pagina]

  return (
    <div className="p-4 md:p-6 max-w-5xl">
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

          <div
            className="relative w-full bg-surface border border-border rounded-md overflow-hidden"
            style={{ aspectRatio: paginaAtual?.largura && paginaAtual?.altura ? `${paginaAtual.largura} / ${paginaAtual.altura}` : '210 / 297' }}
          >
            {paginaAtual?.itens.map((item: DocumentoExtraidoItem, i: number) => (
              <div
                key={i}
                className="absolute text-[8px] leading-none text-foreground whitespace-nowrap overflow-hidden cursor-pointer hover:bg-accent/20 rounded-sm"
                style={{
                  left: `${item.x * 100}%`,
                  top: `${item.y * 100}%`,
                  width: `${item.w * 100}%`,
                  height: `${item.h * 100}%`,
                }}
                title={item.str}
              >
                {item.str}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

Reusa o mesmo padrão de upload (`useRef<HTMLInputElement>` + `Button onClick` + `input` escondido)
já usado em `ReviewQueue.tsx` (`apps/web/src/pages/app/document-reader/ReviewQueue.tsx`, Plano A)
— comprovado funcionando, sem reinventar. A Task 8 reescreve este arquivo por completo,
adicionando o clique nos itens (hoje só exibidos, nada acontece ao clicar) e o painel lateral.

- [ ] **Step 2: Registrar as rotas**

```typescript
// apps/web/src/router.tsx — adicione junto da rota de settings/document-models da Task 6
import DocumentModelForm from '@/pages/app/settings/DocumentModelForm'
// ...
{
  path: 'settings/document-models/new',
  element: (
    <ProtectedRoute allowedRoles={ADMIN_ROLES}>
      <DocumentModelForm />
    </ProtectedRoute>
  ),
},
{
  path: 'settings/document-models/:id/edit',
  element: (
    <ProtectedRoute allowedRoles={ADMIN_ROLES}>
      <DocumentModelForm />
    </ProtectedRoute>
  ),
},
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: QA manual — confirmar a reconstrução visual**

Suba os serviços locais (`docker compose up -d postgres postgres_test redis`, depois
`pnpm --filter api dev`, `RESEND_API_KEY=re_dummy_qa_key pnpm --filter api worker`,
`pnpm --filter web dev`) e, num navegador, logado como `ORG_ADMIN`:
1. Acesse `/app/settings/document-models/new`.
2. Suba qualquer PDF com texto (ex.: um dos arquivos em `tmp/pdfs-validacao/`, se existir, ou
   qualquer PDF com texto selecionável).
3. Confirme que o texto do PDF aparece reconstruído na tela, nas posições certas (comparando
   visualmente com o PDF original aberto em outra aba).

Isso é verificação manual, não há teste automatizado de UI (convenção do projeto).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/app/settings/DocumentModelForm.tsx apps/web/src/router.tsx
git commit -m "feat(document-reader): reconstrução visual do PDF de amostra (upload + itens clicáveis)"
```

---

### Task 8: Frontend — marcação de âncoras/campos e salvar

**Files:**
- Modify: `apps/web/src/pages/app/settings/DocumentModelForm.tsx`

**Interfaces:**
- Consumes: `GET /document-reader/obrigacoes`, `POST /document-reader/obrigacoes`,
  `POST /document-reader/modelos`, `PATCH /document-reader/modelos/:id`,
  `GET /document-reader/modelos` (pra carregar o modelo ao editar) — todos da Task 5.
- Produces: tela de modelagem completa e funcional.

- [ ] **Step 1: Adicionar estado de marcação e painel lateral**

```tsx
// reescreve apps/web/src/pages/app/settings/DocumentModelForm.tsx inteiro
import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import type { DocumentoExtraido, DocumentoExtraidoItem, ObligationType } from '@/types'

function mensagemDeErro(err: unknown, padrao: string): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? padrao
}

interface Ancora { texto: string; pagina: number; x: number; y: number }
interface Zona { campo: string; pagina: number; x: number; y: number; w: number; h: number; tipo: string; opcional?: boolean }

const CAMPOS_PADRAO: { campo: string; label: string; tipo: string }[] = [
  { campo: 'cnpj', label: 'CNPJ', tipo: 'cnpj' },
  { campo: 'competencia', label: 'Competência', tipo: 'competencia' },
  { campo: 'vencimento', label: 'Vencimento', tipo: 'data' },
  { campo: 'valor', label: 'Valor', tipo: 'moeda' },
]

// Mesmos 6 tipos que o motor aceita (apps/api/.../engine/types.ts::TipoCampo). "periodo_apuracao"
// não está nos 4 campos padrão de propósito: é só necessário pra documentos trimestrais (ex.: a
// linha "PA:2º Trimestre/2026" do DARF) — quem precisar marca como campo customizado.
const TIPOS_CAMPO = [
  { tipo: 'cnpj', label: 'CNPJ' },
  { tipo: 'competencia', label: 'Competência' },
  { tipo: 'periodo_apuracao', label: 'Período de apuração (trimestral)' },
  { tipo: 'data', label: 'Data' },
  { tipo: 'moeda', label: 'Valor em dinheiro' },
  { tipo: 'texto', label: 'Texto livre' },
] as const

type Alvo = { modo: 'ancora' } | { modo: 'campo'; campo: string; tipo: string } | null

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
  const [novoCampoTipo, setNovoCampoTipo] = useState<string>('texto')
  const [mostrarNovoCampo, setMostrarNovoCampo] = useState(false)

  const { data: obrigacoes = [], refetch: refetchObrigacoes } = useQuery<ObligationType[]>({
    queryKey: ['document-reader-obrigacoes'],
    queryFn: () => api.get('/document-reader/obrigacoes').then((r) => r.data),
  })

  useEffect(() => {
    if (!isEditing || !id) return
    api.get(`/document-reader/modelos`).then((r) => {
      const modelo = (r.data as { id: string; nome: string; obligationType: { id: string } }[]).find((m) => m.id === id)
      if (modelo) { setNome(modelo.nome); setObligationTypeId(modelo.obligationType.id) }
    })
  }, [isEditing, id])

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
    mutationFn: () => {
      const payload = { nome, obligationTypeId, ancoras, zonas }
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

  function aoClicarItem(item: DocumentoExtraidoItem) {
    if (!alvo) return
    if (alvo.modo === 'ancora') {
      const existe = ancoras.some((a) => a.texto === item.str && a.pagina === (paginaAtual?.numero ?? 1))
      if (existe) {
        setAncoras(ancoras.filter((a) => !(a.texto === item.str && a.pagina === (paginaAtual?.numero ?? 1))))
      } else {
        setAncoras([...ancoras, { texto: item.str, pagina: paginaAtual?.numero ?? 1, x: item.x, y: item.y }])
      }
      return
    }
    setZonas([
      ...zonas.filter((z) => z.campo !== alvo.campo),
      { campo: alvo.campo, pagina: paginaAtual?.numero ?? 1, x: item.x, y: item.y, w: item.w, h: item.h, tipo: alvo.tipo },
    ])
    setAlvo(null)
  }

  const campoJaMarcado = (campo: string) => zonas.some((z) => z.campo === campo)
  // Mesma regra de validarCamposObrigatorios() no backend (document-reader-models.service.ts,
  // Task 3): competencia OU qualquer campo do tipo periodo_apuracao serve — nunca exigir só
  // "competencia" literal, senão um modelo trimestral (campo customizado tipo periodo_apuracao)
  // nunca habilitaria o botão Salvar apesar de o backend aceitar.
  const temPeriodo = campoJaMarcado('competencia') || zonas.some((z) => z.tipo === 'periodo_apuracao')
  const podeSalvar = nome.trim() && obligationTypeId && ancoras.length > 0 && campoJaMarcado('cnpj') && temPeriodo

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
                const ehAncora = ancoras.some((a) => a.texto === item.str && a.pagina === (paginaAtual?.numero ?? 1))
                const zonaDoItem = zonas.find((z) => z.pagina === (paginaAtual?.numero ?? 1) && Math.abs(z.x - item.x) < 0.005 && Math.abs(z.y - item.y) < 0.005)
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
                  <select
                    value={novoCampoTipo}
                    onChange={(e) => setNovoCampoTipo(e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
                  >
                    {TIPOS_CAMPO.map((t) => <option key={t.tipo} value={t.tipo}>{t.label}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!novoCampoNome.trim()}
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
```

Nota: `ObligationType` (tipo usado acima pra `obrigacoes`) já existe em `@/types` desde o Plano A
(usado em `RecurringTemplateForm.tsx`) — não precisa ser criado de novo.

Nota 2: o `useEffect` que carrega o modelo em edição busca a lista inteira (`GET
/document-reader/modelos`) e filtra pelo `id` no cliente, em vez de ter uma rota `GET
/document-reader/modelos/:id` dedicada — list já é pequena (modelos de uma org), e evita criar
mais um endpoint só pra isso. Aceitável pro v1; se a lista crescer muito, vale um `GET :id`
dedicado depois. Edição também não recarrega `ancoras`/`zonas` do modelo existente (campo
`definicao` não é exposto por `listarModelos`) — então editar hoje sempre começa com um upload
novo de PDF e remarcação do zero, mesmo mantendo nome/obrigação. Isso é consistente com o que a
spec já previa ("v1 não guarda o PDF original usado da primeira vez, então editar sempre pede um
PDF de amostra de novo").

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: QA manual — ciclo completo de criação**

Com os serviços locais já de pé (Task 7, Step 4):
1. Acesse `/app/settings/document-models/new`.
2. Suba um PDF de amostra real (ex.: `tmp/pdfs-validacao/R 51.91459 - PGDASD-DAS-...pdf`, se ainda
   existir localmente, ou qualquer PDF com CNPJ e competência visíveis).
3. Preencha o nome, crie uma obrigação nova pelo botão "+ Nova".
4. Marque 1 âncora (um texto do cabeçalho) e os campos CNPJ e Competência.
5. Teste também "+ Campo customizado" com tipo "Período de apuração (trimestral)" — confirme que
   aparece na lista de campos marcados e que o botão Salvar não exige mais "Competência" quando
   esse campo substitui ela (ambos nunca precisam coexistir).
6. Clique "Salvar modelo" — confirme o toast de sucesso e que o modelo aparece na lista.
7. Edite o modelo recém-criado — confirme que o form abre com nome/obrigação preenchidos.
8. Arquive o modelo pela lista — confirme que ele some.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/app/settings/DocumentModelForm.tsx
git commit -m "feat(document-reader): marcação de âncoras/campos e salvar modelo (modelagem completa)"
```

---

### Task 9: Documentação e verificação final

**Files:**
- Modify: `docs/TASKS.md`

- [ ] **Step 1: Marcar o item 6 do roadmap como concluído (Planos A + B)**

Em `docs/TASKS.md`, localize a entrada do item 6 (já marcada `[~]` desde o Plano A) e:
- Troque `[~]` por `[x]`.
- Adicione um parágrafo descrevendo o Plano B: tela de modelagem em `/app/settings/document-models`
  (`ORG_ADMIN`), reconstrução do PDF de amostra sem renderizar como imagem (reusa `extrairDocumento`
  do Plano A), âncoras/campos marcados por clique, `ObligationType` criável inline, modelo salvo
  como `DocumentModel` privado da org (nunca global). Cite o fix do bug de `documentModelId`
  (commit `e31b5b2`) encontrado durante a preparação deste plano. Referencie
  `docs/superpowers/specs/2026-10-16-modelagem-documentos-design.md` e este plano.
- Atualize a linha "Próximo passo" no fim do arquivo — o Plano B deixa de estar pendente.

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
git commit -m "docs: marca modelagem de documentos (Plano B) como concluída"
```
