// Datas "date-only" (dueDate, targetDate, competence, boardDueDate) são armazenadas como
// meia-noite UTC (ver recurring-templates/recurrence-dates.ts::computeDueDate). Formatá-las
// ou compará-las usando o fuso local do navegador faz com que, pra qualquer viewer em fuso
// negativo (todo o Brasil), o dia apareça um dia antes do real. Os helpers abaixo centralizam
// a forma correta de lidar com esse tipo de data.

/** Formata uma data "date-only" (armazenada em meia-noite UTC) sem deslocar de dia por fuso local. */
export function formatDateOnlyUTC(date: string | Date): string {
  return new Date(date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

function utcDayFromUTCDate(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function utcDayFromLocalDate(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * Compara uma data "date-only" (meia-noite UTC) contra "agora" em granularidade de dia,
 * usando o dia UTC da data armazenada e o dia local de "now" (o dia que o viewer está vivendo).
 * Retorna true se a data já passou (dia estritamente anterior ao dia atual do viewer).
 */
export function isPastDateOnlyUTC(date: string | Date, now: Date = new Date()): boolean {
  return utcDayFromUTCDate(new Date(date)) < utcDayFromLocalDate(now)
}

/** Diferença em dias inteiros (granularidade de dia) entre uma data "date-only" (UTC) e "now" (local). */
export function diffDaysDateOnlyUTC(date: string | Date, now: Date = new Date()): number {
  const due = utcDayFromUTCDate(new Date(date))
  const today = utcDayFromLocalDate(now)
  return Math.round((due - today) / (1000 * 60 * 60 * 24))
}
