import { describe, expect, it } from 'vitest'
import { computeClientFormStatus, EMPTY_COMPANY, type ClientFormState } from './clientFormStatus'

const names = new Map([['fiscal', 'Fiscal'], ['folha', 'Folha']])

const pj = {
  ...EMPTY_COMPANY, name: 'ACME LTDA', codigo: '1', clientType: 'PJ' as const, cnpj: '11.222.333/0001-81',
  cep: '57312675', estado: 'AL', cidade: 'Arapiraca', bairro: 'Centro', logradouro: 'Rua A', numero: '10',
}

function form(overrides: Partial<ClientFormState> = {}): ClientFormState {
  return {
    company: pj,
    departments: [{ departmentId: 'fiscal', responsibleUserId: 'u1' }],
    clientUsers: [{ name: 'Ana', email: 'a@a.com', password: 'Senha@1234', phone: '82999991234', departmentIds: ['fiscal'] }],
    ...overrides,
  }
}

describe('computeClientFormStatus', () => {
  it('formulário completo pode salvar', () => {
    const status = computeClientFormStatus(form(), names)
    expect(status).toMatchObject({ empresa: true, departamentos: true, acesso: true, canSave: true })
    expect(status.coverage).toEqual([
      { departmentId: 'fiscal', departmentName: 'Fiscal', userCount: 1, withPhoneCount: 1, status: 'ok' },
    ])
  })

  it('PJ sem CNPJ válido ou sem endereço deixa a aba Empresa incompleta', () => {
    expect(computeClientFormStatus(form({ company: { ...pj, cnpj: '11222333000180' } }), names).empresa).toBe(false)
    expect(computeClientFormStatus(form({ company: { ...pj, cidade: '' } }), names).empresa).toBe(false)
    expect(computeClientFormStatus(form({ company: { ...pj, codigo: ' ' } }), names).empresa).toBe(false)
  })

  it('PF não exige endereço, mas exige CPF válido', () => {
    const pf = { ...EMPTY_COMPANY, name: 'Fulano', codigo: '2', clientType: 'PF' as const, cpf: '529.982.247-25' }
    expect(computeClientFormStatus(form({ company: pf }), names).empresa).toBe(true)
    expect(computeClientFormStatus(form({ company: { ...pf, cpf: '11111111111' } }), names).empresa).toBe(false)
  })

  it('sem departamento marcado, ou departamento sem responsável, deixa a aba Departamentos incompleta', () => {
    expect(computeClientFormStatus(form({ departments: [] }), names).departamentos).toBe(false)
    expect(computeClientFormStatus(form({ departments: [{ departmentId: 'fiscal', responsibleUserId: '' }] }), names).departamentos).toBe(false)
  })

  it('departamento sem usuário fica vermelho e bloqueia', () => {
    const status = computeClientFormStatus(
      form({ departments: [{ departmentId: 'fiscal', responsibleUserId: 'u1' }, { departmentId: 'folha', responsibleUserId: 'u1' }] }),
      names,
    )
    expect(status.coverage.find((r) => r.departmentId === 'folha')?.status).toBe('sem_usuario')
    expect(status.acesso).toBe(false)
    expect(status.canSave).toBe(false)
  })

  it('departamento só com usuários sem telefone fica amarelo mas não bloqueia', () => {
    const status = computeClientFormStatus(
      form({ clientUsers: [{ existingId: 'cu1', name: 'Ana', email: 'a@a.com', phone: null, departmentIds: ['fiscal'] }] }),
      names,
    )
    expect(status.coverage[0].status).toBe('sem_whatsapp')
    expect(status.acesso).toBe(true)
    expect(status.canSave).toBe(true)
  })

  it('usuário inativo não cobre o departamento', () => {
    const status = computeClientFormStatus(
      form({ clientUsers: [{ existingId: 'cu1', name: 'Ana', email: 'a@a.com', phone: '82999991234', isActive: false, departmentIds: ['fiscal'] }] }),
      names,
    )
    expect(status.coverage[0].status).toBe('sem_usuario')
    expect(status.canSave).toBe(false)
  })
})
