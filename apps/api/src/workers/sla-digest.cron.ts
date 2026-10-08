import { Queue, Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { enqueueNotification } from '@/lib/queue'
import { computeSlaLevel, type SlaLevel } from '@/lib/sla'

interface DigestEntry {
  taskTitle: string
  clientName: string
  level: SlaLevel
  dateLabel: string
}

const MAX_DIGEST_LINES = 20
const DIGEST_TIMEZONE = 'America/Sao_Paulo'

function formatTaskLine(entry: DigestEntry): string {
  const tag = entry.level === 'DUE_CRITICAL' ? 'crítico' : 'atenção'
  return `- ${entry.taskTitle} (${entry.clientName}) — ${entry.dateLabel} [${tag}]`
}

// Crítico primeiro, depois mais antigo (quem está esperando há mais tempo sobe na lista) — evita
// que uma organização com centenas de tarefas vencidas gere uma mensagem de WhatsApp gigante.
function formatTaskListText(entries: DigestEntry[]): string {
  const sorted = [...entries].sort((a, b) => {
    if (a.level !== b.level) return a.level === 'DUE_CRITICAL' ? -1 : 1
    return 0
  })
  const visible = sorted.slice(0, MAX_DIGEST_LINES)
  const lines = visible.map(formatTaskLine)
  const remaining = sorted.length - visible.length
  if (remaining > 0) lines.push(`…e mais ${remaining}. Acesse o painel para ver todas.`)
  return lines.join('\n')
}

export async function runSlaDigest(now: Date = new Date()): Promise<void> {
  const orgs = await prisma.organization.findMany({
    where: { isActive: true, subscriptionStatus: { notIn: ['SUSPENDED', 'CANCELLED'] } },
    include: { notificationConfig: true },
  })

  for (const org of orgs) {
    try {
      await runSlaDigestForOrg(org, now)
    } catch (err) {
      // Uma organização com erro (ex: dado inconsistente) nunca pode impedir o digest das demais —
      // cada execução diária é independente por organização.
      console.error(`[sla-digest] falhou para a organização ${org.id}:`, err)
    }
  }
}

async function runSlaDigestForOrg(
  org: { id: string; notificationConfig: { slaDigestEnabled: boolean; slaTargetWarningDays: number; slaDueCriticalDays: number } | null },
  now: Date,
): Promise<void> {
  // Org sem linha em NotificationConfig (nunca configurou nada) conta como "digest habilitado,
  // thresholds padrão" — só um `slaDigestEnabled` explicitamente false desliga. Mantém o default
  // "ligado por padrão" prometido mesmo pra quem nunca visitou a tela de Configurações.
  if (org.notificationConfig?.slaDigestEnabled === false) return

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
    select: {
      id: true,
      title: true,
      targetDate: true,
      dueDate: true,
      assignee: { select: { id: true, isActive: true } },
      column: { select: { board: { select: { client: { select: { name: true } } } } } },
    },
  })

  const admins = await prisma.user.findMany({
    where: { organizationId: org.id, role: { in: ['ORG_ADMIN', 'ORG_MANAGER'] }, isActive: true },
    select: { id: true },
  })

  const byUserId = new Map<string, DigestEntry[]>()

  for (const task of tasks) {
    const level = computeSlaLevel(task.targetDate, task.dueDate, now, config)
    if (level === 'NONE') continue

    const entry: DigestEntry = {
      taskTitle: task.title,
      clientName: task.column.board.client.name,
      level,
      dateLabel: level === 'DUE_CRITICAL'
        ? `vence ${task.dueDate!.toLocaleDateString('pt-BR', { timeZone: DIGEST_TIMEZONE })}`
        : `meta ${task.targetDate!.toLocaleDateString('pt-BR', { timeZone: DIGEST_TIMEZONE })}`,
    }

    // Assignee desativado (ex-funcionário) nunca é destinatário — mesma regra de "sem assignee".
    const recipientIds = task.assignee?.isActive ? [task.assignee.id] : admins.map((a) => a.id)
    for (const userId of recipientIds) {
      const bucket = byUserId.get(userId) ?? []
      bucket.push(entry)
      byUserId.set(userId, bucket)
    }
  }

  for (const [userId, entries] of byUserId) {
    const criticalCount = entries.filter((e) => e.level === 'DUE_CRITICAL').length
    await enqueueNotification({
      event: 'SLA_DIGEST',
      organizationId: org.id,
      recipientType: 'USER',
      userId,
      metadata: {
        taskCount: String(entries.length),
        criticalCount: String(criticalCount),
        taskListText: formatTaskListText(entries),
      },
    })
  }
}

export async function startSlaDigestCronWorker() {
  const cronQueue = new Queue('sla-digest-cron', { connection: bullmqRedis })

  await cronQueue.add('check', {}, {
    repeat: { pattern: '0 8 * * *', tz: DIGEST_TIMEZONE },
    jobId: 'sla-digest-check',
  })

  return new Worker('sla-digest-cron', async () => {
    await runSlaDigest()
  }, { connection: bullmqRedis })
}
