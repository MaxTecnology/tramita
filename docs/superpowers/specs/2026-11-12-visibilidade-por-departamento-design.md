# Visibilidade por departamento e "Assumir" — design

Data: 2026-11-12. Decisões do Max na conversa de 2026-11-12, depois da auditoria de segurança.

## Por quê

Hoje o Membro vê só a carteira dele (processos em que é responsável, clientes que atende, tarefas
atribuídas), o Gerente vê o escritório inteiro, e a fila do robô e as solicitações não têm escopo
nenhum. Dois problemas:

1. **Vazamento interno:** qualquer colaborador vê a fila do robô e as solicitações de todos os clientes.
2. **Colega ausente:** quando o responsável adoece ou falta, ninguém do mesmo departamento consegue
   ver nem assumir o trabalho dele sem um admin mexer na carteira.

O modelo do Gestta/Nibo resolve os dois: **o colaborador enxerga o departamento dele, mas a tela já
abre filtrada no nome dele**; se precisar cobrir um colega, troca o filtro e **assume** a tarefa.

## Decisões do Max

- Fila do robô: o colaborador vê só o que é dele; o admin vê tudo.
- Solicitações: o colaborador controla só as dele, mas consegue ver as do colega do mesmo departamento
  e assumir.
- Aprovar solicitação de cliente que não é dele: a tarefa criada vai para **quem aprovou**.
- Assumir: **uma tarefa por vez e em lote** (todas as abertas do colega).
- Gerente: vê **tudo dos departamentos a que pertence** (não mais o escritório inteiro).

## Modelo

### Colaborador pertence a departamentos (novo)

`UserDepartment (userId, departmentId)`, N:N, único por par, mesma organização. Marcado no cadastro de
Usuários (Admin edita). Regras:

- `ORG_MANAGER` e `ORG_MEMBER` precisam pertencer a **pelo menos um** departamento (400 ao salvar sem).
- `ORG_ADMIN` não precisa (vê tudo).
- Ser responsável por um cliente num departamento (`ClientAssignment`) exige pertencer a ele — o
  cadastro do cliente e a transferência só oferecem/aceitam responsáveis do departamento (400).
- Migration de backfill: cada `ClientAssignment(userId, departmentId)` existente vira membership.
  Colaborador sem nenhuma responsabilidade fica sem departamento e o admin completa (a tela de Usuários
  marca em vermelho quem está sem departamento).

Por que explícito e não deduzido das responsabilidades: quem acabou de entrar no escritório ainda não é
responsável por nenhum cliente e precisa ver o departamento pra começar a cobrir.

### Escopo do colaborador (substitui o escopo atual do Membro)

Uma regra só, `staffScope(user)`, usada em todos os pontos que hoje usam `memberBoardWhere` /
`memberScope` / `role === 'ORG_MEMBER'`:

| Perfil | Enxerga |
|---|---|
| ORG_ADMIN | organização inteira (sem filtro) |
| ORG_MANAGER | tudo dos clientes atendidos pelos departamentos dele |
| ORG_MEMBER | a carteira dele (regra atual) **+** tudo dos clientes atendidos pelos departamentos dele |

"Tudo dos clientes atendidos pelos departamentos dele", por recurso:

- **Processo (OS):** visível se o cliente é atendido por algum departamento do usuário. O processo não
  tem departamento; visível o processo, todas as tarefas dele aparecem (como hoje).
- **Tarefa recorrente / lista de tarefas:** tarefas cujo `departmentId` está nos departamentos do
  usuário, mais (Membro) as atribuídas a ele.
- **Solicitação** (lista, detalhe, comentários, aprovar/rejeitar/pedir informação/cancelar):
  `departmentId` nos departamentos do usuário.
- **Fila do robô** (fila, rejeitados, visualizar, confirmar, trocar tarefa, rejeitar): documento cuja
  tarefa sugerida tem `departmentId` nos departamentos do usuário. Documento **não identificado** (sem
  tarefa) e o upload: **admin e gerentes** (triagem) — *chamada minha, ver abaixo*.
- **Guias não pagas / protocolos:** pela tarefa do protocolo (departamento).
- **Dashboard:** mesmos filtros.

Fora do escopo → 404 (como hoje), inclusive SSE.

Na prática Membro e Gerente do mesmo departamento **enxergam o mesmo**; a diferença é o **filtro
padrão** e as **ações** que o papel já permite (o gerente continua com o que hoje é `ORG_MANAGER`, como
excluir tarefa e editar processo, agora limitado ao departamento).

### Filtro padrão

Nas listas de Tarefas, Solicitações, fila do robô e Guias não pagas, um seletor:
**Minhas · Meu departamento · Todas** (Todas só para admin). Abre em:

- Membro → **Minhas** (atribuídas a mim; solicitações e documentos dos clientes da minha carteira).
- Gerente → **Meu departamento**.
- Admin → **Todas**.

A escolha fica lembrada no navegador (localStorage, por tela).

### Assumir

- **Uma tarefa:** botão **Assumir** no painel da tarefa quando ela é de outra pessoa, está aberta e é de
  um departamento ao qual eu pertenço. Troca o responsável para mim.
- **Em lote:** na lista de Tarefas com filtro "Meu departamento", filtrar por colaborador → **Assumir
  todas as abertas de Fulano** (com confirmação mostrando a quantidade). Só tarefas abertas dos meus
  departamentos.
- Histórico da tarefa: `assumed` — "Bruna assumiu de Carlos".
- Aviso ao responsável anterior (WhatsApp/e-mail da equipe, evento novo `TASK_ASSUMED`, desligável na
  tela de Notificações como os outros).
- **Não muda a carteira** (`ClientAssignment`): é cobertura de falta. Mudança definitiva continua na
  tela Transferir (admin).
- Escrita protegida: só assume se o responsável ainda for quem a tela mostrou (`updateMany` com o
  `assigneeId` lido); se mudou, 409 "Essa tarefa já foi assumida por outra pessoa".

### Aprovar solicitação

A tarefa criada vai para **quem aprovou**, quando quem aprovou pertence ao departamento da
solicitação. Admin fora do departamento aprovando → responsável do departamento pelo cliente (regra
atual).

## Fora do escopo

- Cadastro de clientes, usuários do cliente, templates e configurações continuam como hoje (cadastro é
  administrativo; o gerente que edita cliente edita qualquer cliente). Se o Max quiser limitar o
  cadastro ao departamento, é outra conversa.
- Ausência formal (marcar "Carlos de férias até X" e redistribuir automaticamente).
- Departamento interno sem cliente (item (b) do roadmap).

## Chamadas minhas (o Max confere)

1. Documento **não identificado** do robô e o **upload** de documentos: admin e todos os gerentes (alguém
   precisa fazer a triagem; o gerente de um departamento pode identificar algo de outro).
2. Membro e Gerente do mesmo departamento enxergam o mesmo conjunto; muda o filtro padrão e as ações.
3. Responsável por cliente precisa pertencer ao departamento (consistência: quem cobre a falta dele
   está no mesmo departamento).
4. Cadastro de clientes fica fora (acima).

## Como validar

- Testes de API por perfil (admin, gerente do Fiscal, membro do Fiscal, membro da Folha) em cada recurso
  da tabela: vê / 404.
- Assumir: uma, em lote, corrida (dois assumindo ao mesmo tempo → um 409), histórico e aviso.
- Aprovar por colega → tarefa com o aprovador; por admin fora do departamento → responsável do cliente.
- E2E: membro abre Tarefas em "Minhas", troca para "Meu departamento", assume a tarefa do colega.
- QA visual nos dois temas das telas com o seletor novo e do cadastro de usuários.
