// undefined = "não mude o campo" (Prisma ignora update com undefined); null = "limpe o campo"
// (tarefa reaberta); Date = "acabou de concluir agora".
export function resolveCompletedAt(
  previousStatus: string,
  nextStatus: string,
  now: Date,
): Date | null | undefined {
  if (previousStatus === nextStatus) return undefined
  if (nextStatus === 'DONE') return now
  if (previousStatus === 'DONE') return null
  return undefined
}
