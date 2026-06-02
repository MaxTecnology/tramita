// apps/api/src/lib/template.test.ts
import { describe, it, expect } from 'vitest'
import { renderTemplate, getTemplate, type TemplateVars } from '@/lib/template'
import { DEFAULT_TEMPLATES } from '@/lib/default-templates'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg } from '@/test/helpers'

const BASE_VARS: TemplateVars = {
  clientName: 'João Silva',
  orgName: 'Escritório G2A',
  taskTitle: 'Abertura de LTDA',
  portalUrl: 'https://tramita.autohubs.com.br/portal',
}

describe('renderTemplate', () => {
  it('substitutes all provided variables', () => {
    const body = 'Olá, {{clientName}}! Processo *{{taskTitle}}* movido para *{{toColumn}}*.'
    const result = renderTemplate(body, { ...BASE_VARS, toColumn: 'Em Revisão' })
    expect(result).toBe('Olá, João Silva! Processo *Abertura de LTDA* movido para *Em Revisão*.')
  })

  it('replaces missing variable with empty string', () => {
    const body = 'Prazo: {{dueDate}}'
    expect(renderTemplate(body, BASE_VARS)).toBe('Prazo: ')
  })

  it('keeps body unchanged when it has no variables', () => {
    const body = 'Texto fixo sem variáveis.'
    expect(renderTemplate(body, BASE_VARS)).toBe('Texto fixo sem variáveis.')
  })
})

describe('DEFAULT_TEMPLATES', () => {
  it('TASK_MOVED WHATSAPP body contains {{fromColumn}} and {{toColumn}}', () => {
    const body = DEFAULT_TEMPLATES.TASK_MOVED.WHATSAPP!.body
    expect(body).toContain('{{fromColumn}}')
    expect(body).toContain('{{toColumn}}')
  })
})

describe('getTemplate', () => {
  it('returns custom template when org has one configured', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await prisma.messageTemplate.create({
      data: {
        organizationId: org.id,
        event: 'TASK_MOVED',
        channel: 'WHATSAPP',
        body: 'Template customizado para {{clientName}}',
      },
    })

    const result = await getTemplate(org.id, 'TASK_MOVED', 'WHATSAPP')
    expect(result.body).toBe('Template customizado para {{clientName}}')
  })

  it('returns default template when org has no custom template', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)

    const result = await getTemplate(org.id, 'TASK_MOVED', 'WHATSAPP')
    expect(result.body).toBe(DEFAULT_TEMPLATES.TASK_MOVED.WHATSAPP!.body)
  })
})
