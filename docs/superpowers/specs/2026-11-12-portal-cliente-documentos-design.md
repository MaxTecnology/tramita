# Novo portal do cliente centrado em documentos (Fase A) — design

Data: 2026-11-12 · Status: aguardando aprovação do Max

## 1. Intenção e porquê

Nos testes manuais de 2026-11-11/12, a tela "Minhas Tarefas" do portal mostrou as tarefas de
processos (OS) misturadas às recorrentes. Num cliente atendido por todos os departamentos isso dá
~30 itens por mês, e o cliente se perde. A maior parte dessas tarefas é trabalho interno do
escritório, que não interessa ao cliente.

O Nibo, produto de referência, resolve isso com um portal **centrado em documentos e não em tarefas**.
O cliente vê o que **recebeu** (guias, declarações), o que **precisa enviar** (extratos, notas) e o
**arquivo** da empresa. O Max validou esse modelo pelas telas do portal do Nibo e decidiu seguir a
mesma linha, mantendo **Processos (OS)** como diferencial do Tramita, já que o Nibo não mostra
processos ao cliente.

Sucesso: o cliente abre o portal e entende em segundos o que precisa pagar, o que precisa enviar e
em que pé estão os processos dele. O escritório enxerga quais guias ainda não foram pagas e alerta
o cliente antes que os juros cresçam.

## 2. Objetivos

1. Portal do cliente reorganizado em: **Início**, **Documentos recebidos**, **Enviar documentos**,
   **Processos** e **Solicitações** (esta última sem mudança).
2. **Marcar como pago**: o cliente marca uma guia de pagamento como paga, informando o valor e,
   opcionalmente, anexando o comprovante.
3. O escritório vê as **guias não pagas**: indicador no Dashboard e lista filtrável.
4. A **entrega concluída** de uma tarefa visível ao cliente vira **protocolo automaticamente** e
   aparece em "Documentos recebidos".
5. As entregas de template recorrente ganham a marca **"Exige pagamento"**.

## 3. Não-objetivos (fora da Fase A)

- **Arquivo permanente** (contrato social, sócios, certificado digital, procurações, certidões, com
  alerta de vencimento): Fase B, spec própria.
- **Robô de leitura** extraindo valor e vencimento do PDF da guia: melhoria futura. Na Fase A o
  valor é digitado pelo escritório.
- **Cobrança automática** de guia não paga (WhatsApp/e-mail de lembrete) ao escritório ou ao cliente:
  decidido **não** ter. A informação fica visível; ninguém é lembrado ativamente. (O aviso de
  documento novo continua — ver 7.3.1.)
- O escritório marcar pagamento em nome do cliente: decidido que **só o cliente marca**.
- Mudança na tela de Solicitações do portal.
- Mudanças no lado do escritório além das listadas aqui (Kanban, tela Tarefas etc.).

## 4. Anti-objetivos (seria falha mesmo funcionando)

- O cliente voltar a ver a lista bruta de tarefas internas do escritório.
- Uma guia de pagamento chegar ao cliente **sem valor**, ou um extrato/declaração aparecer como
  "a pagar".
- Um usuário do cliente ver documento ou pedido de departamento ao qual não tem acesso (regra I3/I4
  da cobertura de departamentos continua valendo em todas as telas novas).
- Duplicar o mesmo arquivo como dois documentos recebidos (entrega + protocolo manual do mesmo anexo).

## 5. Restrições

- Stack e convenções do repositório (CLAUDE.md): Fastify v5 + Prisma v6 + Zod em todas as entradas;
  React 19 + Tailwind v4 + shadcn/ui; textos ao usuário em pt-BR, código em inglês.
- Schema só via migration versionada (`pnpm --filter api migrate:dev`; nunca `prisma migrate` direto).
- Pré-produção, sem cliente real: pode mudar o modelo sem compatibilidade; o banco pode ser zerado.
- Modo escuro: usar tokens do tema (`bg-surface`, `text-foreground`, `bg-*-500/10`), nunca cor clara
  fixa. QA visual com screenshot real nos dois temas.
- Isolamento de tenant por `organizationId` em todas as queries; escopo de acesso do usuário do
  cliente via `getClientAccessScope` / `canSeeTask` (já existentes).

## 6. O que já existe e é reaproveitado

| Conceito | Modelo atual | Uso na Fase A |
|---|---|---|
| Documento enviado ao cliente | `Protocol` (número `AAAA-NNNNNN`, título, `dueDate`, `attachmentId`, `status` SENT/VIEWED/DOWNLOADED/EXPIRED, `ProtocolEvent`) | Vira o **"documento recebido"**. Ganha campos de competência, valor, pagamento. |
| Arquivo que o escritório entrega na tarefa | `TaskDeliverable` (checklist, `attachmentId`, `deliveredAt`) | Ao ser entregue numa tarefa `visibleToClient`, **gera protocolo**. |
| Entregas padrão do template recorrente | `RecurringTaskTemplateDocument` (via `deliveryTemplateId`) | Ganha `requiresPayment`. |
| Documento pedido ao cliente | `TaskDocumentRequirement` (PENDING/UPLOADED/APPROVED/REJECTED) | Base da tela **Enviar documentos**. Ganha status "Nada a enviar". |
| Escopo de acesso do usuário do cliente | `getClientAccessScope`, `canSeeTask(scope, clientId, departmentId)` | Filtra todas as telas novas. |

## 7. Decisões (tomadas com o Max)

### 7.1 Documentos recebidos = protocolos

- **Todo** documento que o cliente recebe é um `Protocol`. Para o cliente há um conceito só.
- **Entrega gera protocolo automaticamente**: quando o colaborador conclui uma entrega
  (`deliverDocument`) numa tarefa com `visibleToClient = true`, o sistema cria o protocolo com:
  título = nome da entrega; anexo = o arquivo entregue; vencimento = `task.dueDate`;
  competência = `task.competence`; `requiresPayment` e valor vindos da entrega (ver 7.3).
  Em tarefa não visível ao cliente, a entrega **não** gera protocolo.
- O **protocolo manual** (aba Protocolos da tarefa) continua existindo para envios avulsos e passa a
  aceitar os mesmos campos novos (competência, exige pagamento, valor).
- Reentregar (substituir o arquivo de uma entrega já concluída) **não** cria um segundo protocolo:
  atualiza o anexo do protocolo existente e registra um evento. Isso é decisão do builder quanto ao
  mecanismo, mas a regra "um protocolo por entrega" é fixa.

### 7.2 Marcar como pago

- Só o **cliente** marca. Ação disponível apenas em protocolo com `requiresPayment = true`.
- Modal "Marcar como pago": **Valor** (pré-preenchido com o valor informado pelo escritório, editável
  pelo cliente) + **Anexar comprovante (opcional)**. Botões Cancelar / Marcar como pago.
- Registra: data/hora, valor pago, usuário do cliente que marcou, comprovante (anexo opcional).
  Aparece no histórico do protocolo (novo tipo de evento `PAID`).
- Desmarcar: o cliente pode desfazer (marcou por engano), com registro no histórico (`UNPAID`).
  *(Decisão minha, não discutida explicitamente; pode ser revista.)*
- Pagamento é **independente** do status de visualização (VIEWED/DOWNLOADED continua igual).
- Qualquer usuário do cliente com acesso ao departamento do documento pode marcar/desmarcar; **todos**
  veem quem marcou e quando (histórico) — o dono da empresa confere o que o financeiro fez.

### 7.3 Valor e "exige pagamento"

- `RecurringTaskTemplateDocument` (entregas) ganha `requiresPayment` (padrão `false`). Na tela do
  template, cada entrega tem a marca **"Exige pagamento"** (guia: sim; extrato/declaração: não).
- `TaskDeliverable` herda `requiresPayment` do template na geração da recorrente. Em entrega criada à
  mão numa tarefa, o colaborador marca na hora.
- O **valor é informado pelo escritório** ao entregar uma entrega que exige pagamento: campo
  **obrigatório** no upload dessa entrega. Sem valor, a entrega não é concluída (erro claro). Entregas
  que não exigem pagamento não pedem valor.
- Valor em reais com 2 casas (armazenar como decimal, nunca float).

### 7.3.1 Aviso ao cliente (decidido com o Max)

- **Todo protocolo** — automático (entrega) ou manual — continua disparando o aviso `PROTOCOL_CREATED`
  ao cliente (WhatsApp/e-mail, conforme a configuração e os destinatários por departamento que já
  existem). Motivo do Max: impostos raramente se acumulam no mesmo dia pra um cliente.
- Para guia que exige pagamento, a mensagem inclui **valor e vencimento** (novas variáveis de
  template, ex.: `{{amount}}`, `{{paymentDueDate}}`), e o link leva ao documento no portal.

### 7.4 Visão do escritório (sem notificação)

- **Dashboard**: indicador **"Guias não pagas"** com quantidade e **valor total**, destacando as
  **vencidas** (quantidade e total). Clicar leva à lista.
- **Lista de guias não pagas** (tela nova no escritório, ou filtro na tela de Protocolos existente;
  escolha do builder): só protocolos `requiresPayment = true` e não pagos; ordenada por vencimento
  (vencidas e que vencem hoje no topo), com **valor em destaque**; filtros por cliente, competência,
  departamento e situação (vencida / a vencer / paga).
- Visibilidade no escritório segue a regra já existente: ORG_MEMBER vê só o que é de clientes/
  processos visíveis a ele (`memberBoardWhere`); admin/gerente veem tudo.
- Nenhum lembrete de guia não paga.

### 7.5 Enviar documentos

- Tela por **mês** (competência da tarefa) com os pedidos (`TaskDocumentRequirement`) das tarefas
  **recorrentes** do cliente, visíveis ao usuário (escopo de departamento).
- Cada pedido com cor: **vermelho** = pendente, **amarelo** = enviado aguardando conferência,
  **verde** = aprovado ou "nada a enviar". Recusado volta a vermelho mostrando o motivo.
- Ações do cliente: anexar arquivo (fluxo de upload que já existe), **"Nada a enviar"** por pedido
  (novo status, ex.: `NOT_APPLICABLE`, que conta como resolvido para desbloquear a tarefa como o
  APPROVED). *"Nada a enviar" entra direto como resolvido, sem conferência do escritório: decisão
  minha.*
- Pedidos de documento de **processos (OS)** **não** aparecem aqui: ficam dentro do processo.
- Meses sem pendência ficam recolhidos; o mês corrente abre por padrão; seletor de mês.

### 7.6 Processos

- Lista as OS do cliente (boards tipo `OS`), cada uma com etapas (colunas) e progresso.
- Dentro do processo: tarefas visíveis ao cliente e os **pedidos de documento** daquele processo,
  com a mesma ação de envio da 7.5.
- Recorrentes (board de sistema `RECURRING_SYSTEM`) **não** aparecem aqui.

### 7.7 Início

- Cartões com contador, cada um levando à tela correspondente: **Guias a pagar** (não pagas,
  destacando vencidas), **Documentos a enviar** (soma de pedidos pendentes/recusados, recorrentes +
  processos), **Processos em andamento**.
- Bloco **"Vencendo esta semana"**: guias a pagar e pedidos com vencimento nos próximos 7 dias.

### 7.8 O que sai
- A tela **"Protocolos"** atual do portal é absorvida por **"Documentos recebidos"** (mesmos dados,
  agora com competência, valor e pagamento); não ficam duas telas.

- A tela **"Tarefas"** sai da navegação do portal. As recorrentes deixam de aparecer como tarefa
  para o cliente; aparecem só pelo que ele recebe (protocolos) ou precisa enviar (pedidos).
- Manter ou remover `GET /portal/tasks` é decisão do builder, desde que nenhuma tela do portal o use
  para listar recorrentes.

### 7.9 Decisões complementares (revisão do builder; marcadas como decisão minha, revisáveis)

- **Vencimento da guia:** no upload de entrega que exige pagamento, o escritório informa **valor e
  vencimento**; o vencimento vem pré-preenchido com `task.dueDate` (nas recorrentes, `dueDate` já é
  o vencimento legal; a meta interna é `targetDate`). O protocolo guarda o vencimento próprio, e
  "vencida", a ordenação e os totais usam esse campo.
- **Correção depois da entrega:** o escritório pode editar valor e vencimento enquanto a guia não
  estiver paga, com evento no histórico do protocolo (`AMOUNT_CHANGED` ou equivalente). Depois de
  paga, só desfazendo o pagamento (cliente).
- **Valor divergente:** qualquer marcação conta como **paga** (booleano + valor pago registrado). Se
  o valor pago for diferente do valor da guia, a lista do escritório mostra a diferença como
  informação, sem estado "parcial".
- **Expiração e digest de SLA:** guia paga sai da expiração (`EXPIRED`) e do digest; marcar como pago
  também registra visualização se ainda não houver. Protocolos sem exigência de pagamento seguem a
  regra atual.
- **Documento entregue nunca some (decidido com o Max):** protocolo gerado fica no portal mesmo que
  a tarefa depois seja ocultada do cliente — o cliente consulta o histórico e o dono da empresa
  confere o que o financeiro fez. Para retirar um documento enviado por engano, o escritório
  **cancela** o protocolo com motivo: ele continua visível ao cliente com status **"Cancelado pelo
  escritório"** e o motivo, sai de "Guias a pagar" e dos indicadores, e nunca é apagado (novo
  status/evento de cancelamento). Tarefa que passa a ser visível gera os protocolos das entregas já
  concluídas que ainda não têm protocolo.
- **"Nada a enviar" reversível:** o cliente desfaz enquanto a tarefa não estiver concluída; o
  escritório pode **recusar** um "Nada a enviar" como recusa um upload (volta a pendente, com motivo).

## 8. Fica a critério do builder

- Nomes exatos de campos/enums e formato da migration.
- Se a lista de guias não pagas é tela nova ou filtro na tela de Protocolos.
- Layout das telas, respeitando o design system atual do portal e o modo escuro, e funcionando em
  celular (o cliente consulta pelo telefone — mesma exigência de responsividade do portal atual).
- Como agrupar endpoints do portal (novos endpoints agregados vs. reaproveitar os existentes).
- Mecanismo de "reentrega atualiza o protocolo".

## 9. Critérios de aceite

1. Cliente com recorrentes de 3 departamentos não vê nenhuma lista de tarefas no portal; vê Início
   com contadores corretos para os departamentos a que tem acesso.
2. Colaborador entrega "Guia DAS" (exige pagamento) informando R$ 1.234,56 numa recorrente visível →
   aparece em "Documentos recebidos" do cliente com valor, competência e vencimento; sem valor, o
   upload é recusado com mensagem clara.
3. Entrega de extrato (não exige pagamento) aparece em Documentos recebidos **sem** opção "Pago".
4. Cliente marca a guia como paga com comprovante → status "Pago" no portal; some do indicador
   "Guias não pagas" do escritório; histórico do protocolo mostra quem marcou e quando.
5. Guia vencida e não paga aparece no topo da lista do escritório com valor destacado e conta no
   total de vencidas do Dashboard.
6. Usuário do cliente com acesso só à Folha não vê guias/pedidos do Fiscal (em nenhuma tela nova,
   nem por URL direta).
7. "Nada a enviar" num pedido pendente desbloqueia a tarefa como uma aprovação.
8. Tarefa não visível ao cliente: entrega concluída não gera protocolo.
9. Telas novas legíveis em modo claro e escuro (screenshot), inclusive em largura de celular.
10. Escritório cancela um protocolo enviado por engano → cliente continua vendo o documento com
    "Cancelado pelo escritório" e o motivo; ele sai de "Guias a pagar" e dos indicadores.
11. Entrega de guia gera WhatsApp/e-mail ao cliente do departamento com valor e vencimento na mensagem.
