import { prisma } from '@/lib/prisma'
import { getSignedDownloadUrl } from '@/lib/b2'
import type { UpdateSlaPreferenceBody } from './sla.schema'

export async function getPublicSlaConfig(organizationId: string) {
  const config = await prisma.notificationConfig.findUnique({
    where: { organizationId },
    select: {
      slaTargetWarningDays: true,
      slaDueCriticalDays: true,
      customSlaSoundLabel: true,
      customSlaSoundKey: true,
    },
  })
  return {
    slaTargetWarningDays: config?.slaTargetWarningDays ?? 3,
    slaDueCriticalDays: config?.slaDueCriticalDays ?? 1,
    hasCustomSound: !!config?.customSlaSoundKey,
    customSlaSoundLabel: config?.customSlaSoundLabel ?? null,
  }
}

export async function getCustomSoundUrl(organizationId: string): Promise<string | null> {
  const config = await prisma.notificationConfig.findUnique({
    where: { organizationId },
    select: { customSlaSoundKey: true },
  })
  if (!config?.customSlaSoundKey) return null
  return getSignedDownloadUrl(config.customSlaSoundKey)
}

export async function getSlaPreference(userId: string) {
  const existing = await prisma.userSlaPreference.findUnique({ where: { userId } })
  if (existing) return existing
  // Cria com defaults na primeira leitura — evita exigir um passo de "setup inicial" no onboarding.
  return prisma.userSlaPreference.create({ data: { userId } })
}

export async function updateSlaPreference(userId: string, data: UpdateSlaPreferenceBody) {
  await getSlaPreference(userId) // garante que a linha existe antes do update
  return prisma.userSlaPreference.update({ where: { userId }, data })
}
