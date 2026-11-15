# Robô por documento a entregar — design

Data: 2026-11-15. Origem: conversa com o Max depois do redesenho do formulário de tarefas recorrentes.

## Por quê

O robô de leitura existe para **automatizar a entrega de documentos ao cliente** (guias, impostos):
o escritório gera a guia, sobe o PDF, o robô reconhece de quem é e para qual tarefa vai, e a entrega
acontece com o mínimo de interação. Hoje ele não consegue fazer isso bem porque:

- a obrigação que o robô reconhece está no **template inteiro**: uma Folha entrega Holerites, Guia
  FGTS e Guia INSS, e o robô não sabe qual dessas entregas o PDF preenche — com mais de uma entrega
  pendente ele para e pede para escolher;
- a fila de revisão é feita para um documento por vez;
- a entrega manual pela tela da tarefa não passa por nenhuma conferência — dá para mandar o arquivo
  errado ao cliente sem aviso.

Referências: o Nibo lê documentos com robôs, mas sempre com conferência e "Protocolar" por uma pessoa
(um a um ou "Protocolar todos"); o Domínio/Gestta conclui tarefas e envia documentos a partir de
rotinas do sistema contábil, não de leitura de PDF. Ligar a leitura do documento à entrega certa,
com conferência fácil, é um diferencial do Tramita.

## Decisões do Max

1. **O robô fica em cada documento a entregar** do template (ex.: "Guia DAS" → obrigação DAS). Uma
   tarefa pode ter **vários documentos com robô**.
2. **Tudo passa pela fila:** o robô lê, confere e **sugere**; uma pessoa confirma. Nada vai ao
   cliente sem esse clique. A conferência precisa ser **muito fácil**, inclusive em lote.
3. Depois de confirmar, mesma regra da entrega manual: se tudo da tarefa ficou resolvido e o template
   tem "concluir automaticamente", conclui; senão, a tarefa fica **pronta para concluir** e o
   escritório é convidado a concluir.
4. **Entrega manual também passa pelo robô:** ao enviar um arquivo numa entrega com robô pela tela
   da tarefa, o robô confere na hora; se algo não bater, avisa e pergunta se entrega mesmo assim — e
   isso fica no histórico.
5. **CNPJ de outro cliente do escritório bloqueia** (sem "entregar mesmo assim"): seria mandar dado
   fiscal de uma empresa para outra. Os demais avisos pedem confirmação.

## Modelo de dados

- `RecurringTaskTemplateDocument` (linhas de entrega do template) ganha `obligationTypeId?` →
  `ObligationType` (só faz sentido nas linhas de entrega).
- `TaskDeliverable` ganha `obligationTypeId?` — copiado do template na geração da tarefa (entregas
  avulsas criadas na tela seguem sem robô).
- `ReceivedDocument` ganha `deliverableId?` — a entrega sugerida (além do `taskId` que já existe).
- `RecurringTaskTemplate.obligationTypeId` **sai**. Migração (pré-produção, sem legado): template com
  obrigação e **exatamente uma** entrega → a obrigação vai para essa entrega (e para as entregas
  abertas das tarefas geradas por ele); com zero ou várias entregas → não migra (o escritório marca
  no formulário novo).

## Robô na fila (documento enviado em Leitura de Documentos)

- Leitura como hoje (modelos, CNPJ → cliente, competência, valor, vencimento).
- **Casamento por entrega:** procura tarefas abertas do cliente com uma **entrega pendente** cuja
  obrigação é o tipo lido e cuja competência bate. Exatamente uma → sugere tarefa **e** entrega.
  Nenhuma ou várias → vai para a fila sem sugestão, com o motivo ("sem entrega aberta de DAS em
  10/2026", "duas tarefas possíveis").
- Nunca entrega sozinho (modo sombra continua).

### Tela de conferência (fila)

- Cada linha: arquivo, **cliente**, **obrigação → entrega** ("DAS → Guia DAS"), **tarefa e
  competência**, e as conferências como selos: ✓/⚠ CNPJ, ✓/⚠ competência, ✓/⚠ valor e vencimento
  (só para guia).
- Linha **sem pendência** (todos ✓ e, se guia, valor e vencimento lidos) → botão **Confirmar**.
- Linha **com pendência** → ajuste na própria linha: digitar valor/vencimento, **Trocar tarefa** /
  **Trocar entrega**, ou **Recusar**.
- **"Confirmar os N sem pendência"** em um clique.
- **Ver PDF** abre o documento ao lado, sem sair da fila.
- Depois de confirmar (um ou em lote): resumo "9 entregues · 3 tarefas concluídas · 2 prontas para
  concluir" com **"Concluir as 2 prontas"**.
- Número de documentos para conferir no menu (Leitura de Documentos), como já existe para
  Solicitações.

## Entrega manual com robô (tela da tarefa)

Ao escolher o arquivo numa entrega com obrigação de robô, **antes de entregar** o robô lê o arquivo
e confere:

| Conferência | Resultado se falhar |
|---|---|
| CNPJ de **outro cliente** do escritório | **Bloqueia**: "Este documento é de BETA ME — não pode ser entregue à ACME" |
| CNPJ não encontrado entre os clientes | Aviso |
| Tipo reconhecido ≠ obrigação da entrega (ex.: FGTS numa entrega DAS) | Aviso |
| Competência lida ≠ competência da tarefa | Aviso |
| Guia sem valor ou vencimento lidos | Aviso (o colaborador digita) |
| Arquivo ilegível para o robô (imagem, PDF sem texto) | Aviso leve: "o robô não conseguiu conferir" |

- **Tudo certo:** entrega normal, já com **valor e vencimento preenchidos** a partir da leitura.
- **Com aviso:** diálogo listando as diferenças → **Cancelar** / **Entregar mesmo assim**.
- **Entregar mesmo assim** grava no histórico: "Bruna — entregou 'Guia DAS' (arquivo.pdf) apesar do
  aviso do robô: reconhecido como FGTS; competência 09/2026".
- Entrega sem robô (sem obrigação) continua como hoje.

## Histórico

- Confirmação na fila: "Bruna — entregou 'Guia DAS' (das.pdf) conferido pelo robô".
- Entrega manual sem aviso: como hoje.
- Entrega manual com aviso aceito: linha própria com os avisos (acima).

## Formulário do template

Em "A entregar ao cliente", cada item ganha, ao lado da marca 💲 guia, um seletor **🤖 Robô**
(nenhum / DAS / FGTS / …, a lista de obrigações que o robô lê). O bloco "Avançado: obrigação do robô
de leitura" sai.

## Fora do escopo

- **Entrega automática sem confirmação** — decisão do Max (2026-11-15): arriscada por enquanto;
  toda entrega pelo robô passa pela confirmação de uma pessoa.
- **Processos (OS)** — fica para depois, por ser mais complexo. A ideia é a mesma: a tela de
  conferência também identificar documentos de processos (entrega do processo com obrigação de robô).
- Robô em entregas avulsas criadas na tela da tarefa.
- Novos modelos de leitura (o catálogo atual continua).

## Como validar

- API: casamento por entrega (uma, nenhuma, várias); confirmação preenche a entrega certa; lote;
  conclusão automática / pronta para concluir; checagem na entrega manual (cada linha da tabela,
  bloqueio de CNPJ de outro cliente, "mesmo assim" no histórico, valor/vencimento preenchidos);
  migração do `obligationTypeId`.
- Web: seletor 🤖 no template; fila com selos, confirmar em lote, ajuste na linha, ver PDF; diálogo
  de aviso na entrega manual.
- E2E: subir uma guia na fila → confirmar → cliente vê; entrega manual com competência errada →
  aviso → mesmo assim → histórico.
- QA visual claro/escuro da fila e do diálogo.
