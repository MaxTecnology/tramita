import { prisma } from '@/lib/prisma'

export interface ClientRecipient {
  id: string
  name: string
  email: string
  phone: string | null
}

// Destinatários de notificação ao cliente: usuários do portal ativos com acesso ao departamento do
// assunto naquela empresa — mesma regra pro e-mail e pro WhatsApp (um assunto da Folha nunca vai
// pra quem só cuida do Fiscal).
export async function resolveClientRecipients(clientId: string, departmentId: string): Promise<ClientRecipient[]> {
  return prisma.clientUser.findMany({
    where: { isActive: true, accesses: { some: { clientId, departmentId } } },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { name: 'asc' },
  })
}
