import { Queue, Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { computeCompetencesToGenerate, computeDueMonthsToGenerate, type RecurrenceDateRules } from '@/modules/recurring-templates/recurrence-dates'
import { generateTaskForAssignment } from '@/modules/recurring-templates/recurring-templates.service'

export async function runRecurringTasksGeneration(today: Date = new Date()): Promise<void> {
  const templates = await prisma.recurringTaskTemplate.findMany({
    where: { isActive: true },
    include: { assignments: { where: { isActive: true } } },
  })

  for (const template of templates) {
    let dueMonths: Date[]
    try {
      const rules: RecurrenceDateRules = template
      // WEEKLY continua ancorado em competência (a própria semana); as demais periodicidades
      // agora calculam direto o mês de vencimento — ver spec 2026-10-06.
      dueMonths = rules.periodicity === 'WEEKLY'
        ? computeCompetencesToGenerate(today, rules)
        : computeDueMonthsToGenerate(today, rules)
    } catch {
      // Falha no cálculo não deve derrubar o cron inteiro — pula esse template nesta
      // execução, o próximo dia tenta de novo.
      continue
    }
    if (dueMonths.length === 0) continue

    for (const assignment of template.assignments) {
      for (const dueMonth of dueMonths) {
        try {
          await generateTaskForAssignment(template.id, assignment.id, dueMonth)
        } catch {
          // generateTaskForAssignment já captura e loga qualquer erro esperado (retorna
          // FAILED, nunca deveria lançar) — defesa extra contra bug inesperado.
        }
      }
    }
  }
}

export async function startRecurringTasksCronWorker() {
  const cronQueue = new Queue('recurring-tasks-cron', { connection: bullmqRedis })

  await cronQueue.add('generate', {}, {
    repeat: { every: 3_600_000 * 24 }, // diário — a idempotência do log garante que múltiplas execuções no mesmo dia não dupliquem nada
    jobId: 'recurring-tasks-generate',
  })

  return new Worker('recurring-tasks-cron', async () => {
    await runRecurringTasksGeneration()
  }, { connection: bullmqRedis })
}
