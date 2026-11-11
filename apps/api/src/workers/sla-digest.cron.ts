import { Queue, Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { enqueueNotification } from '@/lib/queue'
import { computeSlaLevel, type SlaLevel } from '@/lib/sla'
import { expireOverdueProtocols } from '@/modules/protocols/protocols.service'
import { getFailedGenerations } from '@/modules/recurring-templates/recurring-templates.service'

interface DigestEntry {
  kind: 'task' | 'protocol' | 'recurring_failure'
  title: string
  clientName: string
  level: SlaLevel | 'EXPIRED' | 'FAILED'
  dateLabel: string
}

const MAX_DIGEST_LINES = 20
const DIGEST_TIMEZONE = 'America/Sao_Paulo'

function formatTaskLine(entry: DigestEntry): string {
  if (entry.kind === 'recurring_failure') {
    return `- [recorrente não gerada] ${entry.title} (${entry.clientName}) — ${entry.dateLabel}`
  }
  const tag = entry.level === 'DUE_CRITICAL' ? 'crítico' : entry.level === 'EXPIRED' ? 'vencido sem visualização' : 'atenção'
  const prefix = entry.kind === 'protocol' ? '[protocolo] ' : ''
  return `- ${prefix}${entry.title} (${entry.clientName}) — ${entry.dateLabel} [${tag}]`
}

// Recorrente que não nasceu primeiro (é uma obrigação que ninguém vai fazer), depois vencido sem
// visualização, crítico e atenção — o que já falhou precisa de atenção imediata, o resto ainda dá
// tempo de agir.
function formatTaskListText(entries: DigestEntry[]): string {
  const rank = (level: DigestEntry['level']) =>
    level === 'FAILED' ? 0 : level === 'EXPIRED' ? 1 : level === 'DUE_CRITICAL' ? 2 : 3
  const sorted = [...entries].sort((a, b) => rank(a.level) - rank(b.level))
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
  org: {
    id: string
    notificationConfig: {
      slaDigestEnabled: boolean
      slaTargetWarningDays: number
      slaDueCriticalDays: number
      protocolWarningDays: number
    } | null
  },
  now: Date,
): Promise<void> {
  // Roda incondicionalmente, ANTES de qualquer early-return — expirar um protocolo vencido é uma
  // transição de estado de negócio (o Dashboard e o comprovante do cliente dependem dela), não
  // uma função do email de resumo. Desligar o digest (`slaDigestEnabled: false`) não pode ter o
  // efeito colateral de travar a expiração de protocolo pra sempre.
  await expireOverdueProtocols(org.id, now)

  if (org.notificationConfig?.slaDigestEnabled === false) return

  // Org sem linha em NotificationConfig (nunca visitou a tela de Configurações) provisiona aqui,
  // com os defaults do schema — sem isso, o enqueue abaixo funcionaria mas o worker de envio
  // descartaria o job silenciosamente (`processNotificationJob` retorna se `!config`), quebrando
  // o "digest ligado por padrão" pra qualquer org nova.
  const notificationConfig = org.notificationConfig ?? await prisma.notificationConfig.create({
    data: { organizationId: org.id },
  })

  const config = {
    slaTargetWarningDays: notificationConfig.slaTargetWarningDays,
    slaDueCriticalDays: notificationConfig.slaDueCriticalDays,
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

  const protocolThreshold = new Date(now)
  protocolThreshold.setUTCDate(protocolThreshold.getUTCDate() + notificationConfig.protocolWarningDays)

  // status IN ('SENT','EXPIRED') de propósito — um protocolo já VIEWED/DOWNLOADED não é mais
  // "sem visualização", sai do digest mesmo que o vencimento ainda esteja próximo.
  const protocols = await prisma.protocol.findMany({
    where: {
      organizationId: org.id,
      status: { in: ['SENT', 'EXPIRED'] },
      dueDate: { not: null, lte: protocolThreshold },
    },
    select: {
      id: true, title: true, dueDate: true, status: true,
      client: { select: { name: true } },
      task: { select: { assignee: { select: { id: true, isActive: true } } } },
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
      kind: 'task',
      title: task.title,
      clientName: task.column.board.client.name,
      level,
      // dueDate/targetDate são rótulos de dia-calendário (meia-noite UTC), não instantes reais —
      // formatar com DIGEST_TIMEZONE (BRT) os reinterpretaria como instante e mostraria o dia
      // anterior (ver mesmo padrão em apps/web/src/lib/dates.ts). timeZone: 'UTC' lê o rótulo.
      dateLabel: level === 'DUE_CRITICAL'
        ? `vence ${task.dueDate!.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`
        : `meta ${task.targetDate!.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`,
    }

    // Assignee desativado (ex-funcionário) nunca é destinatário — mesma regra de "sem assignee".
    const recipientIds = task.assignee?.isActive ? [task.assignee.id] : admins.map((a) => a.id)
    for (const userId of recipientIds) {
      const bucket = byUserId.get(userId) ?? []
      bucket.push(entry)
      byUserId.set(userId, bucket)
    }
  }

  for (const protocol of protocols) {
    const entry: DigestEntry = {
      kind: 'protocol',
      title: protocol.title,
      clientName: protocol.client.name,
      level: protocol.status === 'EXPIRED' ? 'EXPIRED' : 'TARGET_WARNING',
      dateLabel: `vence ${protocol.dueDate!.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`,
    }
    const recipientIds = protocol.task.assignee?.isActive ? [protocol.task.assignee.id] : admins.map((a) => a.id)
    for (const userId of recipientIds) {
      const bucket = byUserId.get(userId) ?? []
      bucket.push(entry)
      byUserId.set(userId, bucket)
    }
  }

  const failures = await getFailedGenerations(org.id)
  for (const failure of failures) {
    const competence = new Date(failure.competence)
    const entry: DigestEntry = {
      kind: 'recurring_failure',
      title: failure.templateTitle,
      clientName: failure.clientName,
      level: 'FAILED',
      dateLabel: `competência ${String(competence.getUTCMonth() + 1).padStart(2, '0')}/${competence.getUTCFullYear()}: ${failure.errorMessage}`,
    }
    for (const admin of admins) {
      const bucket = byUserId.get(admin.id) ?? []
      bucket.push(entry)
      byUserId.set(admin.id, bucket)
    }
  }

  for (const [userId, entries] of byUserId) {
    const criticalCount = entries.filter((e) => e.level === 'DUE_CRITICAL' || e.level === 'EXPIRED').length
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
