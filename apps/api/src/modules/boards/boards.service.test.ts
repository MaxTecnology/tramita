import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getBoardById, createBoard } from './boards.service'
import { createOSTemplate } from '@/modules/os-templates/os-templates.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient,
  createTestBoard, createTestColumn, createTestTask,
} from '@/test/helpers'

describe('getBoardById (visibilidade)', () => {
  it('esconde tarefas com visibleToClient=false quando hideInvisibleTasks=true', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const visibleTask = await createTestTask(col.id, user.id)
    const hiddenTask = await createTestTask(col.id, user.id)
    await prisma.task.update({ where: { id: hiddenTask.id }, data: { visibleToClient: false } })

    const asClient = await getBoardById(board.id, org.id, true)
    const taskIdsAsClient = asClient.columns.flatMap((c) => c.tasks).map((t) => t.id)
    expect(taskIdsAsClient).toContain(visibleTask.id)
    expect(taskIdsAsClient).not.toContain(hiddenTask.id)

    const asOrg = await getBoardById(board.id, org.id, false)
    const taskIdsAsOrg = asOrg.columns.flatMap((c) => c.tasks).map((t) => t.id)
    expect(taskIdsAsOrg).toContain(hiddenTask.id)
  })

  it('lança 404 quando um cliente tenta acessar o board de outro cliente na mesma org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id)
    const clientB = await createTestClient(org.id)
    const boardOfB = await createTestBoard(org.id, clientB.id)

    await expect(
      getBoardById(boardOfB.id, org.id, false, clientA.id),
    ).rejects.toMatchObject({ statusCode: 404 })

    // O próprio cliente B consegue acessar o próprio board normalmente
    await expect(
      getBoardById(boardOfB.id, org.id, true, clientB.id),
    ).resolves.toBeDefined()
  })
})

describe('createBoard', () => {
  it('sem osTemplateId usa as colunas DEFAULT_COLUMNS (sem regressão)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)

    const board = await createBoard(org.id, admin.id, 'ORG_ADMIN', {
      title: 'Processo sem template',
      clientId: client.id,
    })

    expect(board.osTemplateId).toBeNull()
    expect(board.columns).toHaveLength(3)
    expect(board.columns.map((c) => c.title)).toEqual(['Pendente', 'Em andamento', 'Concluído'])
    expect(board.columns.map((c) => c.statusEffect)).toEqual(['NONE', 'NONE', 'DONE'])
  })

  it('com osTemplateId cria as colunas a partir do template (título, statusEffect, notifyClient, documentos)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const template = await createOSTemplate(org.id, {
      name: 'Abertura de Empresa',
      isActive: true,
      columns: [
        {
          title: 'Documentação',
          statusEffect: 'NONE',
          notifyClient: false,
          documents: [{ name: 'RG' }, { name: 'CPF' }],
        },
        {
          title: 'Concluído',
          statusEffect: 'DONE',
          notifyClient: true,
          documents: [],
        },
      ],
    })

    const board = await createBoard(org.id, admin.id, 'ORG_ADMIN', {
      title: 'Processo com template',
      clientId: client.id,
      osTemplateId: template.id,
    })

    expect(board.osTemplateId).toBe(template.id)
    expect(board.type).toBe('OS')
    expect(board.columns).toHaveLength(2)
    expect(board.columns[0].title).toBe('Documentação')
    expect(board.columns[0].statusEffect).toBe('NONE')
    expect(board.columns[0].notifyClient).toBe(false)
    expect(board.columns[1].title).toBe('Concluído')
    expect(board.columns[1].statusEffect).toBe('DONE')
    expect(board.columns[1].notifyClient).toBe(true)

    const documents = await prisma.columnDocument.findMany({
      where: { columnId: board.columns[0].id },
      orderBy: { position: 'asc' },
    })
    expect(documents.map((d) => d.name)).toEqual(['RG', 'CPF'])
  })

  it('lança 404 quando osTemplateId aponta pra um template soft-deleted (isActive: false)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const template = await createOSTemplate(org.id, {
      name: 'Template descontinuado',
      isActive: true,
      columns: [{ title: 'Coluna', statusEffect: 'NONE', notifyClient: false, documents: [] }],
    })
    await prisma.oSTemplate.update({ where: { id: template.id }, data: { isActive: false } })

    await expect(
      createBoard(org.id, admin.id, 'ORG_ADMIN', {
        title: 'Board a partir de template inativo',
        clientId: client.id,
        osTemplateId: template.id,
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('lança 404 quando osTemplateId não pertence à organização', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const otherOrg = await createTestOrg(plan.id, { slug: 'other-org-template' })
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const templateOfOther = await createOSTemplate(otherOrg.id, {
      name: 'Template de outra org',
      isActive: true,
      columns: [{ title: 'Coluna', statusEffect: 'NONE', notifyClient: false, documents: [] }],
    })

    await expect(
      createBoard(org.id, admin.id, 'ORG_ADMIN', {
        title: 'X',
        clientId: client.id,
        osTemplateId: templateOfOther.id,
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
