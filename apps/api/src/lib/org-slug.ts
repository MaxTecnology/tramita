import { prisma } from './prisma'

// Usado pra compor storageKey (attachments, document-reader) com algo legível em vez do cuid cru.
export async function getOrgSlug(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { slug: true } })
  return org?.slug ?? organizationId
}
