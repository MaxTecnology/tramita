import { describe, expect, it } from 'vitest'
import { resolveDepartmentSelection } from './requestDepartment'

const fiscal = { id: 'f', name: 'Fiscal' }
const folha = { id: 'l', name: 'Folha' }

describe('resolveDepartmentSelection', () => {
  it('pré-seleciona quando a empresa só tem um departamento acessível', () => {
    expect(resolveDepartmentSelection('', [fiscal])).toBe('f')
  })

  it('mantém a escolha quando ela continua válida', () => {
    expect(resolveDepartmentSelection('l', [fiscal, folha])).toBe('l')
  })

  it('limpa a escolha que não existe na empresa atual (troca de empresa)', () => {
    expect(resolveDepartmentSelection('x', [fiscal, folha])).toBe('')
  })
})
