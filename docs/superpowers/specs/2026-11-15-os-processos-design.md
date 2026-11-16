# Ordens de Serviço e Processos — design

Data: 2026-11-15. Origem: conversa com o Max depois do robô por documento (merge `ed8e9fd`).

## Por quê

Hoje "OS" e "Processo" são a mesma coisa no sistema: um board de um cliente com colunas copiadas do
"Template de OS". Na prática do escritório são duas coisas diferentes:

- **Processo** — trabalho com várias tarefas encadeadas, que precisa ser documentado e acompanhado
  (ex.: abertura de empresa: viabilidade, Junta, inscrição municipal, alvará…).
- **Ordem de Serviço (OS)** — uma tarefa só, igual a uma recorrente, mas esporádica: nasce quando
  alguém pede (ex.: recálculo do DAS de 03/2025 da ACME).

Problemas de hoje: a OS nasce vazia (o template só define colunas, alguém monta as tarefas à mão); o
robô de leitura não reconhece documento de OS (tarefa de OS não tem entrega com robô nem competência);
não há prazo em dias nem registro do motivo de atraso; as telas "Processos" e "Ordens de Serviço"
mostram os mesmos boards de dois jeitos.

O caso que motivou: **10 OS de recálculo abertas → o escritório sobe os 10 PDFs de uma vez → o robô
reconhece cada um → vão para a fila de conferência → o colaborador confirma (em lote) → a OS, se
configurada, conclui sozinha.**

## Decisões do Max

1. **A OS é a peça básica**; o **Processo é montado com OS**. O Modelo de Processo diz quais OS nascem
   dentro dele. A mesma OS pode ser aberta sozinha ou fazer parte de processos.
2. **Caminho A:** o processo continua sendo um **board com colunas** (fases livres, como hoje); as OS
   são os **cartões** e andam pelas colunas. (B — processo como lista ordenada de OS sem colunas — foi
   descartado: reescreveria board, portal e avisos por coluna.)
3. No cadastro da OS marca-se **onde ela é usada**: "Avulsa" e/ou "Dentro de processos". O Modelo de
   Processo só lista as OS marcadas "Dentro de processos"; a solicitação do cliente só lista as
   "Avulsa". Uma OS "só de processo" nunca aparece para o cliente pedir.
4. **Para o cliente é tudo "solicitar um serviço"**: a lista mostra OS avulsas e processos marcados
   como solicitáveis. Pedido de processo, ao ser aprovado, cria o processo com as etapas como hoje.
5. **Tudo neste projeto**, nada para depois: inclui uma OS liberar a próxima e o tempo por etapa.
6. **Prazo em dias** é importante, e atraso precisa de **motivo registrado**.
7. **Dois relógios** (proposta aceita): o **prazo interno** em dias úteis **pausa enquanto espera o
   cliente**; a **data limite** (compromisso externo/legal) é fixa e não pausa.

## Conceitos e telas

### Modelo de OS (tela nova em Configurações)

Mesmo padrão visual do formulário de tarefa recorrente (`RecurringTemplateForm.tsx`), **sem
periodicidade/geração/colaboradores por cliente**:

- nome (vira o título da OS; com competência: "Recálculo DAS — 03/2025"), descrição, departamento,
  prioridade, visível ao cliente;
- **documentos a cobrar do cliente**; **documentos a entregar** com "é guia de pagamento" e o seletor
  🤖 do robô (obrigação), igual à recorrente;
- **pede competência** (sim/não). Regra: modelo com alguma entrega com robô **pede competência**
  (o robô casa por cliente + obrigação + competência);
- **prazo interno**: N dias úteis (opcional);
- **concluir sozinha quando tudo for entregue** (mesma regra da recorrente);
- **onde é usada**: [ ] Avulsa (o escritório abre e o cliente pode solicitar) · [ ] Dentro de
  processos — pelo menos uma marcada;
- ativo/inativo.

### Modelo de Processo (o atual "Template de OS", renomeado)

- colunas como hoje (fase ou status, aviso ao cliente, documentos pedidos por coluna);
- **OS do processo**: lista de Modelos de OS (só os "Dentro de processos"), cada uma com a **coluna
  onde nasce** e **de quais outras OS do processo depende** (zero, uma ou várias);
- **prazo interno do processo**: N dias úteis (opcional);
- **cliente pode solicitar** (sim/não).

### OS aberta = uma tarefa

- Avulsa: fica num **board de sistema de serviços do cliente** (novo tipo, como o de recorrentes),
  com colunas âncora de status. Dentro de processo: cartão no board do processo, na coluna definida.
- Carrega `osModelId`, competência (se o modelo pede), documentos a cobrar e a entregar copiados do
  modelo, prazo interno e data limite.
- Aparece em **Tarefas** com selo "OS" (e o nome do processo, se for de um).
- **Criar OS** (escritório): modelo, cliente, competência (se pede), responsável, data limite
  (opcional). Abrir um **processo** cria o board e as OS dele de uma vez.

### Telas

- **Processos**: só boards de processo (como hoje, com prazo/atraso no cartão).
- **Ordens de Serviço**: passa a ser a **lista de OS** (tarefas com modelo de OS, avulsas e de
  processo) com filtros: cliente, modelo, responsável, departamento, situação (no prazo / vence logo /
  atrasada / pausada aguardando cliente / bloqueada por dependência / concluída), processo. Clique
  abre o drawer da tarefa. Botão "Nova OS". Visível a todo o escritório, com o escopo de tarefa
  (`taskWhere`) já usado em Tarefas.
- **Configurações**: "Modelos de OS" (novo), "Modelos de Processo" (renomeado), "Motivos de atraso",
  "Feriados".

### Portal do cliente

- "Solicitar serviço" lista **Modelos de OS avulsos ativos** e **Modelos de Processo com "cliente pode
  solicitar"**, num único seletor. Se o modelo pede competência, o cliente informa o mês.
- Aprovação: modelo de OS → cria a OS no board de serviços do cliente; modelo de processo → cria o
  processo com as OS. O resto do fluxo de solicitação (aprovar, recusar, pedir informação, comentários)
  não muda.
- O cliente acompanha processo como hoje (etapas/progresso); OS avulsa aparece como hoje aparecem as
  tarefas visíveis dele (documentos a enviar/recebidos).

## Prazo, pausa e atraso

### Dias úteis e feriados

- Dia útil = seg–sex, menos feriados. **Feriados nacionais embutidos** (fixos + Sexta-feira Santa,
  calculada pela Páscoa). O escritório cadastra **feriados extras** (municipais, estaduais, Carnaval,
  Corpus Christi, recessos) em Configurações → Feriados.
- **Regra única de dia útil no sistema (decisão do Max):** os feriados valem também para as
  recorrentes — vencimento e meta com "rolar para dia útil" pulam feriados, não só fim de semana
  (`recurrence-dates.ts` passa a usar o mesmo calendário). Tarefas já geradas não mudam.

### Relógio do prazo interno (OS)

- Começa quando a OS é **liberada**: na criação, ou quando a última OS de que ela depende conclui.
- **Pausa** enquanto houver **documento obrigatório pendente do cliente** ou **aprovação do cliente
  pendente** — a mesma condição que hoje deixa a tarefa bloqueada aguardando o cliente. Não pausa por
  bloqueio manual ou por qualquer outro motivo.
- **Meta** (`targetDate`) = liberação + N dias úteis + dias úteis pausados; é recalculada ao retomar.
  Quem não tem prazo no modelo segue com a meta manual de hoje.
- Na tela: "faltam X dias úteis", "⏸ aguardando cliente há X dias", "atrasada há X dias úteis".
- Registram-se separadamente **dias úteis do escritório** e **dias úteis aguardando o cliente**.

### Relógio do processo

- Começa na abertura do processo; meta = abertura + N dias úteis + dias pausados.
- O processo está **pausado** quando todas as suas OS liberadas e não concluídas estão pausadas
  aguardando o cliente.
- O processo **conclui** quando todas as OS estão concluídas ou desconsideradas (registra
  `completedAt`); se novas OS forem adicionadas depois, volta a ficar em andamento.

### Data limite (não pausa)

- O `dueDate` atual: data fixa opcional (vencimento legal, prazo de órgão). Os avisos de SLA que já
  existem continuam valendo, inclusive com o prazo interno pausado.

### Motivo de atraso

- Lista de **motivos configurável** pelo escritório (Configurações → Motivos de atraso), com padrões:
  "Aguardando órgão público", "Retrabalho interno", "Volume de trabalho", "Outro" — "Outro" exige
  observação.
- Ao **concluir** uma OS cuja meta (já descontada a pausa) passou: diálogo pede motivo + observação
  opcional; **não conclui sem motivo**. Vale para concluir pelo drawer, por arrastar para coluna de
  conclusão, por "concluir prontas" da fila do robô e por conclusão automática — na automática a OS
  conclui e fica marcada "concluída com atraso — motivo pendente", cobrada na lista e no Dashboard.
- Dá para registrar o motivo **antes** de concluir (quando já se sabe que vai atrasar).
- Processo: ao concluir com atraso, o motivo do processo é pedido a quem concluiu a última OS (mesma
  regra de "motivo pendente" se a conclusão for automática).
- Tudo no histórico.

## Dependência entre OS

- Definida no Modelo de Processo; copiada para as OS do processo aberto. Uma OS pode depender de
  várias.
- OS com dependência pendente fica **bloqueada** ("aguardando Registro na Junta"), não conta prazo, e
  não pode ser concluída nem iniciada. **Admin/gerente pode liberar antes** com justificativa
  (histórico).
- Ao concluir a última dependência, a OS é liberada (status aberto, relógio começa) e o responsável
  é avisado no sino.
- Ciclos são recusados ao salvar o modelo.

## Tempo por etapa

- No processo: quanto tempo (dias úteis) cada OS levou (escritório × aguardando cliente) e quanto
  tempo o processo ficou em cada coluna (a partir do histórico de movimentação, que já existe).
- No Dashboard: atrasos por motivo; por modelo de OS e de processo, tempo médio do escritório ×
  aguardando cliente; OS concluídas com motivo pendente.

## Robô

Nenhuma mudança no fluxo do robô. Como a OS é uma tarefa com entregas com robô e competência, a
leitura, a fila, "Confirmar os N sem pendência", "concluir prontas" e a conferência na entrega manual
já funcionam para ela. A fila mostra "OS" (e o processo, se houver) na sugestão.

## Modelo de dados (direção; nomes finais com o builder)

- `OSTemplate` → **`ProcessTemplate`** (e colunas/documentos); `Board.osTemplateId` →
  `processTemplateId`; `BoardType.OS` → `PROCESS`; novo `BoardType.SERVICE_SYSTEM` (board de serviços
  do cliente). Pré-produção: renomear sem compatibilidade (memória do projeto: sem legado).
- **`OSModel`** (+ documentos a cobrar e a entregar no mesmo padrão de
  `RecurringTaskTemplateDocument`).
- **`ProcessTemplateItem`** (modelo de processo × modelo de OS × coluna de nascimento) e
  **`ProcessTemplateItemDependency`**.
- `Task`: `osModelId?`, `releasedAt?`, `deadlineBusinessDays?`, `delayReasonId?`, `delayNote?`,
  `delayReasonPending`; **`TaskDependency`** (tarefa × tarefa de que depende); **`TaskPause`**
  (início/fim de cada espera do cliente).
- `Board` (processo): `deadlineBusinessDays?`, `targetDate?`, `completedAt?`, motivo de atraso (mesmos
  campos).
- `Request`: referencia **ou** um modelo de OS **ou** um modelo de processo (exatamente um quando
  aprovada pelo escritório com modelo).
- **`DelayReason`** (por organização) e **`Holiday`** (por organização).
- Todas com `organizationId`, índices para os filtros da lista de OS, migrations versionadas.

## Decisões de implementação (chamadas do Claude, revisar)

Respostas às dúvidas do revisor; o Max pode corrigir qualquer uma.

1. **OS esperando dependência não usa `BLOCKED`.** Fica com `releasedAt = null` e status `OPEN`; a
   tela mostra "aguardando <OS>". Assim não dispara o aviso de bloqueio ao cliente, não entra na
   métrica de impedimento e um documento resolvido não a "libera" por engano. A API recusa (409)
   iniciar, mover ou concluir OS não liberada.
2. **Board do processo:** arrastar OS não liberada é recusado; o resto segue a regra atual de
   `statusEffect` das colunas. Concluir pelo drawer mantém o comportamento de hoje.
3. **Tempo por coluna** é medido por OS (quanto cada OS ficou em cada coluna, pelo histórico
   `moved_to`); a visão do processo mostra, por coluna, o total e a média das OS. A barra de progresso
   do portal continua como hoje.
4. **Competência em processo:** ao abrir um processo cujos modelos de OS pedem competência, informa-se
   **uma competência do processo**, copiada para essas OS; cada OS pode ser ajustada depois no drawer.
   No pedido do cliente vale o mesmo campo.
5. **Solicitações:** a solicitação aprovada aponta para a OS criada (`taskId`, como hoje) ou para o
   **processo criado** (novo `boardId`). O **Modelo de Processo ganha departamento responsável** (quem
   avalia o pedido e departamento padrão das tarefas manuais). Continuam existindo o pedido livre
   (sem modelo: o escritório escolhe o modelo ao aprovar, como hoje escolhe o template) e o "adicionar
   a processo existente" (adiciona uma OS de um modelo "Dentro de processos" ao processo escolhido).
6. **Tarefas manuais no processo** continuam permitidas; contam para "processo concluído" e para a
   pausa do processo, sem prazo próprio a não ser a meta manual. "Adicionar OS" no board de processo
   escolhe um modelo e, opcionalmente, de quais OS do processo ela depende.
7. **Pausa** = documento obrigatório do cliente `PENDING`/`REJECTED` **ou** aprovação do cliente
   pendente. Arquivo `UPLOADED` (vez do escritório conferir) não pausa. A aprovação pendente pausa o
   relógio **sem** mudar o status para `BLOCKED`.
8. **Motivo de atraso em lote** ("concluir prontas"): um motivo por OS, com atalho "aplicar a todas".

## Fora do escopo

- Criar OS em lote (o lote do caso de uso é de PDFs para o robô, já suportado).
- Mudanças no motor de leitura do robô.

## Deixado para o builder

- Layout das telas novas seguindo o padrão das atuais (formulário de recorrente, lista de Tarefas).
- Nomes finais de tabelas/campos e o algoritmo de dias úteis (com testes de borda: feriado, virada de
  ano, pausa que começa e termina no mesmo dia).
- Como reaproveitar o drawer, a fila do robô e os avisos de SLA sem duplicar código.
