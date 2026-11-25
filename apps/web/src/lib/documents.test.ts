import { describe, expect, it } from 'vitest'
import { formatDocument, digitsOf } from './documents'

describe('CPF e CNPJ na tela', () => {
  it('formats CNPJ and CPF with their punctuation', () => {
    expect(formatDocument('55103303000121')).toBe('55.103.303/0001-21')
    expect(formatDocument('52998224725')).toBe('529.982.247-25')
  })
  it('keeps what is already formatted or incomplete as it is', () => {
    expect(formatDocument('55.103.303/0001-21')).toBe('55.103.303/0001-21')
    expect(formatDocument('123')).toBe('123')
    expect(formatDocument(null)).toBe('')
  })
  it('digitsOf drops the punctuation (search by either form)', () => {
    expect(digitsOf('55.103.303/0001-21')).toBe('55103303000121')
  })
})
