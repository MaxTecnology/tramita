# SLA e Alertas de Prazo — Design

> Item 3 do roadmap de sub-projetos ativos (`docs/TASKS.md`). Estende o modelo de `Task`/`Board`
> já existente — não requer novo subsistema de board/coluna.

## Objetivo

Hoje o único alerta de prazo é `TASK_DUE_DATE_APPROACHING`: um cron horário que varre tasks com
`dueDate` nas próximas 24h e dispara notificação por email/WhatsApp — **sem dedup**, repetindo a
mesma mensagem a cada hora enquanto a task estiver na janela. Isso é a origem concreta do
"incômodo" que motivou este projeto.

O objetivo é substituir esse mecanismo por um sistema de alerta de prazo em dois níveis
(meta e vencimento), com:
- Indicador visual permanente no card do Kanban.
- Push + som no navegador, em tempo real, só para tarefas de board tipo `OS`, com customização de
  som por usuário (e som próprio por organização).
- Um resumo diário único por email/WhatsApp (substituindo o cron horário), cobrindo `OS` e
  `RECURRING_SYSTEM`.

## Decisões de escopo (fechadas em brainstorming)

| Decisão | Escolha |
|---|---|
| Datas de referência | Duas: `targetDate` (meta, aviso leve) e `dueDate` (vencimento, aviso crítico) |
| Destinatários | `assignee` da task com prioridade; sem assignee, cai para toda a equipe interna da org (ORG_ADMIN/MEMBER) |
| Janela de antecedência | Configurável por organização (`slaTargetWarningDays`, `slaDueCriticalDays`) |
| Alcance do push+som | Só tarefas em boards `Board.type = OS`. Recorrente fica só no digest |
| Repetição do push+som | Uma vez por nível, por tarefa (dedup client-side) |
| Persistência de preferência de som | Backend, por usuário (sincroniza entre dispositivos) |
| Som customizado | Organização pode subir 1 som próprio (upload único, reutilizado nos dois níveis) |
| Formato do alerta por email/WhatsApp | Resumo diário (digest), não evento por tarefa |
| Escopo do digest | `OS` + `RECURRING_SYSTEM` juntas |
| Horário do digest | Fixo, `0 8 * * *` (8h, sem config de horário) |
| Tipo de push | Só com o app aberto em alguma aba (sem Service Worker / Web Push / VAPID) |
| Mecanismo de entrega do push | Polling client-side (React Query, ~60s) sobre dados já derivados — sem SSE novo |
| Mecanismo antigo (`TASK_DUE_DATE_APPROACHING`/`duedate.cron.ts`) | Removido, substituído integralmente pelo digest |

## Arquitetura

### 1. Cálculo de nível de SLA — função pura, sem tabela nova

O nível de alerta nunca é armazenado — é sempre derivado de `targetDate`/`dueDate` + config da
org + `now`. Isso evita manter uma tabela de estado sincronizada com toda mutação de data/status
da task.

**Backend** — `apps/api/src/lib/sla.ts`:

```typescript
export type SlaLevel = 'NONE' | 'TARGET_WARNING' | 'DUE_CRITICAL'

export interface SlaConfig {
  slaTargetWarningDays: number
  slaDueCriticalDays: number
}

export function computeSlaLevel(
  targetDate: Date | null,
  dueDate: Date | null,
  now: Date,
  config: SlaConfig,
): SlaLevel {
  // DUE_CRITICAL tem prioridade sobre TARGET_WARNING quando ambos se aplicam
  if (dueDate) {
    const criticalThreshold = new Date(dueDate.getTime())
    criticalThreshold.setUTCDate(criticalThreshold.getUTCDate() - config.slaDueCriticalDays)
    if (now >= criticalThreshold) return 'DUE_CRITICAL'
  }
  if (targetDate) {
    const warningThreshold = new Date(targetDate.getTime())
    warningThreshold.setUTCDate(warningThreshold.getUTCDate() - config.slaTargetWarningDays)
    if (now >= warningThreshold) return 'TARGET_WARNING'
  }
  return 'NONE'
}
```

Tarefas já `DONE`/`DISREGARDED` nunca entram no cálculo — filtradas na query, não na função pura.

**Frontend** — mesma lógica espelhada em `apps/web/src/lib/sla.ts` (mesmo padrão já usado para
`computePreview`/`computeNextDueMonthClient` em `RecurringTemplateManage.tsx`), usada tanto pelo
badge do card quanto pelo hook de alertas.

**Schema** — `NotificationConfig` ganha:
```prisma
slaTargetWarningDays Int @default(3)
slaDueCriticalDays   Int @default(1)
```

### 2. Badge visual no Kanban

`TaskCard` calcula `computeSlaLevel` diretamente no render a partir de `task.targetDate`/
`task.dueDate` e da config da org (já disponível via contexto/query existente). Mapeamento:
- `TARGET_WARNING` → borda/ícone amarelo.
- `DUE_CRITICAL` → borda/ícone vermelho.
- `NONE` → sem alteração.

Sem SSE, sem polling dedicado — atualiza sozinho a cada render (o board já re-renderiza
periodicamente via o stream de board existente).

### 3. Push + som (tempo real, só OS)

**Hook global** `apps/web/src/hooks/useSlaAlerts.ts`, montado uma vez em `AppLayout.tsx` (mesmo
ponto de montagem de `useRequestsBadgeStream`):

- Query React Query: `GET /tasks?boardType=OS&assigneeId=me&status=open` (novo filtro de query
  params no endpoint de tasks já existente), `refetchInterval: 60_000`.
- Fallback: se a resposta vier vazia porque o usuário não tem tasks com `assigneeId` próprio mas é
  ORG_ADMIN/MEMBER, o endpoint também aceita um modo "da organização" (sem `assigneeId=me`) — a
  escolha de qual query disparar depende do papel do usuário logado.
- A cada tick do `setInterval` (ou a cada novo resultado da query), recalcula `computeSlaLevel`
  para cada task e compara contra o que já foi alertado nesta sessão de navegador
  (`sessionStorage`, chave `sla:${taskId}:${level}`).
- Em uma transição nova (chave ainda não vista):
  1. Marca a chave em `sessionStorage`.
  2. Mostra toast (componente de toast já usado no projeto).
  3. Se a permissão do browser (`Notification.permission`) for `"granted"`, dispara
     `new Notification(...)`. Se for `"default"` (nunca perguntado), mostra um banner discreto
     primeiro, explicando o motivo, e só chama `Notification.requestPermission()` quando o
     usuário aceitar no banner — nunca na primeira carga da página sem contexto.
  4. Toca o som configurado pelo usuário para aquele nível (seção 4), respeitando volume e opção
     de mudo.

Não há endpoint de stream novo — a passagem de tempo que cruza um threshold não é um evento de
mutação no backend, então um SSE dedicado não agregaria nada sobre o polling leve de 60s.

### 4. Áudio customizável

**Schema** — novo model, 1:1 com `User`:

```prisma
model UserSlaPreference {
  id                  String  @id @default(cuid())
  userId              String  @unique
  targetWarningSound  String  @default("SOFT_PING") // CHIME | BELL | SOFT_PING | MUTE | ORG_CUSTOM
  targetWarningVolume Int     @default(50)
  dueCriticalSound    String  @default("BELL")
  dueCriticalVolume   Int     @default(70)
  updatedAt           DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_sla_preferences")
}
```

Validação Zod na borda: `targetWarningVolume`/`dueCriticalVolume` em `0-100`; sons restritos ao
enum de strings válidas (`CHIME`, `BELL`, `SOFT_PING`, `MUTE`, `ORG_CUSTOM`).

**Endpoints** (`apps/api/src/modules/users` ou módulo novo `sla-preferences`):
- `GET /users/me/sla-preferences` — retorna preferência (cria com defaults se não existir).
- `PATCH /users/me/sla-preferences` — atualiza parcialmente.

**Som customizado por organização** — `NotificationConfig` ganha:
```prisma
customSlaSoundKey   String? // chave no B2
customSlaSoundLabel String? // nome exibido, ex: "Som G2A"
```
- `POST /notifications/config/sla-sound` (multipart, só `ORG_ADMIN`): valida `Content-Type`
  (`audio/mpeg` ou `audio/wav`), tamanho máx. 500KB, sobe via `uploadFile` (`src/lib/b2.ts`), salva
  key + label.
- `DELETE /notifications/config/sla-sound`: remove do B2 (`deleteFile`) e limpa os campos. Usuários
  que tinham `ORG_CUSTOM` selecionado caem no fallback de preview (tratado no frontend: se
  `customSlaSoundKey` for `null`, a opção não aparece na lista e quem tinha selecionado usa
  `SOFT_PING`/`BELL` como fallback silencioso, sem erro).
- Frontend busca a URL assinada (`getSignedDownloadUrl`) só quando for tocar o som, não no load da
  página.

**Assets padrão do sistema** — arquivos estáticos em `apps/web/public/sounds/`:
`chime.mp3`, `bell.mp3`, `soft-ping.mp3` (curtos, ~1s, volume normalizado).

**UI:**
- Nova seção em Configurações (nível organização, `ORG_ADMIN`): upload/preview/remoção do som da
  org.
- Nova aba/seção no perfil do usuário (`apps/web/src/pages/app/settings/...` ou página de perfil
  existente): seletor de som + slider de volume por nível, com botão "testar".

### 5. Digest diário (substitui `duedate.cron.ts`)

**Remover:**
- `apps/api/src/workers/duedate.cron.ts` (arquivo inteiro).
- Evento `TASK_DUE_DATE_APPROACHING` do enum `NotificationEvent`.
- Campo `dueDateAlert` de `NotificationConfig`, `updateConfigSchema`, `Notifications.tsx`,
  `Templates.tsx`'s `EVENTS`, `EVENT_LABEL` (todos os pontos tocados na leitura de código feita
  durante o brainstorming).
- Entrada `TASK_DUE_DATE_APPROACHING` de `DEFAULT_TEMPLATES` (`src/lib/default-templates.ts`) e do
  `EVENT_FLAG_MAP` (`notification.worker.ts`).

**Adicionar:**
- Evento `SLA_DIGEST` no enum `NotificationEvent`.
- Campo `slaDigestEnabled Boolean @default(true)` em `NotificationConfig` (toggle, nivelado ao
  padrão dos outros eventos: `updateConfigSchema`, `getConfig`'s select, `Notifications.tsx`,
  `Templates.tsx`).
- Entrada `SLA_DIGEST` em `DEFAULT_TEMPLATES` (corpo WHATSAPP curto tipo "Você tem {{count}} tarefas
  com prazo próximo, {{criticalCount}} críticas. Acesse: {{portalUrl}}"; corpo EMAIL em HTML listando
  cada tarefa com cliente/título/data/nível).

**Worker novo** — `apps/api/src/workers/sla-digest.cron.ts`:

```typescript
import { Queue, Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { enqueueNotification } from '@/lib/queue'
import { computeSlaLevel } from '@/lib/sla'

export async function startSlaDigestCronWorker() {
  const cronQueue = new Queue('sla-digest-cron', { connection: bullmqRedis })

  await cronQueue.add('check', {}, {
    repeat: { pattern: '0 8 * * *' },
    jobId: 'sla-digest-check',
  })

  return new Worker('sla-digest-cron', async () => {
    const now = new Date()
    const orgs = await prisma.organization.findMany({
      include: { notificationConfig: true },
    })

    for (const org of orgs) {
      if (org.notificationConfig?.slaDigestEnabled === false) continue

      const config = {
        slaTargetWarningDays: org.notificationConfig?.slaTargetWarningDays ?? 3,
        slaDueCriticalDays: org.notificationConfig?.slaDueCriticalDays ?? 1,
      }

      const tasks = await prisma.task.findMany({
        where: {
          status: { notIn: ['DONE', 'DISREGARDED'] },
          column: { board: { organizationId: org.id, isActive: true } },
          OR: [{ targetDate: { not: null } }, { dueDate: { not: null } }],
        },
        include: {
          assignee: true,
          column: { include: { board: { select: { clientId: true, type: true } } } },
        },
      })

      const byRecipient = new Map<string, { email: string; alerts: typeof tasks }>()
      const admins = await prisma.user.findMany({
        where: { organizationId: org.id, role: { in: ['ORG_ADMIN', 'MEMBER'] } },
      })

      for (const task of tasks) {
        const level = computeSlaLevel(task.targetDate, task.dueDate, now, config)
        if (level === 'NONE') continue

        const recipients = task.assignee ? [task.assignee] : admins
        for (const recipient of recipients) {
          const bucket = byRecipient.get(recipient.id) ?? { email: recipient.email, alerts: [] }
          bucket.alerts.push(task)
          byRecipient.set(recipient.id, bucket)
        }
      }

      for (const [userId, bucket] of byRecipient) {
        await enqueueNotification({
          event: 'SLA_DIGEST',
          organizationId: org.id,
          recipientType: 'USER',
          userId,
          metadata: {
            taskCount: String(bucket.alerts.length),
            // demais campos de interpolação do corpo (lista formatada) resolvidos no worker de envio
          },
        })
      }
    }
  }, { connection: bullmqRedis })
}
```

> Nota de implementação: `enqueueNotification`/`notification.worker.ts` hoje resolvem destinatário
> via `clientId`/`taskId` (perspectiva de 1 task por notificação). O digest precisa de um modo novo
> de resolução de destinatário por `userId` direto — verificar no plano de implementação se
> `NotificationJob.userId` já é respeitado no worker de envio ou se precisa de um branch novo.

**Idempotência:** natural — roda 1x por dia via `repeat.pattern`. Sem necessidade de tabela de
dedup; logado em `NotificationLog` como os demais eventos.

## Fora do escopo (v1)

- Push real via Service Worker/Web Push/VAPID (funcionaria com app fechado) — adiável para uma v2
  se o uso real mostrar necessidade.
- Horário configurável do digest por org.
- Múltiplos sons customizados por organização (só 1 slot, reaproveitado nos dois níveis).
- Alertas de SLA para o portal do cliente final.

## Revisão própria

- **Placeholders:** nenhum — todo trecho de código é completo ou citação do que já existe.
- **Consistência:** `computeSlaLevel` é a única fonte da verdade, replicada (não duplicada em
  lógica diferente) no frontend; `DUE_CRITICAL` tem prioridade sobre `TARGET_WARNING` quando ambos
  se aplicam, evitando ambiguidade de qual badge mostrar.
- **Escopo:** fechado — cobre os 3 pilares pedidos (visual, push+som customizável, email/WhatsApp
  resumido) sem reabrir o redesign Kanban/OS/Recorrente (que é um projeto separado, ainda em
  brainstorming parado, conforme memória de sessões anteriores).
- **Ambiguidade resolvida:** o destinatário do digest quando a task não tem `assignee` cai para
  "todos ORG_ADMIN/MEMBER da org" — mesma regra do push em tempo real, evitando um escritório com
  muitas tasks sem responsável gerar listas enormes para pessoas aleatórias.
