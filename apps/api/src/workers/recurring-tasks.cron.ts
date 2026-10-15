import { Queue, Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { computeCompetencesToGenerate, computeDueMonthsToGenerate, type RecurrenceDateRules } from '@/modules/recurring-templates/recurrence-dates'
import { generateTaskForAssignment } from '@/modules/recurring-templates/recurring-templates.service'
import { startOfTodayInBRT } from '@/lib/date-only'

// `today` é lido pelos getters UTC em recurrence-dates.ts (mesma convenção de todo campo
// date-only do projeto) — por isso o default já entra convertido pro dia-calendário BRT
// (startOfTodayInBRT), não o instante bruto do servidor. Sem isso, um worker que reinicia e
// passa a rodar dentro da janela 00h-03h UTC (21h-00h BRT) veria o dia UTC já virado um dia
// adiante do dia real em BRT, gerando a tarefa recorrente um dia errado.
export async function runRecurringTasksGeneration(today: Date = startOfTodayInBRT(new Date())): Promise<void> {
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

  // Horário fixo com fuso (não `every: 24h desde quando o worker iniciou`) — mesmo padrão já
  // usado em sla-digest.cron.ts. `every` dispara num horário que deriva de quando o processo
  // subiu pela última vez; um reinício em horário variável (deploy, crash, restart do container)
  // pode fazer o cron passar a rodar dentro da janela 00h-03h UTC, que é justamente a janela de
  // risco que o default de `today` acima corrige — melhor eliminar a causa (horário instável) do
  // que só corrigir o sintoma (cálculo de "hoje"). Roda 6h BRT, antes do digest de SLA (8h BRT),
  // pra uma tarefa recorrente gerada hoje já poder entrar no resumo da manhã.
  await cronQueue.add('generate', {}, {
    repeat: { pattern: '0 6 * * *', tz: 'America/Sao_Paulo' },
    jobId: 'recurring-tasks-generate',
  })

  return new Worker('recurring-tasks-cron', async () => {
    await runRecurringTasksGeneration()
  }, { connection: bullmqRedis })
}
