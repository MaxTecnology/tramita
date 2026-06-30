import type { FastifyInstance } from 'fastify'
import { AppError } from '@/errors/AppError'
import {
  listOrganizations, getOrganization, updateOrganization,
  register, listPublicPlans, getOrgSubscription, changePlan,
  createOrganizationByMaster,
} from '@/modules/organizations/organizations.service'
import {
  updateOrgSchema, registerOrgSchema, changePlanSchema, createOrgByMasterSchema,
} from '@/modules/organizations/organizations.schema'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'

// ── /master/organizations/* ───────────────────────────────────────────────────
export async function masterOrgRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => reply.send(await listOrganizations()))

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getOrganization(id))
  })

  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateOrgSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateOrganization(id, result.data))
  })

  app.post('/', async (request, reply) => {
    const result = createOrgByMasterSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createOrganizationByMaster(result.data))
  })
}

// ── /organizations/* (público, sem auth) ─────────────────────────────────────
export async function publicOrgRoutes(app: FastifyInstance) {
  app.get('/plans', async (_req, reply) => {
    return reply.send(await listPublicPlans())
  })

  app.post('/register', async (request, reply) => {
    const result = registerOrgSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await register(result.data))
  })
}

// ── /org/* (ORG_ADMIN only) ───────────────────────────────────────────────────
export async function orgRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('ORG_ADMIN'))

  app.get('/subscription', async (request, reply) => {
    return reply.send(await getOrgSubscription(request.user.organizationId!))
  })

  app.post('/subscription/change-plan', async (request, reply) => {
    const result = changePlanSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    await changePlan(request.user.organizationId!, result.data.planId)
    return reply.status(204).send()
  })
}
