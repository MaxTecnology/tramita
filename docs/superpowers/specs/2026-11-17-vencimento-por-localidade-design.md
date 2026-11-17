# Vencimento por localidade (estado / município) — design

Data: 2026-11-17 · Status: decisões fechadas com o Max em 2026-11-17 — aguardando ok final

## Intenção

Impostos estaduais e municipais vencem em datas diferentes conforme o lugar (ex.: ICMS e FECOEP em
Sergipe × Alagoas; ISS por prefeitura). Nos outros sistemas o escritório cria uma tarefa recorrente por
estado/cidade e mantém N cópias. No Tramita a recorrência é **uma só**: ela diz se o vencimento é
federal, estadual ou municipal, tem a data padrão e exceções por UF ou por cidade, e cada cliente recebe
a data do lugar dele.

## Objetivos

- Uma recorrência por imposto, com data por localidade.
- Imposto que só existe em alguns lugares (FECOEP) não gera tarefa para cliente de outro lugar.
- Estado e cidade obrigatórios no cadastro de todo cliente (PF e PJ). Cliente antigo sem esses dados
  (cadastrado antes da regra) nunca recebe data errada: a geração falha com motivo, visível em
  "Gerações que falharam", até o escritório corrigir o cadastro.
- Buscador de CNPJ confiável e que traga UF + código IBGE da cidade.

## Fora do escopo / não-objetivos

- **Documentos por localidade:** não variam (decisão do Max). A exceção muda só a data.
- **Mês de vencimento por localidade** (trimestral/anual): a exceção não muda o mês. Os meses que geram
  tarefa são calculados pela recorrência inteira (`computeDueMonthsToGenerate`), não por cliente.
- **Dados existentes:** nenhuma migração de dados de cliente. Cliente já cadastrado sem UF/cidade
  válidas é corrigido à mão pelo escritório (decisão do Max).
- **Exceção por cliente** (ex.: ISS de serviço prestado em outra cidade): depois, se aparecer.
- **Feriado por estado/cidade do cliente:** não entra (decisão do Max). Feriados continuam do escritório:
  quem envia as guias é o colaborador, então feriado na cidade do escritório antecipa para o cliente, e
  a meta interna já dá a folga (o colaborador quase nunca envia no dia do pagamento).

## Anti-objetivos (falha mesmo funcionando)

- Gerar tarefa com a data padrão para um cliente cuja UF/cidade não foi reconhecida (data errada calada).
- A geração de tarefas depender de chamada a serviço externo (IBGE, BrasilAPI).
- Recorrência federal (a maioria) ficar mais complicada de cadastrar: a abrangência começa em Federal e a
  tela é a de hoje.

## Abordagens consideradas

| Abordagem | Troca | Decisão |
|---|---|---|
| Uma recorrência por estado/cidade (como os outros sistemas) | Zero mudança; N cópias para manter | Descartada: é o problema |
| Data por cliente no vínculo | Flexível; configurar 200 clientes de SE um a um | Depois, como exceção da exceção |
| **Abrangência na recorrência + exceções por UF ou cidade** | Uma recorrência; exige UF/cidade padronizadas | **Escolhida** (proposta do Max: opção Estadual/Municipal na tarefa) |

## Decisões

### 1. Buscador de CNPJ

- Principal: **BrasilAPI** `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}` (testada em 2026-11-17:
  200 em < 0,2 s; traz `uf`, `municipio`, `codigo_municipio_ibge`).
- Reserva: **CNPJ.ws** (atual; instável no teste: 200 → 500 → 504; limite 3/min por IP). Usada só se a
  BrasilAPI falhar por 5xx, timeout ou 429. 404 da BrasilAPI = "CNPJ não encontrado", sem reserva.
- Se a reserva não trouxer o código IBGE, resolver pelo nome + UF na tabela de municípios (comparação
  sem acento/caixa); não achou → `ibgeCityCode: null` e a tela pede a cidade.
- Timeout por chamada: 8 s.
- As duas falharam → 502 `'Serviço de consulta de CNPJ indisponível no momento. Tente de novo ou preencha os dados à mão.'`
- Resposta de `GET /clients/lookup-cnpj/:cnpj` ganha `ibgeCityCode: number | null` (`estado` = UF).
- Corrigir a descrição no catálogo da API (`api-docs/client.ts`): hoje diz que "avisa se o CNPJ já é
  cliente", o que não acontece.

### 2. Municípios

- Tabela global (sem `organizationId`) `Municipality { ibgeCode Int @id, name String, uf String(2) }`,
  índice por `uf`.
- Carga: arquivo versionado `apps/api/prisma/data/municipios-ibge.json` (gerado uma vez da API do IBGE
  `servicodados.ibge.gov.br/api/v1/localidades/municipios` — 5.571 em 2026-11-17) + migration/seed que
  insere. Nenhuma chamada ao IBGE em runtime.
- Rota `GET /municipalities?uf=SE` (equipe autenticada) para os seletores. Documentar no catálogo.

### 3. Cliente

- `estado` passa a aceitar só as 27 UFs (Zod enum) e é **obrigatório para PF e PJ** (decisão do Max):
  400 `'Informe o estado do cliente'`.
- Novo `ibgeCityCode Int?` no banco (FK para `Municipality`; nulo só em cliente antigo), **obrigatório na
  API** para criar e para salvar edição: 400 `'Informe a cidade do cliente'`. No PATCH vale o estado final
  (cliente antigo sem cidade precisa escolher a cidade para salvar qualquer alteração). A UF tem que ser a
  do município (400 `'A cidade não pertence ao estado informado'`). `cidade` (texto) é preenchido a partir
  do município para exibição.
- Nenhuma migração de dados: clientes antigos ficam como estão até alguém editar.
- Formulário: UF em seletor; cidade em seletor filtrado pela UF; a busca de CNPJ preenche os dois.

### 4. Recorrência: abrangência e exceções

- `RecurringTaskTemplate` ganha:
  - `dueScope LocationScope @default(FEDERAL)` — `FEDERAL | STATE | CITY`.
  - `onlyListedLocations Boolean @default(false)` — só vale com STATE/CITY.
- Nova tabela `RecurringDueRule { id, templateId, uf String?, ibgeCityCode Int?, dueDayOfPeriod Int, dueBusinessDayRoll BusinessDayRoll }`:
  - STATE → `uf` preenchido, cidade nula; CITY → `ibgeCityCode` preenchido, `uf` nula.
  - Únicos: `(templateId, uf)` e `(templateId, ibgeCityCode)`.
  - Mesmas validações do dia de vencimento padrão da periodicidade.
- API: as exceções vão no corpo de criar/alterar a recorrência (`dueScope`, `onlyListedLocations`,
  `dueRules: [...]`); enviar `dueRules` substitui a lista. FEDERAL com `dueRules` não vazio → 400.
  Exceção que não bate com a abrangência → 400.
- **Geração** (`recurring-templates.service.ts`, onde hoje calcula `dueDate`):
  1. FEDERAL → regra padrão (como hoje).
  2. STATE → precisa de `client.estado`; CITY → precisa de `client.ibgeCityCode`. Faltou → FAILED com
     `'Cliente <nome> sem estado cadastrado'` / `'... sem cidade cadastrada'`.
  3. Há exceção para a localidade → usa dia + adiantar/adiar dela; senão, se `onlyListedLocations` →
     FAILED `'Cliente <nome> fora dos locais desta recorrência'`; senão regra padrão.
  4. Competência, meta interna (`targetOffsetDays`), documentos e responsável: iguais para todos.
  - Mudar exceções vale só para gerações futuras (como qualquer mudança de recorrência hoje).
- **Vínculo de clientes:** a tela mostra UF/cidade do cliente; com `onlyListedLocations`, o vínculo em
  lote oferece só clientes dos locais listados, e o vínculo individual de cliente fora avisa
  (não bloqueia — a falha aparece na geração).

### 5. Feriados

Sem mudança (decisão do Max): calendário único do escritório (nacionais + cadastrados pelo escritório),
usado no vencimento — já com a exceção de localidade — e na meta interna, como hoje.

## Respondido na leitura de quem vai construir (decisões do Claude, marcadas para o Max conferir)

- **Periodicidades:** a exceção vale para todas (semanal, mensal, trimestral, anual) e o dia dela tem o
  mesmo significado e a mesma validação do `dueDayOfPeriod` da recorrência (dia da semana no semanal,
  dia do mês nas demais). *(decisão do Claude)*
- **Cliente muda de UF/cidade:** tarefas já geradas ficam como estão; vale para as próximas gerações —
  mesmo comportamento de mudar a recorrência. *(decisão do Claude)*
- **Geração com falha por falta de UF/cidade:** já existe reprocesso — o cron tenta de novo e reaproveita
  a linha FAILED do log (`recurring-templates.service.ts`, branch `existingLog`). Corrigido o cadastro, a
  tarefa sai na próxima rodada. Sem escopo extra.
- **Meta interna:** segue a regra atual de `computeTargetDate`, a partir do vencimento já com a exceção,
  com o calendário do escritório. *(decisão do Claude)*
- **Cidade antiga em texto, sem código IBGE:** continua exibida; a recorrência municipal só considera
  `ibgeCityCode`. Ao editar o cliente a cidade é obrigatória no seletor (o texto antigo aparece como
  referência). Sem lista de pendentes. *(Max corrige à mão)*

## Deixado para quem implementa

- Layout das telas (seguir o padrão atual de formulário de recorrência e de feriados; QA visual com
  screenshots claro/escuro).
- Cache em memória da tabela de municípios.

## Documentação e entregáveis transversais

- Catálogo da API (`src/api-docs/`) + `audit:routes` + `docs:api` no mesmo commit de cada rota
  nova/alterada (regra do CLAUDE.md).
- `docs/SPEC.md` (recorrência, clientes, feriados, municípios) e `.env.example` se surgir variável.
- Migrations revisadas pelo `db-migration-checker`; testes de geração cobrindo: FEDERAL igual a hoje;
  STATE com e sem exceção; CITY; cliente antigo sem UF/cidade; `onlyListedLocations`; exceção que cai em
  feriado do escritório adia/antecipa conforme a regra dela; cadastro sem estado/cidade recusado (PF e
  PJ, criar e editar); buscador com fallback e erro das duas.
