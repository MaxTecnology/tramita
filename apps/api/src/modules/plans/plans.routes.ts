import type { FastifyInstance } from 'fastify'
import { AppError } from '@/errors/AppError'
import { listPlans, createPlan, updatePlan, softDeletePlan } from '@/modules/plans/plans.service'
import { createPlanSchema, updatePlanSchema } from '@/modules/plans/plans.schema'

export async function planRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    return reply.send(await listPlans())
  })

  app.post('/', async (request, reply) => {
    const result = createPlanSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createPlan(result.data))
  })

  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updatePlanSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updatePlan(id, result.data))
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await softDeletePlan(id))
  })
}
