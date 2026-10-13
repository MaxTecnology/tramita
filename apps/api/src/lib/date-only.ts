// Helpers compartilhados pra campos "date-only" do backend (Task.dueDate/targetDate/competence,
// Board.dueDate, Protocol.dueDate) — gravados como meia-noite UTC representando um RÓTULO de
// dia-calendário (ex: "2026-10-20" no formulário -> 2026-10-20T00:00:00Z), nunca um instante
// real. Mesma convenção documentada em apps/web/src/lib/dates.ts. Ler esse rótulo pelos getters
// UTC (nunca reconvertendo de fuso) e comparar contra "hoje"/"este mês" convertido de verdade
// pra BRT evita o off-by-one de ~3h que aparece quando se compara contra o instante bruto de
// `now` ou contra getters locais do processo (que em produção normalmente é UTC, não BRT).

const BRT_TIMEZONE = 'America/Sao_Paulo'

export function utcDayLabel(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function brtParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

// Dia de hoje em BRT, como rótulo (comparável diretamente com utcDayLabel).
export function todayInBRT(now: Date): number {
  const { year, month, day } = brtParts(now)
  return Date.UTC(year, month - 1, day)
}

// Início do dia de hoje em BRT, como instante UTC — usar quando o alvo da comparação é um campo
// Prisma DateTime (ex: `dueDate: { lt: startOfTodayInBRT(now) }`), não um número pra aritmética.
export function startOfTodayInBRT(now: Date): Date {
  return new Date(todayInBRT(now))
}

// Início do mês atual em BRT, como instante UTC — pra filtrar por um instante real (ex:
// completedAt) que "aconteceu" dentro do mês-calendário local da organização.
export function startOfMonthInBRT(now: Date): Date {
  const { year, month } = brtParts(now)
  return new Date(Date.UTC(year, month - 1, 1))
}
