# Vencimento por localidade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma recorrência por imposto com vencimento por estado ou município do cliente, sobre cadastro de cliente com UF + cidade IBGE obrigatórios e buscador de CNPJ confiável.

**Architecture:** Tabela global `Municipality` (IBGE, carregada por migration a partir de JSON versionado). `Client` ganha `ibgeCityCode` e UF validada. `RecurringTaskTemplate` ganha `dueScope` + `onlyListedLocations` + filhos `RecurringDueRule`; a geração escolhe a regra por uma função pura `resolveDueRule`. Buscador: BrasilAPI com CNPJ.ws de reserva. Feriados sem mudança.

**Tech Stack:** Fastify 5 + Prisma 6 + Zod 3 + Vitest (API); React 19 + TanStack Query + msw + Vitest (web).

**Spec:** `docs/superpowers/specs/2026-11-17-vencimento-por-localidade-design.md`

## Global Constraints

- Branch `feat/vencimento-localidade` a partir da `main`. Nunca push (Max faz).
- TDD: teste falhando antes do código. Suítes da API uma de cada vez (banco de teste compartilhado).
- TypeScript strict, sem `any`, sem `as unknown`; Zod em toda entrada; erros `AppError(status, 'mensagem pt-BR')`; Prisma só em services; tudo filtrado por `organizationId` (Municipality é a única tabela global).
- Comentários/código em inglês; mensagens ao usuário em pt-BR.
- Toda rota nova/alterada: catálogo `apps/api/src/api-docs/` + `pnpm --filter api audit:routes && pnpm --filter api docs:api` no mesmo commit (CLAUDE.md).
- Migrations via `pnpm --filter api migrate:dev -- --name <nome>`; revisar cada uma com o agent `db-migration-checker`. Banco local pode ser resetado (pré-produção).
- Nenhuma chamada externa (IBGE/BrasilAPI) na geração de tarefas nem nos testes (mock de axios).
- UFs válidas (27): `AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO`.
- Commits Conventional Commits terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Telas: QA visual com screenshot real (Playwright) claro e escuro antes de dar como pronto.

## Review Focus

1. Cliente antigo com `estado` em texto não-UF (ex.: "Sergipe") ou sem `ibgeCityCode` aberto para edição: o formulário abre sem quebrar, UF/cidade vazios, e salvar exige escolher → teste em Task 6.
2. BrasilAPI devolve código IBGE que não está na tabela (município novo): `ibgeCityCode: null`, sem 500 → teste em Task 2.
3. Recorrência muda de MONTHLY para WEEKLY mantendo exceção com dia 15: tem que dar 400 (dia inválido para semanal), não gerar data absurda → teste em Task 4.
4. Exceção dia 31 num mês de 30 dias: mesma regra da data padrão (mesma função de cálculo) → teste em Task 5.
5. `ibgeCityCode` de outra UF ou inexistente no cadastro do cliente (requisição forjada): 400, nunca grava → teste em Task 3.

---

### Task 1: Municípios (tabela + carga + rota)

**Files:**
- Create: `apps/api/scripts/municipalities/fetch-ibge.mjs` (one-off: baixa a API do IBGE e grava o JSON)
- Create: `apps/api/prisma/data/municipios-ibge.json` (`[{ "ibgeCode": 2800308, "name": "Aracaju", "uf": "SE" }, ...]`, ordenado por código)
- Create: `apps/api/scripts/municipalities/build-migration.mjs` (gera o SQL de INSERT a partir do JSON)
- Modify: `apps/api/prisma/schema.prisma` — `model Municipality { ibgeCode Int @id; name String; uf String @db.Char(2); @@index([uf]); @@map("municipalities") }`
- Create: migration `<ts>_municipalities` (CREATE TABLE + INSERT dos 5.571 gerado pelo script)
- Create: `apps/api/src/modules/municipalities/{municipalities.routes,municipalities.service,municipalities.schema}.ts`
- Create: `apps/api/src/lib/uf.ts`
- Modify: `apps/api/src/server.ts` (registrar com prefixo `/municipalities`), `apps/api/src/api-docs/access.ts` (ou `client.ts`), `apps/api/src/plugins/openapi.ts` (`TAG_BY_SEGMENT.municipalities = 'Municípios'`)
- Test: `apps/api/src/modules/municipalities/municipalities.test.ts`

**Interfaces:**
- Produces: `UFS: readonly ['AC', ..., 'TO']`, `ufSchema = z.enum(UFS)` em `@/lib/uf`.
- Produces: `findMunicipality(ibgeCode: number): Promise<{ ibgeCode: number; name: string; uf: string } | null>` e `findMunicipalityByName(name: string, uf: string)` (comparação sem acento/caixa) em `municipalities.service.ts`.
- Produces: `GET /municipalities?uf=SE` → `[{ ibgeCode, name }]` ordenado por nome; papéis ORG_ADMIN/ORG_MANAGER/ORG_MEMBER.

- [ ] **Step 1:** Rodar `node apps/api/scripts/municipalities/fetch-ibge.mjs` (gera o JSON; conferir 5.571 itens, Aracaju 2800308 SE, Maceió 2704302 AL) e `build-migration.mjs` após `migrate:dev --create-only --name municipalities`.
- [ ] **Step 2: Testes falhando** em `municipalities.test.ts`:
  - `GET /municipalities?uf=SE` (staff) → 200, contém `{ ibgeCode: 2800308, name: 'Aracaju' }`, todos da UF.
  - `uf=XX` → 400 `{ message: 'Estado inválido' }`; sem `uf` → 400.
  - sem token → 401; token CLIENT → 403.
  - `findMunicipalityByName('MACEIO', 'AL')` → código 2704302; `findMunicipalityByName('Maceió', 'SE')` → null.
- [ ] **Step 3:** Rodar o teste → falha (rota inexistente). Implementar. Aplicar migration local e no banco de teste.
- [ ] **Step 4:** Teste verde; `db-migration-checker` na migration; catálogo + `audit:routes` + `docs:api`; `openapi.test.ts` verde.
- [ ] **Step 5: Commit** `feat(municipalities): tabela IBGE e rota de busca por UF`

### Task 2: Buscador de CNPJ (BrasilAPI + reserva)

**Files:**
- Modify: `apps/api/src/lib/cnpjws.ts` → renomear para `apps/api/src/lib/cnpj-lookup.ts` (atualizar imports)
- Modify: `apps/api/src/modules/clients/clients.service.ts` (`lookupClientByCnpj`)
- Modify: `apps/api/src/api-docs/client.ts` (descrição: remover "avisa se o CNPJ já é cliente"; dizer BrasilAPI com reserva)
- Test: `apps/api/src/lib/cnpj-lookup.test.ts` (substitui `cnpjws.test.ts`), teste de rota em `clients` se já houver

**Interfaces:**
- Consumes: `findMunicipality`, `findMunicipalityByName` (Task 1).
- Produces: `lookupCnpj(cnpj: string): Promise<CnpjLookupResult>` com `CnpjLookupResult` = campos atuais + `ibgeCityCode: number | null`; `estado` = UF.
- Produces: erros `CnpjNotFoundError` (→ 404 `'CNPJ não encontrado'`) e `CnpjUnavailableError` (→ 502 `'Serviço de consulta de CNPJ indisponível no momento. Tente de novo ou preencha os dados à mão.'`).

- [ ] **Step 1: Testes falhando** (axios mockado, nenhuma chamada real):
  - BrasilAPI 200 com `uf: 'SE', municipio: 'ARACAJU', codigo_municipio_ibge: 2800308` → `{ estado: 'SE', cidade: 'Aracaju', ibgeCityCode: 2800308 }` (nome vem da tabela).
  - BrasilAPI 500/504/timeout/429 → chama CNPJ.ws; resposta da reserva sem código IBGE → resolve por nome+UF (`findMunicipalityByName`).
  - BrasilAPI 404 → `CnpjNotFoundError`, **sem** chamar a reserva.
  - As duas falham → `CnpjUnavailableError`.
  - Código IBGE fora da tabela → `ibgeCityCode: null`, `cidade` = nome da API, sem erro. *(Review Focus 2)*
  - Timeout configurado em 8000 ms nas duas chamadas.
  - Rota: `GET /clients/lookup-cnpj/123` → 400 `'CNPJ inválido'` sem chamar axios.
- [ ] **Step 2:** Rodar → falha. Implementar (BrasilAPI `https://brasilapi.com.br/api/cnpj/v1/{digits}`; mapear `razao_social`, `nome_fantasia`, `cep`, `uf`, `municipio`, `codigo_municipio_ibge`, `bairro`, `descricao_tipo_de_logradouro`+`logradouro`, `numero`, `complemento`).
- [ ] **Step 3:** Verde; docs da API regenerados.
- [ ] **Step 4: Commit** `feat(clients): buscador de CNPJ pela BrasilAPI com CNPJ.ws de reserva`

### Task 3: Cliente com UF e cidade obrigatórios

**Files:**
- Modify: `apps/api/prisma/schema.prisma` — `Client.ibgeCityCode Int?` + relação `municipality Municipality? @relation(fields: [ibgeCityCode], references: [ibgeCode])`, `@@index([organizationId, estado])`
- Create: migration `<ts>_client_ibge_city`
- Modify: `apps/api/src/modules/clients/clients.schema.ts` (`estado: ufSchema` obrigatório com mensagem `'Informe o estado do cliente'`; `ibgeCityCode: z.number().int()` obrigatório `'Informe a cidade do cliente'`; `cidade` deixa de vir do corpo — é derivada), `clients.service.ts` (`companyData` resolve município; select inclui `ibgeCityCode`)
- Modify: `apps/api/src/test/helpers.ts` (`createTestClient` com padrão `estado: 'SE', ibgeCityCode: 2800308, cidade: 'Aracaju'` e overrides `estado`/`ibgeCityCode`); payloads de cliente em testes existentes que não mandam UF/cidade
- Test: `apps/api/src/modules/clients/clients.schema.test.ts`, teste de rota de clientes

**Interfaces:**
- Consumes: `ufSchema` (`@/lib/uf`), `findMunicipality` (Task 1).
- Produces: `createTestClient(orgId, { estado?, ibgeCityCode? })`; `GET /clients` e `GET /clients/:id` trazem `estado`, `cidade`, `ibgeCityCode`.

- [ ] **Step 1: Testes falhando:**
  - PF sem `estado` → 400 `'Informe o estado do cliente'`; PF/PJ sem `ibgeCityCode` → 400 `'Informe a cidade do cliente'`.
  - `estado: 'Sergipe'` → 400 (UF inválida).
  - `ibgeCityCode: 2704302` (Maceió) com `estado: 'SE'` → 400 `'A cidade não pertence ao estado informado'`; código inexistente (9999999) → 400 `'Cidade não encontrada'`; nada gravado. *(Review Focus 5)*
  - Criar válido → grava `cidade = 'Aracaju'` vindo da tabela, mesmo se o corpo mandar `cidade: 'xx'`.
  - PATCH de cliente antigo (criado direto no banco sem `ibgeCityCode`) sem informar cidade → 400; com cidade → 200.
  - Isolamento: PATCH de cliente de outro escritório continua 404.
- [ ] **Step 2:** Rodar → falha. Migration (+ `db-migration-checker`), schema, service, helpers. A regra PJ de endereço completo continua (agora com `ibgeCityCode` no lugar de `cidade` na lista).
- [ ] **Step 3:** Verde no arquivo; depois **suíte completa da API** (o helper e os payloads mudaram) → toda verde. Catálogo/`docs:api` (corpo de `POST/PATCH /clients` mudou).
- [ ] **Step 4: Commit** `feat(clients): estado e cidade (IBGE) obrigatórios no cadastro`

### Task 4: Recorrência — abrangência e exceções (modelo + API)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` — `enum LocationScope { FEDERAL STATE CITY }`; `RecurringTaskTemplate.dueScope LocationScope @default(FEDERAL)`, `onlyListedLocations Boolean @default(false)`, `dueRules RecurringDueRule[]`; `model RecurringDueRule { id String @id @default(cuid()); templateId String; uf String? @db.Char(2); ibgeCityCode Int?; dueDayOfPeriod Int; dueBusinessDayRoll BusinessDayRoll @default(NONE); template ... onDelete: Cascade; municipality Municipality? ...; @@unique([templateId, uf]); @@unique([templateId, ibgeCityCode]); @@map("recurring_due_rules") }`
- Create: migration `<ts>_recurring_due_scope`
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.schema.ts`, `recurring-templates.service.ts` (create/update/get/list incluem `dueRules`), `apps/api/src/test/setup.ts` (se a limpeza precisar da nova tabela antes de templates)
- Test: `apps/api/src/modules/recurring-templates/recurring-due-scope.test.ts`

**Interfaces:**
- Produces: corpo `dueScope: 'FEDERAL'|'STATE'|'CITY'` (default FEDERAL), `onlyListedLocations: boolean` (default false), `dueRules: { uf?: UF; ibgeCityCode?: number; dueDayOfPeriod: number; dueBusinessDayRoll: 'NONE'|'FORWARD'|'BACKWARD' }[]` (default `[]`); no PATCH, `dueRules` enviado substitui a lista.
- Produces: GET da recorrência devolve `dueScope`, `onlyListedLocations`, `dueRules` (com `municipality: { name, uf }` nas municipais).

- [ ] **Step 1: Testes falhando** (mensagens exatas):
  - FEDERAL com `dueRules` não vazio → 400 `'Recorrência federal não tem exceções por localidade'`.
  - FEDERAL com `onlyListedLocations: true` → 400 `'"Só para os locais listados" exige abrangência estadual ou municipal'`.
  - STATE com regra sem `uf` ou com `ibgeCityCode` → 400 `'Exceção estadual precisa só do estado'`; CITY com regra sem `ibgeCityCode` ou com `uf` → 400 `'Exceção municipal precisa só da cidade'`.
  - UF repetida → 400 `'Estado repetido nas exceções'`; cidade repetida → 400 `'Cidade repetida nas exceções'`; cidade inexistente → 400 `'Cidade não encontrada'`.
  - Dia da exceção validado como o padrão: WEEKLY com dia 8 → 400 (mensagem atual de `assertDayOfPeriodValid`).
  - PATCH mudando `dueScope` sem mandar `dueRules` → 400 `'Envie as exceções da nova abrangência'`.
  - PATCH MONTHLY→WEEKLY sem mexer nas exceções, havendo exceção dia 15 → 400. *(Review Focus 3)*
  - Criar STATE com SE dia 15 FORWARD e AL dia 10 BACKWARD → GET devolve as duas; PATCH com `dueRules: [SE]` → só SE.
  - Recorrência de outro escritório → 404 (isolamento inalterado).
- [ ] **Step 2:** Rodar → falha. Migration (+ `db-migration-checker`), schema Zod (`superRefine` para as regras de forma; service para cidade existente, periodicidade e substituição em transação).
- [ ] **Step 3:** Verde; suítes de `recurring-templates` verdes; catálogo/`docs:api`.
- [ ] **Step 4: Commit** `feat(recurring): abrangência do vencimento e exceções por estado/cidade`

### Task 5: Geração usa a regra da localidade

**Files:**
- Create: `apps/api/src/modules/recurring-templates/recurrence-location.ts`
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.service.ts` (função de geração — onde hoje calcula `dueDate`; o template já é carregado com `include` → incluir `dueRules`; carregar `client: { name, estado, ibgeCityCode }`)
- Test: `apps/api/src/modules/recurring-templates/recurrence-location.test.ts` (unit) e `recurring-due-scope.generation.test.ts` (integração)

**Interfaces:**
- Produces:
  ```ts
  type DueRuleInput = { dueScope: 'FEDERAL' | 'STATE' | 'CITY'; onlyListedLocations: boolean; dueDayOfPeriod: number; dueBusinessDayRoll: BusinessDayRoll; dueRules: { uf: string | null; ibgeCityCode: number | null; dueDayOfPeriod: number; dueBusinessDayRoll: BusinessDayRoll }[] }
  type ClientLocation = { name: string; estado: string | null; ibgeCityCode: number | null }
  resolveDueRule(t: DueRuleInput, c: ClientLocation): { ok: true; dueDayOfPeriod: number; dueBusinessDayRoll: BusinessDayRoll } | { ok: false; message: string }
  ```
  Mensagens: `'Cliente <nome> sem estado cadastrado'`, `'Cliente <nome> sem cidade cadastrada'`, `'Cliente <nome> fora dos locais desta recorrência'`. Estado não-UF conta como sem estado.

- [ ] **Step 1: Testes unitários falhando:** FEDERAL ignora localidade; STATE com exceção da UF; STATE sem exceção → padrão; STATE `onlyListed` fora → `ok:false` fora dos locais; STATE cliente `estado: null` e `estado: 'Sergipe'` → sem estado; CITY com exceção; CITY sem `ibgeCityCode` → sem cidade.
- [ ] **Step 2: Testes de integração falhando** (gerar via a função de geração existente/rota de bulk-generate):
  - Cliente SE em recorrência STATE (padrão dia 20, SE dia 15) → `dueDate` dia 15 do mês de vencimento; cliente AL → dia 20.
  - Exceção dia 31 em mês de 30 dias → mesma data que o padrão dia 31 daria. *(Review Focus 4)*
  - Exceção com FORWARD caindo em feriado do escritório → adia (calendário atual).
  - Cliente sem cidade em CITY → log FAILED com a mensagem e nenhuma tarefa; corrigir `ibgeCityCode` e gerar de novo → SUCCESS reaproveitando o log.
  - `onlyListed` com cliente fora → FAILED `'... fora dos locais desta recorrência'`.
  - FEDERAL → datas idênticas às de antes (regressão).
- [ ] **Step 3:** Rodar → falha. Implementar: a regra resolvida substitui `dueDayOfPeriod`/`dueBusinessDayRoll` em `rules` antes de `computeDueDate`/`computeDueDateFromMonth`; `ok:false` → `GenerationUserFacingError(message)` (mesmo caminho das falhas atuais).
- [ ] **Step 4:** Verde; suítes de `recurring-templates` verdes.
- [ ] **Step 5: Commit** `feat(recurring): geração usa o vencimento da localidade do cliente`

### Task 6: Web — cadastro de cliente com UF e cidade

**Files:**
- Modify: `apps/web/src/pages/app/clients/ClientForm.tsx`, `apps/web/src/types/index.ts` (`Client.ibgeCityCode: number | null`)
- Create: `apps/web/src/hooks/useMunicipalities.ts` (`useMunicipalities(uf: string | null)` → `GET /municipalities?uf=`)
- Test: `apps/web/src/pages/app/clients/ClientForm.location.test.tsx`

**Interfaces:**
- Consumes: `GET /municipalities?uf=` (Task 1), resposta do lookup com `ibgeCityCode` (Task 2), corpo com `estado` + `ibgeCityCode` (Task 3).

- [ ] **Step 1: Testes falhando** (msw):
  - Campo "Estado" é select com as 27 UFs; ao escolher SE, "Cidade" lista os municípios de SE; trocar a UF limpa a cidade.
  - Buscar CNPJ preenche UF e cidade (`ibgeCityCode`); lookup com `ibgeCityCode: null` deixa a cidade vazia com aviso "Escolha a cidade".
  - Enviar sem cidade → mensagem "Informe a cidade do cliente" sem chamar a API.
  - Cliente antigo com `estado: 'Sergipe'` e `ibgeCityCode: null` abre sem erro, selects vazios, texto antigo como referência ("Cidade anterior: …"). *(Review Focus 1)*
  - Erro 502 do lookup mostra a mensagem do servidor e deixa preencher à mão.
- [ ] **Step 2:** Rodar → falha. Implementar.
- [ ] **Step 3:** Verde; suíte web verde; QA visual (Playwright) do formulário claro/escuro com busca de CNPJ e cliente antigo.
- [ ] **Step 4: Commit** `feat(web): estado e cidade no cadastro de cliente`

### Task 7: Web — abrangência na recorrência e vínculo de clientes

**Files:**
- Modify: `apps/web/src/pages/app/settings/RecurringTemplateForm.tsx`, `RecurringTemplateManage.tsx`, `apps/web/src/types/index.ts`
- Create: `apps/web/src/components/recurring/DueRulesEditor.tsx`
- Test: `apps/web/src/pages/app/settings/RecurringTemplateForm.scope.test.tsx`, `RecurringTemplateManage.scope.test.tsx`

**Interfaces:**
- Consumes: corpo/resposta da Task 4; `useMunicipalities` (Task 6); `GET /clients` com `estado`/`ibgeCityCode`.

- [ ] **Step 1: Testes falhando:**
  - "Abrangência do vencimento" com Federal (padrão, tela igual à atual), Estadual, Municipal.
  - Estadual: adicionar exceção (UF + dia + adiantar/adiar); UF já usada some da lista; salvar envia `dueScope: 'STATE'` e `dueRules`.
  - Municipal: escolher UF → cidade; salvar envia `ibgeCityCode`.
  - "Só para os locais listados" só aparece em Estadual/Municipal.
  - Trocar a abrangência com exceções preenchidas pede confirmação e limpa as exceções.
  - Vínculo: lista mostra UF/cidade de cada cliente; com `onlyListedLocations`, o vínculo em lote oferece só os clientes dos locais listados; vínculo individual de cliente fora mostra aviso "Este cliente está fora dos locais da recorrência" (não bloqueia).
- [ ] **Step 2:** Rodar → falha. Implementar.
- [ ] **Step 3:** Verde; suíte web verde; QA visual claro/escuro (federal, estadual com 2 exceções, municipal, vínculo).
- [ ] **Step 4: Commit** `feat(web): abrangência do vencimento e exceções por localidade na recorrência`

### Task 8: Fechamento — documentação, segurança e revisão

**Files:**
- Modify: `docs/SPEC.md` (clientes, recorrência, municípios, buscador), `docs/tech-debt.md` (exceção por cliente; catálogo global de feriados — fora do escopo), `.env.example` (sem variável nova esperada; conferir)

- [ ] **Step 1:** `pnpm --filter api audit:routes && pnpm --filter api docs:api`; `git diff --exit-code docs/api` limpo depois de commitado.
- [ ] **Step 2:** Agent `security-auditor` no diff da branch: entrada do buscador (só dígitos, timeout, sem SSRF), isolamento por `organizationId` em regras/vínculos, `ibgeCityCode` forjado, rota de municípios (papéis), exposição de dados na resposta do lookup. Achado → teste RED → correção → GREEN.
- [ ] **Step 3:** Revisão final da branch (fresh reviewer, modelo mais capaz) conforme executing-plans; Crítico/Importante corrigidos com TDD.
- [ ] **Step 4:** Suítes completas: API (sequencial) e web; `tsc` API e web; build Docker da API e da web.
- [ ] **Step 5: Commit** `docs: vencimento por localidade no SPEC e tech-debt` e entregar ao Max (merge é decisão dele).
