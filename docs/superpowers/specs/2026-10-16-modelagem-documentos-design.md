# Modelagem de Documentos (Plano B) — Design

## Objetivo

Hoje o robô de leitura de documentos (`document-reader`, Plano A) só reconhece os 4
`DocumentModel` globais semeados via script (DARF/IRPJ-CSLL, DAS, PGDAS-D recibo, PGDAS-D
declaração). Nenhum escritório consegue cadastrar o próprio modelo — se o layout do documento que
ele recebe não bater com um dos 4 globais (o que a validação com conjunto separado da Task 15 do
Plano A já mostrou acontecer até com pequenas variações, como empresas multi-filial), o documento
cai sempre em `NOT_IDENTIFIED` e precisa ser anexado manualmente, sem nenhuma sugestão.

Este plano entrega a tela de modelagem: o `ORG_ADMIN` sobe um PDF de amostra, marca nele os
textos fixos (âncoras) e os campos (CNPJ, competência, vencimento, valor...), e salva como um
`DocumentModel` privado da própria organização — o mesmo princípio dos "robôs personalizados" do
Nibo (https://ajuda.nibo.com.br/pt-BR/articles/7873582-robos-personalizados), que inspirou o
desenho original do motor.

## Contexto

- Spec/plano do Plano A: `docs/superpowers/specs/2026-10-15-automacao-documentos-fiscais-design.md`,
  `docs/superpowers/plans/2026-10-15-automacao-documentos-fiscais-plan-a.md`.
- Renomeação `TaxObligationType` → `ObligationType` (commit `3e0c831`, 2026-10-16): a feature não é
  fiscal-específica, serve qualquer departamento/obrigação que gere documento pra anexar numa
  tarefa.
- POC original (`/home/max/job/autohubs/POC/poc-extracao-pdf`) já tem um protótipo funcional dessa
  tela em `src/app/modelos.ts` + `src/app/public/index.html`. A técnica central — reconstruir a
  página posicionando os itens de texto já extraídos como elementos clicáveis, sem renderizar o
  PDF como imagem/canvas — é reaproveitada aqui. Os recursos extras da POC (sugestão automática de
  âncoras, teste ao vivo do rascunho, análise de impacto contra documentos já recebidos) ficam
  fora deste v1 — ver "Fora de escopo" abaixo.

## Quem usa

Só `ORG_ADMIN` do escritório. A tela não existe para `ORG_MANAGER`/`ORG_MEMBER`/`CLIENT`.

## Arquitetura e fluxo de dados

```
PDF de amostra (upload, não persistido)
  -> POST /document-reader/modelos/analisar
  -> backend chama extrairDocumento() (já existe, engine do Plano A)
  -> devolve { paginas: [{ numero, largura, altura, itens: [{ str, x, y, w, h }] }] }
  -> frontend guarda os itens em memória (estado React) — nenhuma chamada nova ao
     backend acontece enquanto o usuário marca campos; o PDF em si nunca é salvo em
     lugar nenhum, só a *definição* (âncoras/zonas) é persistida no final
  -> usuário marca âncoras e campos clicando nos itens reconstruídos na tela
  -> usuário escolhe nome do modelo + ObligationType (existente ou criado na hora)
  -> Salvar -> POST ou PATCH /document-reader/modelos -> grava DocumentModel
     (organizationId = org do admin; nunca cria/edita um modelo global)
```

Não há estado intermediário no banco entre "analisar" e "salvar" — se o usuário atualizar a
página no meio da modelagem, perde o progresso e tem que subir o PDF de novo. Aceitável pro v1
(sem teste ao vivo/impacto, a sessão de modelagem já é curta).

## Modelo de dados

Nenhuma mudança de schema. `DocumentModel` e `ObligationType` já existem (Plano A). O único
detalhe novo é que `DocumentModel.organizationId` deixa de ser sempre `null` na prática — a partir
daqui, orgs podem ter linhas próprias (`organizationId = <org do admin>`), que o motor do Plano A
já sabe misturar com os globais via `carregarModelosDaOrg` (`OR: [{organizationId: null},
{organizationId}]`) — nenhuma mudança necessária ali.

## Endpoints

Todos exigem `ORG_ADMIN` (`requireRole('ORG_ADMIN')`), não o grupo `ORG_ROLES` completo — só quem
administra o escritório mexe em modelo.

### `POST /document-reader/modelos/analisar`

Multipart, mesmo padrão de `/document-reader/upload` (limite 20MB, só `application/pdf`,
`@fastify/multipart`). Não grava nada no banco nem no B2 — chama `extrairDocumento` direto no
buffer recebido e devolve o resultado.

```
Response 200:
{
  "paginas": [
    { "numero": 1, "largura": 595, "altura": 842, "itens": [
      { "str": "Documento de Arrecadação", "x": 0.1, "y": 0.05, "w": 0.3, "h": 0.02 }
    ]}
  ]
}
```

Erros: 400 (nenhum arquivo enviado), 422 (não é PDF / PDF sem texto — reusa a mesma mensagem de
`temTexto=false` do motor), 413 (excede 20MB) — mesma convenção de status já usada em
`document-reader.routes.ts::POST /document-reader/upload` pro Plano A.

### `GET /document-reader/modelos`

Lista modelos da própria org + globais, com indicação de qual é qual.

```
Response 200:
[
  { "id": "...", "nome": "DARF Receita Federal", "obligationType": { "id": "...", "name": "IRPJ" },
    "isGlobal": true, "isActive": true, "version": 1 },
  { "id": "...", "nome": "Recibo RH", "obligationType": { "id": "...", "name": "Recibo de Pagamento" },
    "isGlobal": false, "isActive": true, "version": 2 }
]
```

### `POST /document-reader/modelos`

```
Body: {
  "nome": "string",
  "obligationTypeId": "cuid",
  "ancoras": [{ "texto": "string", "pagina": 1, "x": 0.1, "y": 0.05 }],
  "zonas": [{ "campo": "cnpj", "pagina": 1, "x": 0.1, "y": 0.1, "w": 0.3, "h": 0.02,
              "tipo": "cnpj" | "data" | "competencia" | "periodo_apuracao" | "moeda" | "texto",
              "opcional": false }]
}
```

Validação (reaproveita as mesmas regras que a POC já tinha em `validarModelo`, adaptadas):
- `nome` obrigatório, não vazio.
- `obligationTypeId` deve existir e pertencer à própria org ou ser global.
- Pelo menos 1 âncora.
- Pelo menos 1 campo `cnpj` e 1 campo `competencia` ou `periodo_apuracao` (sem isso o motor nunca
  consegue casar cliente/tarefa — mesma regra que a POC já impõe).
- Nomes de campo únicos dentro do modelo.
- Coordenadas em `[0, 1]`.

Grava com `organizationId = org do actor`, `createdById = actor.id`, `version = 1`.

### `PATCH /document-reader/modelos/:id`

Mesmo body do POST. Só aceita editar um `DocumentModel` cujo `organizationId` é da própria org
(nunca um global — 404 se tentar, mesmo padrão de `os-templates.service.ts`: um `findFirst({ id,
organizationId })` que não bate não revela se o recurso existe pra outra org). Incrementa
`version` a cada salvamento bem-sucedido.

### `DELETE /document-reader/modelos/:id`

Soft-delete: `isActive = false`. Mesma regra de escopo do PATCH (nunca um global). Não apaga do
banco — modelo arquivado some da lista de reconhecimento (`carregarModelosDaOrg` já filtra por
`isActive: true`) mas `ReceivedDocument` antigos que apontam pra ele continuam íntegros
(`documentModelId` não é obrigatório, FK permite).

### `POST /document-reader/obrigacoes`

```
Body: { "code": "string", "name": "string" }
```

Cria um `ObligationType` com `organizationId = org do actor`. Erro 409 se já existe (`code`,
`organizationId`) — mesma constraint que já existe no schema. `code` normalizado antes de gravar:
maiúsculas, espaços viram hífen, qualquer caractere fora de `[A-Z0-9-]` é removido (ex.: "Recibo
RH" → "RECIBO-RH") — mesmo princípio dos `code`s globais existentes (`IRPJ`, `DAS`, `PGDAS-D`).

## Telas

### Lista de modelos (`/app/settings/document-models`)

Lista de cards (não tabela — mesmo padrão visual mais enxuto já usado em listas simples do
projeto): nome, obrigação, se é global (badge "AutoHubs", somente leitura) ou da org
(editável/arquivável), versão. Sem coluna de data de criação — a versão já sinaliza
atividade/recência o suficiente pro v1, e o card não tem uma linha de metadados secundários
reservada pra isso. Botão "Novo modelo" leva pra tela de modelagem.
Link a partir do Settings Hub, junto dos outros cadastros de admin (Departamentos, Templates,
OS Templates).

### Modelagem (`/app/settings/document-models/new` e `/app/settings/document-models/:id/edit`)

1. Upload do PDF de amostra (se for edição de um modelo existente, pula direto pra reconstrução
   usando um PDF novo que o admin sobe pra reconferir — v1 não guarda o PDF original usado da
   primeira vez, então editar sempre pede um PDF de amostra de novo).
2. Página reconstruída: cada item de texto extraído vira um elemento clicável posicionado em
   `absolute` dentro de um container relativo (mesma técnica da POC), com paginação se o PDF tiver
   mais de 1 página.
3. Barra lateral/painel com:
   - Campo nome do modelo
   - Seletor de obrigação (lista `GET /document-reader/obrigacoes`, com opção "+ Nova obrigação"
     que abre um campo inline só de nome — o `code` é derivado automaticamente de `name` via
     `normalizarCodigo`, mesmo princípio dos codes globais já existentes; não há campo de código
     separado pro admin preencher)
   - Lista de âncoras marcadas (toggle "Marcar âncoras" — enquanto ativo, clicar num item adiciona/
     remove da lista de âncoras)
   - Lista de campos padrão sugeridos como atalho (CNPJ, Competência, Vencimento, Valor) — clicar
     num botão "Adicionar campo X" entra em modo "aguardando clique" pra esse campo; clicar no
     texto certo na página preenche a zona com a posição/tamanho do item clicado
   - Campos extras: botão "+ Campo customizado" pra nomear e tipar um campo fora dos 4 padrão
4. Botão "Salvar" (desabilitado até nome + obrigação + 1 âncora + cnpj + competência estarem
   preenchidos) — chama POST ou PATCH e volta pra lista com toast de sucesso.

Visual: usa os componentes existentes (`Button`, `Input`, `Label`, selects nativos já usados em
`RecurringTemplateForm.tsx`/`Clients.tsx`) — não copia o CSS cru da POC.

## Regras de negócio que não podem se perder

- Um modelo global (`organizationId: null`) nunca é editável nem arquivável por nenhuma org —
  só existe via seed/script, igual já era no Plano A.
- Um modelo privado nunca é visível pra outra organização (`carregarModelosDaOrg` do Plano A já
  garante isso na leitura; os novos endpoints de escrita precisam garantir o mesmo na escrita —
  `PATCH`/`DELETE` verificam `organizationId` antes de qualquer mutação, 404 se não bater).
- `ObligationType` criado por um `ORG_ADMIN` nasce privado (`organizationId` da org) — nunca pode
  virar global por essa rota.

## Fora de escopo (v1)

- Sugestão automática de âncoras (cruzar com documentos já recebidos pra achar texto realmente
  fixo) — recurso da POC, fica pra uma iteração futura.
- Teste ao vivo do rascunho antes de salvar — idem.
- Análise de impacto contra documentos já recebidos (quantos mudariam de modelo/entrariam em
  conflito) — idem.
- Clonar um modelo global como ponto de partida — v1 sempre começa do zero.
- Histórico/diff de versões anteriores — `version` incrementa mas não há tela pra ver a versão
  anterior (a POC guarda em `_historico/`, arquivo; aqui ficaria pra uma tabela de histórico
  futura, se precisar).
- OCR para documentos sem camada de texto (`temTexto: false`) — já era fora de escopo no Plano A.

## Testes

Segue a mesma disciplina do Plano A: TDD, testes de serviço cobrindo isolamento multi-tenant
(modelo de outra org nunca editável/visível), validação de modelo (campos obrigatórios faltando),
e os happy paths de cada endpoint. UI sem teste automatizado por padrão (convenção do projeto) —
QA manual em navegador antes de fechar, como foi feito no Plano A.
