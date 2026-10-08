import { prisma } from '@/lib/prisma'
import { getSignedDownloadUrl } from '@/lib/b2'
import { Prisma } from '@prisma/client'
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

// O próprio upsert ainda pode colidir sob concorrência real (o client do Prisma não garante
// INSERT...ON CONFLICT atômico em toda configuração/versão — confirmado empiricamente: duas
// requisições concorrentes na primeira leitura de um usuário às vezes disparam P2002 mesmo
// dentro do upsert). Quando isso acontece, a outra requisição concorrente já criou a linha —
// só precisamos buscar o que ela criou.
async function upsertSlaPreference(userId: string, data: Partial<UpdateSlaPreferenceBody>) {
  try {
    return await prisma.userSlaPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // A linha já existe (a outra requisição venceu a corrida) — reaplica como update puro,
      // nunca como leitura simples, senão um PATCH concorrente perderia os dados que pediu
      // pra mudar.
      return prisma.userSlaPreference.update({ where: { userId }, data })
    }
    throw err
  }
}

export async function getSlaPreference(userId: string) {
  return upsertSlaPreference(userId, {})
}

export async function updateSlaPreference(userId: string, data: UpdateSlaPreferenceBody) {
  return upsertSlaPreference(userId, data)
}
