import type { Prisma } from '@prisma/client'
import { AppError } from '@/errors/AppError'

export const PENDING_APPROVAL = 'Há aprovação do cliente pendente'

// Completion gate: called inside the transaction that would turn the task DONE
export async function assertNoPendingApproval(tx: Prisma.TransactionClient, taskId: string): Promise<void> {
  if (await tx.taskApproval.count({ where: { taskId, status: 'PENDING' } })) throw new AppError(409, PENDING_APPROVAL)
}
