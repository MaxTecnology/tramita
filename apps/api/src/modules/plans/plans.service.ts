import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreatePlanInput, UpdatePlanInput } from '@/modules/plans/plans.schema'

export async function listPlans() {
  return prisma.plan.findMany({ orderBy: { priceMonthly: 'asc' } })
}

export async function createPlan(data: CreatePlanInput) {
  return prisma.plan.create({ data })
}

export async function updatePlan(id: string, data: UpdatePlanInput) {
  const plan = await prisma.plan.findUnique({ where: { id } })
  if (!plan) throw new AppError(404, 'Plano não encontrado')
  return prisma.plan.update({ where: { id }, data })
}

export async function softDeletePlan(id: string) {
  const plan = await prisma.plan.findUnique({ where: { id } })
  if (!plan) throw new AppError(404, 'Plano não encontrado')
  return prisma.plan.update({ where: { id }, data: { isActive: false } })
}
