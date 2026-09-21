import { Queue, Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { computeCompetencesToGenerate, type RecurrenceDateRules } from '@/modules/recurring-templates/recurrence-dates'
import { generateTaskForAssignment } from '@/modules/recurring-templates/recurring-templates.service'

export async function runRecurringTasksGeneration(today: Date = new Date()): Promise<void> {
  const templates = await prisma.recurringTaskTemplate.findMany({
    where: { isActive: true },
    include: { assignments: { where: { isActive: true } } },
  })

  for (const template of templates) {
    let competences: Date[]
    try {
      const rules: RecurrenceDateRules = template
      competences = computeCompetencesToGenerate(today, rules)
    } catch {
      // Falha no cálculo de competência não deve derrubar o cron inteiro — pula esse
      // template nesta execução, o próximo dia tenta de novo. `generateTaskForAssignment`
      // já cobre a maioria dos erros com log+alerta; isso aqui é só um cinto de segurança
      // extra pra um bug de cálculo que nem chega a rodar por assignment.
      continue
    }
    if (competences.length === 0) continue

    for (const assignment of template.assignments) {
      for (const competence of competences) {
        try {
          await generateTaskForAssignment(template.id, assignment.id, competence)
        } catch {
          // generateTaskForAssignment já captura e loga qualquer erro esperado (retorna
          // FAILED, nunca deveria lançar) — esse catch é só defesa extra contra um bug
          // inesperado, pra garantir que um assignment problemático nunca trava os demais.
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
