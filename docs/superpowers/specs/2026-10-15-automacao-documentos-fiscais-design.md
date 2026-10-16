# Automação de Documentos Fiscais — Design

> Item 6 do roadmap de produto (ver memória `project_product_roadmap`). Maior risco técnico do
> roadmap — esta spec existe justamente porque a decisão de abordagem (regras determinísticas vs.
> IA) já foi validada numa POC isolada antes de qualquer código entrar no sistema real.

## Objetivo

Quando um PDF de obrigação fiscal (guia de imposto, recibo de declaração) chega numa tarefa —
hoje só via upload manual, cliente ou staff —, o sistema deve **ler o documento, identificar o
tipo de obrigação, o cliente e o período, achar a Task recorrente aberta correspondente, e sugerir
o anexo** — sem precisar que um humano abra o PDF pra descobrir isso.

Fora de escopo nesta fase (decidido com o Max, 2026-10-15):
- Fonte de dados externa (pasta, e-mail, Drive) — só documentos já no sistema via upload manual.
- OCR de PDF escaneado/imagem — sinalizado pra revisão manual; é o próximo passo depois deste v1.
- Fallback de IA pra documento não reconhecido por nenhum modelo — mesma lógica, fase posterior.
- Anexo automático sem confirmação humana — v1 roda em **modo sombra** (lê e sugere, nunca anexa
  sozinho) até medir a taxa de acerto por modelo.
- Schema-por-tenant (consideração arquitetural separada, levantada na mesma conversa — ver memória
  `project_schema_per_tenant_consideration`). Não bloqueia nem depende desta feature.

## Origem: POC validada

Existe uma POC isolada em `poc-extracao-pdf/` (fora do sistema real) que já testou a abordagem:
**extração zonal por modelo** (âncoras de texto fixo identificam o layout; zonas marcadas por
coordenada normalizada 0..1 leem cada campo) + validadores (dígito verificador de CNPJ/CPF, datas
reais, competência) — tudo determinístico, sem IA no caminho principal. Resultado: 7/7 amostras
sintéticas, 8/8 PDFs reais de DARF (IRPJ/CSLL via SENDA), 3/3 do Simples Nacional (DAS, PGDAS-D
recibo e declaração).

Decisão de abordagem (da POC, confirmada aqui): **cascata determinística**, não IA. Motivo:
documento fiscal brasileiro é muito padronizado (um modelo por layout cobre a maioria); IA erra em
silêncio (troca CNPJ ou data sem avisar) e dado fiscal de cliente saindo pra API externa pede
cuidado extra — não vale o risco pro caminho principal. O motor da POC porta quase como está —
é código puro, sem banco nem HTTP, já testado.

## Modelo de dados

### Dois níveis: global (AutoHubs) e por escritório

Tanto o **tipo de obrigação fiscal** quanto o **modelo de layout** existem em dois níveis — decisão
do Max (2026-10-15): um erro de cadastro de um escritório nunca pode afetar outro, mas a AutoHubs
cura uma base comum (DARF, DAS, PGDAS-D... são os mesmos documentos em qualquer escritório) pra não
duplicar trabalho. `organizationId` nulo = global (só um painel futuro de admin AutoHubs cadastra);
preenchido = privado daquele escritório.

```prisma
model TaxObligationType {
  id             String   @id @default(cuid())
  code           String   // "IRPJ", "DAS", "CSLL", "PGDAS-D"
  name           String   // nome de exibição
  organizationId String?  // null = global (AutoHubs); preenchido = só do escritório
  isActive       Boolean  @default(true)
  createdById    String?  // null pros globais
  createdAt      DateTime @default(now())

  organization Organization?   @relation(fields: [organizationId], references: [id])
  createdBy    User?           @relation(fields: [createdById], references: [id])
  documentModels DocumentModel[]

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
  // Formato igual ao `Modelo` da POC (src/types.ts): { ancoras, zonas, tipoImpostoCampo?, subtipos? }
  definicao           Json
  createdById         String?
  createdAt           DateTime @default(now())

  taxObligationType TaxObligationType  @relation(fields: [taxObligationTypeId], references: [id])
  organization      Organization?      @relation(fields: [organizationId], references: [id])
  createdBy         User?              @relation(fields: [createdById], references: [id])
  documentos        ReceivedDocument[]

  @@map("document_models")
}
```

Salvar um modelo sempre cria uma nova versão (nunca sobrescreve); `ReceivedDocument` guarda qual
versão leu, pra auditoria — substitui o `_historico/` em arquivo da POC por histórico em banco.

### Documento recebido

```prisma
model ReceivedDocument {
  id              String   @id @default(cuid())
  organizationId  String
  attachmentId    String?  @unique // preenchido só quando vira anexo de verdade na Task
  fileHash        String   // sha256 do PDF — dedupe primário (bloqueia reprocessar o mesmo arquivo)
  documentNumber  String?  // "numero_documento" extraído — dedupe secundário, não bloqueante (ver fluxo)
  storageKey      String   // B2, antes de virar Attachment oficial
  status          ReceivedDocumentStatus @default(PENDING)
  documentModelId String?
  modelVersion    Int?
  confidence      Float?
  // campos brutos + interpretados do motor (CampoExtraido[] da POC) — pra auditoria e fila de revisão
  extractedFields Json?
  taskId          String?  // sugerida (pelo motor) ou confirmada (por um humano)
  how             String?  // "sugerido" | "confirmado" | "trocado" | "manual" | "criado" | "rejeitado"
  reviewedById    String?
  reviewedAt      DateTime?
  createdAt       DateTime @default(now())

  organization  Organization    @relation(fields: [organizationId], references: [id])
  documentModel DocumentModel?  @relation(fields: [documentModelId], references: [id])
  task          Task?           @relation(fields: [taskId], references: [id])
  attachment    Attachment?     @relation(fields: [attachmentId], references: [id])
  reviewedBy    User?           @relation(fields: [reviewedById], references: [id])

  @@unique([organizationId, fileHash])
  @@map("received_documents")
}

enum ReceivedDocumentStatus {
  PENDING          // processando ou aguardando confirmação na fila
  ATTACHED         // confirmado e anexado a uma Task
  NOT_IDENTIFIED   // nenhum modelo reconheceu (sem_texto ou candidato sem match) — revisão manual
  REJECTED         // revisor rejeitou (não é um documento válido, ou duplicado indesejado)
}
```

`RecurringTaskTemplate` ganha um campo novo e opcional, `taxObligationTypeId String?` — só
preenchido pra templates que geram obrigação fiscal; é o que permite casar `(client, obrigação,
competência)` contra `Task` com confiança, em vez de comparar `title` (texto livre) contra o tipo
extraído do PDF.

DAS (guia de pagamento) e PGDAS-D (declaração) não precisam de uma regra especial aqui: cada um
é o seu próprio `TaxObligationType`, e cada escritório decide se isso vira uma `RecurringTaskTemplate`
só ou duas — usando os campos que já existem (`visibleToClient`, `notifyViaWhatsapp`,
`notifyViaEmail`) pra diferenciar tarefa voltada ao cliente de tarefa interna do escritório. O robô
só casa contra o que existir; não precisa saber nem decidir essa modelagem.

### Identificadores do cliente

`Client` hoje só tem `cnpj`/`cpf`. Decisão (2026-10-15): adicionar `cei`, `caepf` e
`inscricaoEstadual` (todos `String?`) ao `Client` já nesta feature — produtor rural (CEI) e
entidades com CAEPF/IE não teriam nenhuma forma de casar automaticamente sem isso. O casamento do
motor tenta CNPJ, depois CPF, depois CEI, depois CAEPF, depois IE — o primeiro que bater identifica
o cliente. Fora do motor, isso também toca os formulários/telas existentes de cadastro de cliente
(fora do escopo de UI desta feature, mas o campo precisa existir no schema e no formulário básico).

### Retenção de dado (LGPD)

`ReceivedDocument` guarda CNPJ/valores extraídos de documento fiscal de cliente — precisa de uma
política, não só "fica pra sempre":
- **`ATTACHED`**: sem retenção especial — vira um `Attachment` normal, mesma política de qualquer
  outro anexo de tarefa (hoje: indefinida, soft-delete por staff).
- **`REJECTED`**: expurgo automático depois de **30 dias** (decidido com o Max) — apaga o objeto do
  B2 e os campos extraídos (ou a linha inteira) do `ReceivedDocument`. Tempo suficiente pra reverter
  uma rejeição por engano; depois disso não há razão de negócio pra guardar dado fiscal de um
  documento descartado.
- **`PENDING`/`NOT_IDENTIFIED`** (ainda na fila, ninguém decidiu): sem expurgo automático — é
  trabalho em aberto, apagar sozinho arrisca perder uma obrigação real antes de alguém olhar. Fica
  como trabalho futuro um alerta de "pendente há muito tempo" na própria fila.
- Acesso: já restrito por `organizationId` + `requireRole(ORG_ROLES)`, igual a qualquer outro dado
  fiscal do sistema — mesma equipe que já vê os anexos do cliente hoje.

## Fluxo

1. **Ingestão** (reaproveita o upload existente): staff ou cliente sobe um PDF como anexo de
   obrigação fiscal — rota nova, não o fluxo genérico de anexo de task — sha256 → grava no B2 →
   cria `ReceivedDocument(status=PENDING)` → enfileira job `leitura-documento-fiscal` (BullMQ, mesmo
   padrão de `sla-digest.cron.ts`/`recurring-tasks.cron.ts`: Queue + Worker). Dedupe por
   `(organizationId, fileHash)` — mesmo arquivo não processa duas vezes. `documentNumber` repetido
   na mesma org não bloqueia (pode ser PDF diferente do mesmo documento), mas gera aviso de
   possível duplicata na fila de revisão.
2. **Worker**: baixa do B2, roda o motor portado (`extrairTexto` → `pontuarModelos` → zona por
   zona → validadores → confiança), carregando os `DocumentModel` ativos da org **mais** os globais.
   Grava em `ReceivedDocument`: campos extraídos, modelo+versão usado, confiança, `status`.
   Limites de segurança (do `INTEGRACAO.md`): timeout, limite de tamanho/páginas,
   `isEvalSupported: false`, processo isolado (PDF é entrada não confiável).
3. **Casamento**: CNPJ/CPF/CEI/CAEPF/Inscrição Estadual → `Client` (ver identificadores novos
   abaixo); `taxObligationTypeId` extraído → `Task` aberta cujo
   `recurringTemplate.taxObligationTypeId` bate, do mesmo `Client` (via `board.clientId`) e
   competência tolerante (aceita `2026-06` e `2026-T2`, igual a POC já faz). `taxObligationTypeId`
   mora em `RecurringTaskTemplate`, não em `Task` — o join passa pelo template. Exatamente 1
   candidata com confiança ≥ 0.9 e sem âncora ambígua → sugestão forte; qualquer outro caso (0, >1,
   confiança baixa, campo inválido, sem camada de texto) → fila de revisão.
4. **Fila de revisão** (ORG_ADMIN/MANAGER/MEMBER, modo sombra — v1 nunca anexa sozinho): tela
   lista `ReceivedDocument` pendente com o PDF ao lado dos campos lidos; ações: confirmar sugestão
   (chama `createAttachment` existente, igual qualquer outro anexo — ver `attachments.service.ts`),
   trocar a tarefa sugerida, criar tarefa nova e anexar, rejeitar, reabrir. Documento sem modelo
   (`NOT_IDENTIFIED`) ou sem camada de texto cai aqui também, pra anexo 100% manual.
5. **Anexo**: sempre via `createAttachment(taskId, organizationId, actor, payload)` já existente —
   nunca um caminho de anexo paralelo. `ReceivedDocument.how` registra se foi confirmação direta,
   troca de tarefa, criação de tarefa nova, ou (fase futura) automático.
6. **Modelagem** (só ORG_ADMIN): tela pra cadastrar um `DocumentModel` novo a partir de um PDF não
   reconhecido — reconhece/parecido/conflito, marcar campo e âncora clicando no texto posicionado
   (pdf.js), teste ao vivo com impacto nos documentos já recebidos, salvar cria nova versão.

## Regras do motor que não podem se perder (da POC, `INTEGRACAO.md` §3)

1. Todas as âncoras do modelo são obrigatórias (não um threshold parcial) — já causou bug real na
   POC (DAS lido como DARF com 3 de 4 âncoras batendo).
2. Dois modelos reconhecendo o mesmo PDF = conflito → revisão, nunca escolha arbitrária.
3. Confiança = score de âncoras × fração de campos obrigatórios válidos (×0.5 se há inconsistência
   entre campos, ex: cabeçalho vs. linha PA). Abaixo de 0.9, nunca sugere com confiança alta.
4. Coordenadas normalizadas 0..1, origem no topo; o centro do texto precisa cair na zona
   (+ margem 0.004); âncoras compensam deslocamento de layout (dx, dy).
5. Conteúdo do PDF manda, nunca o nome do arquivo.
6. Sem camada de texto (PDF escaneado) → revisão manual, nunca tenta interpretar.

## O que NÃO entra neste v1 (adiado, não esquecido)

- OCR por zona (Tesseract) pra PDF escaneado/imagem — próximo passo imediato depois deste v1
  (confirmado com o Max: "podemos seguir deixar tudo fechado e logo depois implementar o OCR").
- Fallback de IA pra documento sem modelo — fase posterior, só se o volume de `NOT_IDENTIFIED`
  justificar; nessa hora decide-se orçamento por PDF e política de dado saindo do servidor.
- Anexo automático sem revisão — fase posterior, por modelo, só depois de medir taxa de acerto.
- Schema-por-tenant — projeto arquitetural próprio, não relacionado a esta feature.
- Detectar PDF com várias guias combinadas num arquivo só (ver limitação conhecida abaixo).

## Limitações conhecidas (herdadas da POC, aceitas pro v1)

- **Âncora só casa com um único item de texto do pdf.js** — se o pdf.js quebrar uma frase-âncora
  em vários itens, a âncora não é encontrada e o modelo não reconhece o documento (cai em
  `NOT_IDENTIFIED`, não em erro silencioso).
- **Só a primeira linha de composição é lida** — um DARF com várias linhas de retenção não tem
  todas elas capturadas; o valor principal e os campos de identificação continuam corretos.
- **PDF com várias guias num arquivo só não é detectado** — o motor assume 1 documento por PDF.
  Um PDF combinado produz leitura de uma das guias (resultado de baixa confiança ou estranho), que
  cai na fila de revisão pelo modo sombra — nunca anexa sozinho um resultado desses.
- **Declaração retificadora do PGDAS-D** gera novo recibo pra mesma competência — isso não precisa
  de tratamento especial: vira só mais um anexo na mesma Task, igual a qualquer outro documento
  adicional (mesmo mecanismo que já resolve as 3 cotas do IRPJ/CSLL trimestral).

## Perguntas em aberto (não bloqueiam a spec, mas afetam quais modelos entram primeiro)

- Quais documentos além de DARF (IRPJ/CSLL), DAS e PGDAS-D (já tem modelo pronto na POC) são mais
  frequentes nos clientes do Max — GPS, FGTS, DCTFWeb? Se não houver resposta agora, v1 entra só
  com os 3 já prontos e novos modelos são cadastrados pela tela de modelagem conforme aparecem.

## Plano de implementação (ordem sugerida)

1. Portar o motor (`extrair-texto`, `ancoras`, `zonal`, `validadores`, `pipeline`) como módulo puro
   em `apps/api/src/modules/document-reader/engine/`, com os testes da POC (sintéticos + PDFs reais
   anonimizados) rodando no CI.
2. Schema Prisma (`TaxObligationType`, `DocumentModel`, `ReceivedDocument`, campos novos
   `cei`/`caepf`/`inscricaoEstadual` em `Client`, campo novo `taxObligationTypeId` em
   `RecurringTaskTemplate`) + migration + seed dos 3 modelos globais iniciais (DARF, DAS, PGDAS-D).
3. **Validação com conjunto separado**: antes de confiar no casamento pra uso real, rodar os 3
   modelos contra PDFs reais que **não** participaram do desenho das zonas (outro mês, outro
   cliente) e medir a taxa de acerto de verdade — os 8/8 e 3/3 da POC foram medidos nos mesmos
   PDFs usados pra desenhar as zonas (validação circular), não provam generalização.
4. Ingestão (rota de upload dedicado) + fila BullMQ + worker (com os limites de segurança) +
   resolvedores assíncronos de cliente/tarefa (substituindo o `Base` em memória da POC) + job de
   expurgo dos `REJECTED` com mais de 30 dias.
5. API + tela da fila de revisão (modo sombra), usando `createAttachment` existente — inclui aviso
   de possível duplicata por `documentNumber` repetido.
6. API + tela de modelagem (só ORG_ADMIN): analisar PDF, marcar campo/âncora, testar impacto,
   versionar.
7. Métricas (sugestão aceita/trocada/rejeitada, por modelo) — mesma semântica da POC
   (`src/app/servico.ts`), só conta decisão humana.
