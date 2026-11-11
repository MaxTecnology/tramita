# Cobertura de departamentos por cliente — Design

**Data:** 2026-11-11
**Status:** revisado com o Max em 2026-11-11 (4 partes), pronto para o plano

## Intenção

Hoje uma tarefa de cliente pode ficar **invisível para o cliente sem ninguém
perceber**. O cadastro de cliente exige "pelo menos um usuário do portal",
mas cada usuário tem acesso só a alguns departamentos. Se a ACME tem usuário
só no Fiscal e o escritório cria uma tarefa da Folha para ela:

- no portal, ninguém da ACME vê a tarefa (o portal filtra por departamento);
- o e-mail de notificação não vai para ninguém, sem nenhum aviso
  (`notification.worker.ts`, busca de `clientUser` por `accesses.departmentId`);
- só o WhatsApp chega, porque vai para o número da empresa.

A regra "pelo menos um usuário" existe para o escritório não esquecer de dar
acesso ao cliente — mas não cumpre esse papel por departamento. Além disso,
nem todo departamento atende todo cliente (cliente sem funcionário não usa
Folha), então a regra certa não é "todo departamento precisa de usuário", e
sim "todo departamento **que atende o cliente** precisa de usuário".

O sistema ainda não tem cliente real em produção, então a regra vale para
todos os registros, sem caso especial para dado antigo (ver memória
`feedback_pre_production_no_legacy`).

## Conceito central

**Departamento atendido** = um departamento do escritório que presta serviço
a um cliente. Ele é representado pelo `ClientAssignment` que já existe
(`clientId` + `departmentId` + `userId`, único por cliente+departamento):

> Existe `ClientAssignment(cliente, departamento)` ⇔ o departamento atende o
> cliente, e `userId` é o responsável do escritório por ele.

Não há tabela nova. O que muda é que o `ClientAssignment` deixa de ser
"responsável opcional" e passa a definir quais departamentos atendem o
cliente.

## Invariantes (garantidas no backend, não só na tela)

Para todo cliente ativo:

1. **I1 — Pelo menos um departamento atendido.**
2. **I2 — Todo departamento atendido tem responsável do escritório** (é
   garantido pela própria estrutura do `ClientAssignment`; o responsável
   precisa ser usuário ativo da mesma organização, com papel
   `ORG_ADMIN`, `ORG_MANAGER` ou `ORG_MEMBER`).
3. **I3 — Acesso só a departamento atendido.** Todo `ClientUserAccess`
   (cliente, departamento) aponta para um departamento atendido pelo cliente.
4. **I4 — Cobertura.** Todo departamento atendido tem pelo menos um usuário
   do cliente **ativo** com acesso a ele.
5. **I5 — Tarefa só em departamento atendido.** Toda tarefa de um cliente
   está num departamento que atende esse cliente.
6. **I6 — Solicitação só em departamento acessível.** Toda solicitação tem
   departamento, e ele é um dos departamentos aos quais o usuário do cliente
   que abriu tem acesso (logo, atendido — por I3).

## Pontos de entrada que precisam respeitar as invariantes

| Ponto | Invariantes | Comportamento |
|---|---|---|
| Criar cliente (`POST /clients`) | I1–I4 | Recebe departamentos atendidos + responsáveis + usuários com acesso, grava tudo numa transação; recusa com 400/404 se violar. |
| Editar cliente (`PATCH /clients/:id`) | I1–I4, I5 | Mesmo contrato da criação: `departments` e `clientUsers` são **obrigatórios e enviados juntos** (substituição completa do conjunto; o formulário em abas é o único chamador). Desmarcar um departamento é recusado (409) se o cliente tiver tarefa **aberta** (status ≠ `DONE`/`DISREGARDED`), vínculo de tarefa recorrente cujo template seja desse departamento, ou solicitação `PENDING`/`NEEDS_INFO` nesse departamento. Ao desmarcar com sucesso, os acessos dos usuários do cliente a esse departamento são removidos na mesma transação. |
| `PUT /clients/:id/assignments` | — | **Removido.** Trocar responsável isoladamente passa a ser feito pelo `PATCH /clients/:id`. `GET /clients/:id/assignments` continua. |
| Usuários de Cliente — editar (`PATCH /client-users/:id`) | I3, I4 | Recusa acesso a departamento não atendido (400). Recusa remover acesso ou desativar (`isActive: false`) se isso deixar algum departamento atendido de algum cliente sem usuário ativo (409, mensagem citando cliente e departamento). |
| Usuários de Cliente — criar (`POST /client-users`) | I3 | Recusa acesso a departamento não atendido. |
| Usuários de Cliente — desativar (`DELETE /client-users/:id`) | I4 | Mesma checagem de "último usuário" do editar. |
| Usuários do escritório — desativar (`DELETE /users/:id`) | I2 | Recusa (409) se o usuário for responsável por algum (cliente, departamento), listando quantos e apontando para a tela **Transferir responsabilidades** (abaixo). |
| Criar tarefa (`createTask`) | I5 | Recusa (400) se o departamento não atende o cliente do board. |
| Editar tarefa (`updateTask`, troca de `departmentId`) | I5 | Mesma recusa. |
| Mover tarefa (`moveTask`) | I5 + isolamento entre clientes | Hoje só confere se a coluna de destino é da organização — dá pra mover tarefa para o board de **outro cliente** (vazamento de dado entre clientes). Passa a aceitar só coluna do **mesmo board** (400 caso contrário). |
| Vincular cliente a template recorrente (`createAssignment`) | I5 | Recusa (400) se o departamento do template não atende o cliente. |
| Trocar departamento do template recorrente (`updateTemplate`) | I5 | Recusa (409) se algum cliente vinculado não for atendido pelo novo departamento, listando quantos. |
| Geração de tarefa recorrente (`generateTaskForAssignment`) | I5 | Defesa em profundidade: se o departamento não atende mais o cliente, não cria a tarefa e registra `FAILED` com mensagem acionável (ver "Falhas de geração visíveis"). |
| Portal — departamentos (`GET /portal/departments?clientId=`) | I6 | `clientId` obrigatório na query (mesmo padrão de `GET /portal/requests`; 400 sem ele, 404 se o usuário não tem acesso à empresa). Devolve só os departamentos aos quais o usuário logado tem acesso nesse cliente (hoje devolve todos os da organização). |
| Abrir solicitação (`createRequest`) | I6 | `departmentId` passa a ser obrigatório e precisa ser um departamento acessível ao usuário naquele cliente (403/400 caso contrário). |
| Aprovar solicitação (`approveRequest`) | I5 | Usa o departamento da solicitação; revalida I5 (se o departamento deixou de atender o cliente desde a abertura, recusa com 409). `defaultDepartmentForOrg` deixa de existir. |

## Notificações ao cliente: destinatário por departamento

**Problema atual:** o e-mail já respeita departamento para eventos de
tarefa, mas o **WhatsApp vai sempre para `client.whatsapp`** (número da
empresa), qualquer que seja o assunto — um documento da Folha chega no
WhatsApp de quem cuida do Fiscal. E os eventos de **solicitação** por e-mail
vão para todos os usuários do cliente, sem filtrar departamento.

**Regra nova (os dois canais):** destinatários = usuários do cliente
**ativos** com acesso ao departamento do assunto — `task.departmentId` em
eventos de tarefa, `request.departmentId` em eventos de solicitação (agora
sempre presente, por I6).

- **E-mail:** um envio por destinatário (como já é hoje para tarefa).
- **WhatsApp:** um envio por destinatário **que tenha telefone cadastrado**
  (`ClientUser.phone`), um `NotificationLog` por envio. O remetente continua
  sendo o número do escritório (`NotificationConfig.maximizebotToken`).
- **`client.whatsapp` deixa de ser destino de notificação.** Continua no
  cadastro como contato da empresa. Não há fallback para ele (reabriria o
  vazamento entre departamentos).
- Tarefa com `visibleToClient = false` continua sem notificar o cliente por
  nenhum canal.
- **Telefone do usuário do cliente é opcional** (decisão do Max). Se nenhum
  usuário de um departamento atendido tiver telefone, os assuntos desse
  departamento chegam só por e-mail e portal; o painel de cobertura da tela
  mostra isso como **aviso amarelo** (não bloqueia salvar).
- O telefone é normalizado para dígitos com DDI 55 ao salvar (formato que o
  MaximizeBot espera).

## Transferir responsabilidades

Tela acessada por um botão na linha do colaborador em **Administração ›
Usuários**. Uma pessoa pode "ser dona" de três coisas, e a tela move as três:

1. responsável por (cliente, departamento) — `ClientAssignment.userId`;
2. responsável por processo/OS — `Board.responsibleUserId`;
3. tarefas **abertas** atribuídas — `Task.assigneeId` (status ≠
   `DONE`/`DISREGARDED`).

**Fluxo:**
- Mostra a carteira da pessoa **agrupada por cliente**: departamentos em que
  é responsável, nº de processos ativos em que é responsável, nº de tarefas
  abertas atribuídas a ela nesse cliente.
- Busca por cliente e **filtro por departamento**. Com filtro ativo, a
  transferência afeta só as responsabilidades e tarefas daquele
  departamento (permite "Fiscal da ACME pro João, Folha da ACME pra Maria").
  Processos (`Board`) não têm departamento: só são transferidos quando o
  filtro é "Todos".
- Seleciona clientes (individual ou "selecionar todos" dos filtrados),
  escolhe o colaborador de destino (ativo, mesma organização, papel
  `ORG_ADMIN`/`ORG_MANAGER`/`ORG_MEMBER`, diferente da origem) e
  **Transferir**. "Incluir processos" e "Incluir tarefas abertas" vêm
  marcados por padrão.
- Executa numa transação. Tarefas transferidas recebem `TaskHistory`
  `assigned_to` (mesmo registro de quando se edita o responsável da
  tarefa).
- A lista **encolhe** a cada transferência; dá para repartir a carteira
  entre várias pessoas em sequência. Quando zera, a tela mostra o botão
  **Desativar colaborador**.
- Restrita a `ORG_ADMIN`.

**API:** `GET /users/:id/portfolio?departmentId=` (carteira agrupada por
cliente) e `POST /users/:id/transfer` com `{ toUserId, clientIds,
departmentId?, includeBoards, includeTasks }`. Recusa: destino inválido/
inativo/de outra org (404/400), origem = destino (400), cliente que não
pertence à carteira da origem (400).

## Falhas de geração de recorrentes visíveis (decisão do Max, 2026-11-11)

Hoje uma falha de geração só aparece no console de geração (Configurações)
e num badge do menu, visível só ao `ORG_ADMIN`. Fácil de passar batido —
e uma tarefa recorrente que não nasce é uma obrigação do cliente que ninguém
vai fazer. Passa a ser explícita em dois lugares, para **qualquer** falha de
geração (não só a de departamento), usando a mesma lista de
`getFailedGenerations`:

1. **Alerta no topo do Dashboard** para `ORG_ADMIN` e `ORG_MANAGER`:
   "N tarefas recorrentes não foram geradas". Cada linha: template, cliente,
   competência e o **motivo em linguagem de ação** — ex.: "O departamento
   Folha não atende mais o cliente ACME. Marque o departamento no cadastro
   do cliente ou remova o vínculo do template." Link direto para onde se
   corrige (cadastro do cliente ou template) e botão **Gerar novamente**
   (reaproveita a geração manual existente). O alerta some quando não há
   falha pendente. O endpoint de falhas passa a aceitar `ORG_MANAGER` além
   de `ORG_ADMIN`.
2. **Resumo diário** (digest de SLA das 8h, `sla-digest.cron.ts`): nova
   seção "Tarefas recorrentes não geradas" com as mesmas linhas, para quem
   recebe o digest.

As mensagens de `FAILED` gravadas pelo motor passam a ser escritas para o
usuário final (o que aconteceu + o que fazer), não mensagens técnicas.

## Simplificações que a regra permite

- **Fallback "sem responsável → notifica todos os admins e gerentes"**: em
  `createRequest`, `comments.service` e `request-comments.service`, quando o
  evento é de um cliente num departamento, sempre há responsável (I2 + I5/I6).
  O fallback é removido nesses caminhos e a notificação vai para o
  responsável do `ClientAssignment`.
- **`defaultDepartmentForOrg`** (cria departamento "Geral" automaticamente)
  é removido — só existia para solicitação sem departamento, que deixa de
  existir.
- **`Request.departmentId`** passa a `NOT NULL` (migration). O banco local
  pode ser zerado antes, se preciso.

## Tela: cadastro de cliente em abas

Vale para criar e editar. O botão **Salvar** só habilita quando as três abas
estão completas; a aba incompleta mostra um indicador vermelho.

1. **Empresa** — campos atuais (CNPJ com consulta, nome, contatos,
   endereço). Completa quando os obrigatórios estão preenchidos (ver
   "Dados obrigatórios do cliente" abaixo).
2. **Departamentos** — lista dos departamentos da organização. Para cada um
   marcado como atendido, um seletor obrigatório de responsável do escritório.
   Completa quando há ≥1 marcado e todos têm responsável. Substitui a seção
   "Responsáveis por departamento" atual.
3. **Acesso ao portal** — usuários do cliente (buscar existente / criar
   novo). Os chips de departamento por usuário mostram **só** os marcados na
   aba 2, e um usuário recém-adicionado já vem com **todos** os
   departamentos atendidos marcados (caso comum: cliente com um contato só);
   restringir é desmarcar. Abaixo, um painel de cobertura: uma linha por departamento atendido
   com os usuários que têm acesso; linha sem usuário em vermelho (bloqueia);
   linha em que nenhum usuário tem telefone em amarelo (só aviso: os
   assuntos desse departamento não chegam por WhatsApp). Completa quando
   todos os departamentos atendidos têm ≥1 usuário. Cada usuário tem campo
   de telefone (WhatsApp) opcional.

Desmarcar um departamento na aba 2 remove os chips dele na aba 3. Se a API
recusar o desmarque (tarefa aberta/recorrente), a mensagem aparece como erro
do salvar.

A tela **Configurações › Usuários de Cliente** continua existindo; os
seletores de departamento de cada acesso passam a oferecer só os
departamentos atendidos do cliente escolhido.

Uma futura aba **Tarefas** (vincular tarefas recorrentes no próprio cadastro)
foi mencionada pelo Max como próximo passo — fora desta entrega, mas o
formulário em abas deve aceitar uma quarta aba sem reestruturação.

### Dados obrigatórios do cliente (decisão do Max, 2026-11-11)

Validados na tela **e** no backend (Zod + service), no criar e no editar:

| Campo | PJ | PF | Regra |
|---|---|---|---|
| Tipo (`clientType`) | obrigatório | obrigatório | |
| Código (`codigo`) | obrigatório | obrigatório | É o número do cliente no ERP contábil do escritório, que o sistema vai usar. Texto sem espaços nas pontas; único entre clientes **ativos** da organização. |
| Nome / razão social | obrigatório | obrigatório | Na PJ a consulta de CNPJ já preenche. |
| CNPJ | obrigatório | — | Dígito verificador válido; gravado **só com dígitos**; único entre clientes ativos da org. |
| CPF | — | obrigatório | Dígito verificador válido; gravado só com dígitos; único entre clientes ativos da org. |
| Endereço completo (CEP, estado, cidade, bairro, logradouro, número) | obrigatório | opcional | Complemento sempre opcional. Na PJ a consulta de CNPJ preenche; se a consulta falhar, digita. |
| Telefone/WhatsApp da empresa, inscrição estadual, CEI, CAEPF, observações | opcional | opcional | `whatsapp` da empresa é só contato (não recebe notificação). |

- `cnpjValido`/`cpfValido` saem de `document-reader/engine/validadores.ts`
  para uma lib compartilhada (`src/lib/documento.ts`), usada pelo cadastro
  e pelo motor de leitura.
- Unicidade de CNPJ, CPF e código **entre clientes ativos**: índices únicos
  parciais (`WHERE "isActive"`) escritos à mão na migration, como o de
  obrigações globais; o `@@unique([codigo, organizationId])` atual é
  substituído pelo parcial. Cliente desativado não trava recadastro.
  Violação vira 409 com mensagem clara (não 500).
- Com o CNPJ/CPF gravado só em dígitos, o casamento do robô de leitura não
  precisa mais compensar máscara (simplificação opcional, a critério do
  plano).

## Erros (mensagens ao usuário, pt-BR)

- Departamento atendido sem usuário: "O departamento {nome} precisa de pelo
  menos um usuário do cliente com acesso."
- Acesso a departamento não atendido: "O departamento {nome} não atende este
  cliente."
- Desmarcar com pendências: "Não é possível remover o departamento {nome}:
  há {n} tarefa(s) aberta(s), {m} tarefa(s) recorrente(s) e {k}
  solicitação(ões) pendente(s) deste cliente nele." (só cita os itens com
  contagem > 0)
- Último usuário: "{usuário} é o único com acesso ao departamento {depto} do
  cliente {cliente}. Adicione outro usuário antes."
- Responsável inativo/desativação de responsável: "{usuário} é responsável
  por {n} cliente(s)/departamento(s). Defina outro responsável antes de
  desativar."
- Tarefa em departamento não atendido: "O departamento {nome} não atende o
  cliente {cliente}."

## Testes

- **Backend (TDD, obrigatório):** um teste de recusa e um de sucesso para
  cada linha da tabela de pontos de entrada; transação do criar/editar
  cliente (falha em I4 não deixa cliente/usuário/acesso pela metade);
  geração recorrente registrando `FAILED`; portal listando só departamentos
  acessíveis; isolamento por organização em todos (departamento/responsável
  de outra org → 404).
- **Frontend:** a lógica de "aba completa" e de cobertura extraída em função
  pura com testes unitários.
- **Manual:** conferência no navegador e validação do Max na próxima rodada
  de testes.

## Fora do escopo

- Solicitações internas / departamento interno (projeto seguinte; um
  departamento interno será um departamento que não aparece na aba
  Departamentos do cliente — a decidir lá).
- Convite por e-mail para o usuário do cliente definir a própria senha.
- Aba "Tarefas" no cadastro do cliente.

## Decisões tomadas por mim (Claude), para revisão

1. "Atendido" é representado pelo `ClientAssignment` existente, sem tabela
   nova.
2. Tarefa "aberta" para bloquear desmarque = status diferente de `DONE` e
   `DISREGARDED`. Tarefas concluídas/desconsideradas não bloqueiam e
   continuam no histórico no departamento antigo.
3. Desativar usuário do escritório que é responsável é **bloqueado** (não
   reatribuído automaticamente).
4. Geração recorrente que encontra departamento não atendido registra
   `FAILED` em vez de criar a tarefa — e a falha aparece no Dashboard e no
   resumo diário (ajustado pelo Max, ver "Falhas de geração visíveis").
5. `PUT /clients/:id/assignments` é removido em vez de mantido com
   validação extra, para haver um único caminho de escrita.
6. Os fallbacks de notificação "sem responsável → admins/gerentes" são
   removidos nos caminhos de cliente. Quem é notificado **não muda** em
   nenhum outro aspecto: onde hoje vai para os responsáveis do
   `ClientAssignment` do departamento da tarefa (comentário de tarefa) ou da
   solicitação (nova solicitação, comentário de solicitação), continua indo —
   só some o ramo "se não houver nenhum". Ninguém é adicionado.
7. Solicitação `PENDING`/`NEEDS_INFO` também bloqueia desmarcar o
   departamento (senão o cliente perderia acesso à própria solicitação e a
   aprovação falharia depois).
8. As checagens de "último usuário" (I4) e de "é responsável" (I2) só
   consideram **clientes ativos**. Desativar um cliente continua permitido
   como hoje (soft-delete), com ou sem tarefas abertas.
9. Desativação de usuário do escritório só existe via `DELETE /users/:id`
   (o `PATCH` não aceita `isActive`, e as funções aceitas — `ORG_MANAGER`,
   `ORG_MEMBER` — são todas válidas como responsável), então a checagem de
   I2 fica só nesse caminho.

10. Todo departamento atendido exige usuário do portal **mesmo para cliente
    que só usa WhatsApp** (decisão do Max, 2026-11-11): o portal é o
    registro do que foi entregue (protocolo com IP/visualização) e as
    mensagens de WhatsApp já levam o link do portal.

## Interações com projetos seguintes

- **Solicitações internas:** I5 impede, por ora, tarefa de departamento não
  atendido dentro de board de cliente — inclusive tarefa só interna. É o
  caso que o projeto de solicitações internas vai resolver; não abrir
  exceção aqui.

## Ambientes e migração

Não há dado a preservar em nenhum ambiente (confirmado pelo Max em
2026-11-11: nem local nem online têm cliente real). A migration de
`Request.departmentId NOT NULL` não faz backfill. Clientes que existam hoje
sem departamentos atendidos não precisam de script: ao editá-los, o
formulário em abas exige completar tudo. Antes do deploy online, conferir se
há `requests` com `departmentId` nulo; se houver, zerar esses dados **com
confirmação do Max** (banco online é infraestrutura compartilhada).
