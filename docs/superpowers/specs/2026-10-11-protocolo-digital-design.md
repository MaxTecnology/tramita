# Protocolo Digital com Validade Jurídica + IP — Design

> Item 7 do roadmap de sub-projetos ativos (`docs/TASKS.md`).

## Objetivo

Dar ao escritório um jeito de provar que um cliente foi avisado de algo formal (documento com
vencimento — guia de imposto, comunicado — ou um aviso em texto) e que ele visualizou/baixou
dentro do prazo, ou que não visualizou e o prazo passou. Hoje o sistema só tem rastreamento
"best effort" (`NotificationLog` registra envio/falha por canal, mas não entrega nem leitura).

**Caso de uso que motiva isso:** valores de impostos na casa de milhões — se o cliente perder um
prazo e alegar que nunca foi avisado, o escritório precisa de um registro defensável (número de
protocolo, linha do tempo completa, IP e quem acessou) pra se proteger numa disputa.

**Fora de escopo nesta rodada (decisão explícita):** assinatura eletrônica com valor de
certificação (ICP-Brasil ou similar). "Validade jurídica" aqui significa **evidência defensável**
(prova de que foi avisado e visualizou), não assinatura com força de cartório. O IP é tratado como
evidência de apoio, não como prova inquestionável — ver nota de enquadramento na seção de
Notificações/Comprovante.

## Decisões de escopo (fechadas em brainstorming)

| Decisão | Escolha |
|---|---|
| O que é "protocolo" | Rastreamento (envio/entrega/visualização) + registro imutável com identificador único + comprovante exportável — não é assinatura digital qualificada |
| Objeto do protocolo | Qualquer comunicação que o staff marcar como formal — documento com arquivo **ou** aviso em texto livre. Caso crítico #1: documento/guia com vencimento |
| Onde o protocolo vive | Sempre vinculado a uma `Task` (contexto de criação); referencia um `Attachment` existente (caso documento) **ou** carrega texto livre (caso aviso) — não um campo novo em `TaskDeliverable` |
| Canal de notificação | WhatsApp/email como já existe — mas a mensagem **nunca** carrega o arquivo nem um link de download direto. Só avisa "você tem um protocolo novo, acesse o portal" |
| O que conta como "visualizado" | Dois eventos distintos: abrir a tela do protocolo no portal (`VIEWED`) e clicar em baixar o arquivo (`DOWNLOADED`) — cada um gera seu próprio registro, nunca sobrescreve o anterior |
| Quem visualizou | A pessoa (`ClientUser`) especificamente, não só "a empresa" — uma empresa pode ter mais de um usuário de portal |
| Modelo de histórico | Log de eventos *append-only* (`ProtocolEvent`), não campos únicos sobrescritos — mesmo padrão de `TaskHistory`/`NotificationLog` já usado no projeto. Protocolo nunca é editado depois de criado, só recebe novos eventos |
| Identificador | Número sequencial por organização (`AAAA-NNNNNN`, ex: `2026-000123`) — o que o escritório fala/anota, não o `cuid` interno |
| Regra de "vencido" (`EXPIRED`) | Só se o prazo passou **e o cliente nunca visualizou** (status ainda `SENT`). Se visualizou mas não baixou, não conta como vencido — o aviso chegou a tempo, risco já é bem menor |
| Captura de IP | `trustProxy: 1` no Fastify (confia só no hop imediato do proxy, não na cadeia inteira) — mais estrito que `trustProxy: true`. Auditoria de isolamento de rede do Dokploy/Traefik fica fora desta rodada, por decisão do usuário |
| Evidência adicional | `ProtocolEvent` grava o e-mail do `ClientUser` no momento do evento (snapshot), além do id — reforça a identificação mesmo se o cadastro mudar depois |
| Alerta de "sem visualização" | Estende o digest diário de SLA já existente (mesmo cron, mesmo destinatário por usuário) em vez de criar notificação/cron novo — ver seção 3 |
| Visibilidade pro cliente | Protocolo só existe/aparece se a `Task` for `visibleToClient: true` — mesma trava já usada em `comments.service.ts`/`notifyIfBlocked` |
| Quem pode criar | `ORG_ADMIN`, `ORG_MANAGER`, `ORG_MEMBER` — mesmo conjunto que já comenta/gerencia documentos numa Task |

## Arquitetura

### 1. Schema

```prisma
model Protocol {
  id             String         @id @default(cuid())
  organizationId String
  number         String         // "2026-000123"
  clientId       String
  taskId         String
  attachmentId   String?        @unique
  title          String
  content        String?        // obrigatório se attachmentId for null (validação na camada de schema/service)
  dueDate        DateTime?
  status         ProtocolStatus @default(SENT)
  createdById    String
  createdAt      DateTime       @default(now())

  organization Organization    @relation(fields: [organizationId], references: [id])
  client       Client          @relation(fields: [clientId], references: [id])
  task         Task            @relation(fields: [taskId], references: [id], onDelete: Cascade)
  attachment   Attachment?     @relation(fields: [attachmentId], references: [id])
  createdBy    User            @relation(fields: [createdById], references: [id])
  events       ProtocolEvent[]

  @@unique([organizationId, number])
  @@index([organizationId, status])
  @@index([organizationId, dueDate])
  @@index([clientId])
  @@map("protocols")
}

enum ProtocolStatus {
  SENT       // enviado, aguardando visualização
  VIEWED     // ao menos um ClientUser abriu a tela
  DOWNLOADED // ao menos um ClientUser baixou o arquivo (só aplicável quando há attachmentId)
  EXPIRED    // dueDate passou e status ainda era SENT no momento da checagem
}

model ProtocolEvent {
  id          String            @id @default(cuid())
  protocolId  String
  type        ProtocolEventType
  actorType   String            // 'client' | 'system'
  actorId     String?           // ClientUser.id quando actorType='client'
  actorName   String?
  actorEmail  String?           // snapshot do email do ClientUser no momento do evento
  ip          String?
  userAgent   String?
  createdAt   DateTime          @default(now())

  protocol Protocol @relation(fields: [protocolId], references: [id], onDelete: Cascade)

  @@index([protocolId, createdAt])
  @@map("protocol_events")
}

enum ProtocolEventType {
  SENT
  VIEWED
  DOWNLOADED
  EXPIRED
}

model ProtocolCounter {
  organizationId String
  year           Int
  lastNumber     Int    @default(0)

  @@id([organizationId, year])
  @@map("protocol_counters")
}
```

`ProtocolCounter` existe pra gerar o `number` de forma segura sob concorrência — um
`COUNT(*) + 1` ingênuo tem corrida (duas criações simultâneas podem gerar o mesmo número); o
counter dedicado, incrementado dentro de uma transação (`UPDATE ... SET lastNumber = lastNumber +
1 RETURNING lastNumber`, via `prisma.$transaction`), evita isso.

`Protocol.content` é obrigatório quando `attachmentId` é nulo (validado no service, não no banco
— Prisma não expressa XOR condicional nativamente). `Attachment.taskId` já garante que o anexo
pertence à mesma task do protocolo (checado no service, mesmo padrão de
`TaskDocumentRequirement`).

`User`/`Client` ganham as relações reversas (`protocols Protocol[]`, `createdProtocols
Protocol[]` em `User` para `createdById`) — mesmo motivo do `requestComments` na feature
anterior (Prisma exige os dois lados da relação).

### 2. Backend

**Pré-requisito de infra** — `apps/api/src/server.ts`:

```typescript
const app = Fastify({ logger: process.env.NODE_ENV !== 'test', trustProxy: 1 })
```

Sem isso, `request.ip` dentro do Docker/Traefik reflete o proxy, não o cliente — o IP capturado
nos eventos seria inútil como evidência.

**Novo módulo** `src/modules/protocols/` (schema/service/routes, mesmo padrão dos demais):

```typescript
// protocols.service.ts (assinaturas principais)

export async function createProtocol(
  taskId: string,
  organizationId: string,
  staffId: string,
  data: { title: string; dueDate?: Date; attachmentId?: string; content?: string },
) {
  // 1. valida task pertence à org e visibleToClient === true
  // 2. valida attachmentId XOR content (pelo menos um, attachmentId pertence à mesma task)
  // 3. gera o número via ProtocolCounter (transação com increment atômico)
  // 4. cria Protocol (status SENT) + ProtocolEvent (type SENT, actorType 'system') na mesma transação
  // 5. enqueueNotification({ event: 'PROTOCOL_CREATED', clientId, metadata: { protocolTitle: title } })
  //    — corpo da mensagem NUNCA inclui link de download nem anexo, só avisa pra acessar o portal
}

export async function listProtocolsForOrg(organizationId: string, filters: { status?; clientId?; from?; to? }) { /* ... */ }
export async function listProtocolsForTask(taskId: string, organizationId: string) { /* ... */ }
export async function listProtocolsForClient(organizationId: string, clientId: string, filters: { status?; from?; to?; search? }) { /* ... */ }
export async function getProtocolById(id: string, organizationId: string) { /* inclui events, ordenados por createdAt */ }

export async function registerView(
  protocolId: string,
  organizationId: string,
  clientUser: { id: string; name: string; email: string },
  ip: string,
  userAgent: string,
) {
  // valida acesso do ClientUser à company do protocolo (getClientAccessScope, mesmo padrão de request-comments)
  // sempre cria um ProtocolEvent VIEWED (histórico completo, mesmo se já visto antes)
  // avança status SENT -> VIEWED só se ainda estiver em SENT (nunca regride)
}

export async function registerDownload(
  protocolId: string,
  organizationId: string,
  clientUser: { id: string; name: string; email: string },
  ip: string,
  userAgent: string,
) {
  // mesma validação de acesso; 404 se não houver attachmentId (nada pra baixar)
  // sempre cria ProtocolEvent DOWNLOADED; avança status pra DOWNLOADED se ainda não estava lá
  // retorna a signed URL do Attachment (getSignedDownloadUrl) pro endpoint servir
}

export async function expireOverdueProtocols(organizationId: string, now: Date) {
  // roda no cron diário: Protocol.status === 'SENT' && dueDate < now
  // -> status EXPIRED + ProtocolEvent (type EXPIRED, actorType 'system')
}
```

**Rotas (lado escritório)** — `protocols.routes.ts`, registrado sem prefixo (igual
`comments`/`request-comments`), roles `ORG_ADMIN`/`ORG_MANAGER`/`ORG_MEMBER` salvo onde anotado:

- `POST /tasks/:taskId/protocols` — cria.
- `GET /tasks/:taskId/protocols` — lista da task.
- `GET /protocols` — lista da org com query params de filtro (status, clientId, from, to).
- `GET /protocols/:id` — detalhe com timeline.
- `GET /protocols/:id/receipt` — gera e devolve o PDF do comprovante (ver seção 3).

**Rotas (lado portal)** — dentro de `portal.routes.ts` (mesmo padrão dos outros endpoints de
portal, resolve `clientId` via `getClientAccessScope`):

- `GET /portal/protocols` — lista com filtro (status, from, to, search por título).
- `GET /portal/protocols/:id` — detalhe; chama `registerView` com `request.ip`/`request.headers['user-agent']`.
- `GET /portal/protocols/:id/download` — só existe quando `attachmentId` não é nulo; chama
  `registerDownload`, redireciona (302) pra signed URL ou retorna `{ url }` pro frontend abrir.

### 3. Notificações, digest e comprovante

**Evento novo:** `PROTOCOL_CREATED` (staff→cliente) — nivelado nos 6 pontos de toque padrão já
repetidos nesta sessão (enum `NotificationEvent`, campo em `NotificationConfig`,
`EVENT_FLAG_MAP`, `DEFAULT_TEMPLATES`, `Notifications.tsx`, `Templates.tsx`). Corpo do template
só menciona título e link pro portal — nunca o arquivo.

**Digest diário — estende `sla-digest.cron.ts`, não cria um novo:**

`runSlaDigestForOrg` passa a também buscar protocolos em risco (`status IN ('SENT','VIEWED')`,
`dueDate` dentro de `protocolWarningDays` dias, `attachmentId` quando aplicável ainda sem
`DOWNLOADED`), resolvidos pro mesmo destinatário por usuário que as tarefas de SLA já usam
(assignee da `Task` vinculada, com fallback pra `ORG_ADMIN`/`ORG_MANAGER` se não houver assignee
ativo — mesma regra já existente). As linhas de protocolo entram no **mesmo** `taskListText` que
já é montado e enviado no evento `SLA_DIGEST` existente — sem evento de notificação novo, sem
template novo pra isso. `DigestEntry` ganha um campo `kind: 'task' | 'protocol'` pra diferenciar
a formatação da linha (`formatTaskLine` passa a checar o `kind`).

`NotificationConfig` ganha `protocolWarningDays Int @default(3)` (mesmo padrão de
`slaTargetWarningDays`) — configurável em `Notifications.tsx`, junto da seção de SLA.

**Comprovante (PDF, sob demanda):** `GET /protocols/:id/receipt` renderiza um HTML (template
próprio em `lib/protocol-receipt.ts`, mesmo espírito de `lib/email-template.ts`) com: número do
protocolo, título, cliente, conteúdo ou nome do arquivo, e a timeline completa de
`ProtocolEvent` (tipo, quem — nome e email —, IP, data/hora). Usa `puppeteer` (já citado na stack
do `CLAUDE.md`, ainda não usado em código — primeira adição real da dependência) pra converter
esse HTML em PDF. Texto fixo no rodapé do comprovante: *"O IP registrado é evidência de apoio do
acesso à plataforma, vinculado à autenticação do usuário no momento do evento — não constitui
assinatura digital certificada."* — enquadramento honesto, decidido em brainstorming.

### 4. Frontend

- **`TaskDrawer`** ganha aba "Protocolos": lista dos protocolos da task (número, título, status,
  timeline resumida) + botão "Criar protocolo" (modal: escolher anexo já existente na task **ou**
  texto livre, título, prazo opcional).
- **Portal** — tela nova `/portal/protocols` ("Meus Protocolos"): mesmos filtros de
  status/busca/período já usados em `/portal/requests` (reaproveita o padrão visual). Cada card
  mostra status, prazo, e abre o detalhe (dispara `VIEWED`); botão "Baixar" quando há arquivo
  (dispara `DOWNLOADED`).
- **Dashboard (admin)** — aba nova "Protocolos" ao lado de "Visão geral"/"Produtividade": cards
  de contagem (enviados / visualizados / baixados / vencidos) + tabela ordenada por urgência
  (vencendo sem visualização primeiro) + link pro detalhe de cada um, com botão "Gerar
  comprovante".

## Fora do escopo (v1)

- Assinatura eletrônica com valor de certificação (ICP-Brasil ou similar) — decisão explícita do
  usuário, pode ser revisitado depois se o risco jurídico justificar o custo de integração.
- Auditoria de isolamento de rede do Dokploy/Traefik (confirmar que só o Traefik alcança a API na
  rede Docker) — levantado em brainstorming, decisão explícita do usuário de não bloquear esta
  feature nisso agora. Recomendação registrada: rodar o agent `infra-auditor` nessa VPS em algum
  momento antes de depender fortemente do IP capturado como prova.
- Reenvio automático de protocolo perto do vencimento sem visualização (hoje só alerta o staff
  via digest — qualquer reenvio pro cliente é decisão manual da equipe).
- Protocolo vinculado a mais de uma `Task`/cliente simultaneamente (ex: comunicado em massa) —
  cada protocolo é 1:1 com uma task e um cliente.

## Revisão própria

- **Placeholders:** nenhum — toda função listada tem assinatura completa e descrição do que faz;
  o código exato (schema Zod, rotas, templates) é trabalho de implementação do plano, não desta
  spec.
- **Consistência:** `ProtocolEvent` segue o mesmo padrão *append-only* de `TaskHistory` e
  `NotificationLog`, já estabelecidos no projeto — nenhum conceito novo de auditoria.
- **Ambiguidade resolvida:** regra de `EXPIRED` fechada (só se nunca visualizou); captura de IP
  fechada (`trustProxy: 1`, sem auditoria de rede nesta rodada — ambas decisões explícitas do
  usuário, registradas nesta spec e na seção "Fora do escopo").
- **Segurança:** `registerView`/`registerDownload` reaproveitam `getClientAccessScope` (mesmo
  gate já testado em `comments.service.ts`/`request-comments.service.ts`) — um `ClientUser` sem
  acesso à empresa do protocolo recebe 404, nunca aprende que o protocolo existe.
- **Honestidade na evidência:** o comprovante deixa explícito que o IP é evidência de apoio, não
  prova inquestionável — evita o escritório (ou um cliente/advogado) superinterpretar o que o
  sistema realmente garante.
- **Rastreabilidade pra disputa:** `ProtocolEvent` grava `actorEmail` como snapshot (além do
  `actorId`), então mesmo que o cadastro do `ClientUser` mude depois, o comprovante mantém a
  identificação de quem acessou no momento do evento.
