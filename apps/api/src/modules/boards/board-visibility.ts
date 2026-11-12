import type { Prisma } from '@prisma/client'

// What an ORG_MEMBER can see: processes they own, processes of clients they serve as a
// department responsible (ClientAssignment), and processes where they have a task assigned.
// Admins and managers see the whole organization; clients have their own access scope.
export function memberBoardWhere(userId: string): Prisma.BoardWhereInput {
  return {
    OR: [
      { responsibleUserId: userId },
      { client: { clientAssignments: { some: { userId } } } },
      { columns: { some: { tasks: { some: { assigneeId: userId } } } } },
    ],
  }
}
