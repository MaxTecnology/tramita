# Conversa e aprovação do cliente nas tarefas recorrentes — design

Data: 2026-11-13. Origem: teste manual do Max no portal novo (Fase A).

## Por quê

O portal centrado em documentos (Fase A) tirou a tela "Tarefas". As tarefas recorrentes ficaram sem
lugar no portal: o escritório comenta numa recorrente, o cliente recebe o aviso por e-mail/WhatsApp, mas
não consegue ver nem responder o comentário. Os processos (OS) não têm o problema — o painel deles
mostra os comentários.

Dois casos reais do Max:

1. **Cobrança de documento:** o cliente vê a pendência e não envia; o colaborador precisa comentar na
   tarefa do mês ("ainda falta o extrato de outubro") e o cliente responder ali.
2. **Aprovação da prévia (Departamento Pessoal):** o colaborador manda a prévia da folha, o cliente
   aprova ou pede ajuste, e só então a folha é fechada com o arquivo definitivo.

## Decisões do Max

- Fazer as duas coisas; a conversa primeiro (corrige uma lacuna do que já está no ar).
- Aprovação: o colaborador **pode fechar sem a aprovação no portal**, mas fica **registrado como foi** —
  aprovação recebida fora da plataforma (ex.: WhatsApp) ou sem resposta do cliente depois de esperar.

## Peça 1 — Conversa da tarefa recorrente no portal

- **"Enviar documentos" passa a agrupar por tarefa** do mês: cabeçalho com o título e o departamento
  ("Folha de outubro — Departamento Pessoal"), os pedidos de documento embaixo (como hoje) e o botão
  **Conversa (N)**.
- Tarefa recorrente visível ao cliente **sem pedido de documento** também aparece no mês (é onde pode
  haver conversa ou aprovação). Sem pedido, sem conversa e sem aprovação, não aparece (não polui).
- **Conversa** abre os comentários da tarefa (os mesmos do escritório, componente `Comments`); o cliente
  lê e responde. Escopo do cliente igual ao de hoje (empresa + departamento; fora → 404).
- **Link do aviso** de comentário (e-mail/WhatsApp ao cliente) abre direto a conversa daquela tarefa:
  `/portal/send?competence=AAAA-MM&task=<id>` para recorrente; `/portal/board/<processo>?task=<id>` para OS.
- **Não lidas:** guardar quando cada usuário do cliente leu a conversa de cada tarefa
  (`TaskReadReceipt (clientUserId, taskId, lastReadAt)`, único por par). Uma conversa está "não lida" se
  há comentário **do escritório** depois do `lastReadAt` desse usuário. Abrir a conversa marca como lida.
- **Início:** cartão novo **"Mensagens do escritório"** com o número de conversas não lidas (só das
  empresas/departamentos que o usuário acessa); clicar leva para "Enviar documentos" no mês da mais
  antiga não lida, com ela aberta.
- O mês no seletor de "Enviar documentos" mostra "N mensagens" além de "N pendentes".

## Peça 2 — Aprovação do cliente

### Modelo

`TaskApproval` — um pedido de aprovação dentro de uma tarefa (pode haver mais de um, ex.: prévia v1
recusada, prévia v2 aprovada):

- `title` (ex.: "Prévia da folha de outubro"), `attachmentId` (o arquivo da prévia), `message` opcional
- `status`: `PENDING` · `APPROVED` · `CHANGES_REQUESTED` · `CLOSED_BY_OFFICE`
- `requestedById`, `requestedAt`
- decisão: `decidedAt`, `decidedByClientUserId` **ou** `decidedByUserId`, `decisionNote`
- fechamento pelo escritório: `closeReason` = `APPROVED_OUTSIDE` (aprovado fora da plataforma) ·
  `NO_RESPONSE` (sem resposta do cliente), `proofAttachmentId` opcional (print do WhatsApp, e-mail)
- `waitedDays` gravado no fechamento (dias entre o pedido e o fechamento) — o que "esperou tempo" quer dizer

Eventos no histórico da tarefa: `approval_requested`, `approval_approved`, `approval_changes_requested`,
`approval_closed_by_office`.

### Escritório

- No painel da tarefa (aba Documentos), **"Pedir aprovação do cliente"**: título, arquivo, mensagem
  opcional. Só em tarefa visível ao cliente. Avisa o cliente (evento novo `APPROVAL_REQUESTED`,
  WhatsApp/e-mail, desligável como os outros).
- Enquanto houver aprovação `PENDING`, a tarefa mostra **"Aguardando aprovação do cliente"** e **não pode
  ser concluída** (409 `Há aprovação do cliente pendente`).
- **"Fechar sem o portal"** numa aprovação pendente: escolher o motivo — *Cliente aprovou fora da
  plataforma* (com observação obrigatória, ex.: "aprovado por WhatsApp em 12/11 às 15h", e anexo opcional
  do print) ou *Sem resposta do cliente* (observação obrigatória). Grava quem, quando, o motivo e quantos
  dias esperou. Só quem pode mexer na tarefa (regra de ver × mexer).
- **Pedido de ajuste** do cliente volta para o colaborador como aviso (evento `APPROVAL_CHANGES_REQUESTED`
  para a equipe) e a tarefa sai de "aguardando"; o colaborador corrige e pede nova aprovação.
- Depois de aprovado (no portal ou fechado pelo escritório), o colaborador entrega o **arquivo definitivo**
  pela entrega normal — ele vai para "Documentos recebidos" como hoje.

### Cliente (portal)

- **Início:** cartão **"Aguardando sua aprovação"** (N) — tem prioridade visual sobre os outros.
- O pedido aparece no grupo da tarefa em "Enviar documentos" com o arquivo, a mensagem e dois botões:
  **Aprovar** · **Pedir ajuste** (comentário obrigatório). Fica registrado quem decidiu e quando (como o
  "marcar como pago").
- Pedido já decidido continua visível com o resultado ("Aprovado por Fulano em 13/11", "Fechado pelo
  escritório: aprovado fora da plataforma — observação").
- Escopo: só quem acessa a empresa e o departamento da tarefa.

### Corridas

Decisão do cliente e fechamento pelo escritório são escritas protegidas (`updateMany` com
`status: PENDING`); quem chega depois recebe 409 com a decisão que venceu.

## Fora do escopo

- Aprovação em processo (OS) — o modelo serve, mas a tela fica para depois se o Max pedir.
- Lembrete automático de aprovação pendente (pode entrar no resumo diário depois).
- Aprovação com várias pessoas do cliente (basta uma).

## Chamadas minhas (o Max confere)

1. Conversa dentro de "Enviar documentos", agrupada por tarefa, em vez de uma aba nova "Conversas".
2. "Não lida" só conta comentário do escritório (não os do próprio cliente).
3. Aprovação é um objeto próprio da tarefa (não um tipo de entrega): a prévia não vai para "Documentos
   recebidos"; o definitivo vai.
4. Pedido de ajuste avisa a equipe com evento novo, desligável.
5. Fechar sem o portal exige observação nos dois motivos; o print é opcional.

## Como validar

- API: escopo do cliente na conversa (404 fora), não lidas por usuário, cartão do Início; aprovação:
  pedir, aprovar, pedir ajuste, fechar sem o portal (motivos, dias esperados, histórico), conclusão
  bloqueada com pendente (409), corrida decisão × fechamento (um 409).
- Web: grupo por tarefa com conversa; link do aviso abre a conversa; botões de aprovação; selo e cartões.
- E2E: escritório pede aprovação → cliente aprova no portal → escritório conclui; e o caminho "fechar sem
  o portal".
- QA visual claro/escuro do portal e do painel da tarefa.
