import { describe, it, expect } from 'vitest'
import { resolveDueRule, type DueRuleTemplate } from './recurrence-location'

const template = (over: Partial<DueRuleTemplate> = {}): DueRuleTemplate => ({
  dueScope: 'STATE', onlyListedLocations: false, dueDayOfPeriod: 20, dueBusinessDayRoll: 'NONE',
  dueRules: [
    { uf: 'SE', ibgeCityCode: null, dueDayOfPeriod: 15, dueBusinessDayRoll: 'FORWARD' },
    { uf: null, ibgeCityCode: 2800308, dueDayOfPeriod: 10, dueBusinessDayRoll: 'BACKWARD' },
  ],
  ...over,
})
const se = { name: 'Padaria', estado: 'SE', ibgeCityCode: 2800308 }
const al = { name: 'Mercado', estado: 'AL', ibgeCityCode: 2704302 }

describe('resolveDueRule', () => {
  it('federal ignores where the client is', () => {
    expect(resolveDueRule(template({ dueScope: 'FEDERAL' }), { name: 'X', estado: null, ibgeCityCode: null }))
      .toEqual({ ok: true, dueDayOfPeriod: 20, dueBusinessDayRoll: 'NONE' })
  })

  it('state: the rule of the client UF, or the default', () => {
    expect(resolveDueRule(template(), se)).toEqual({ ok: true, dueDayOfPeriod: 15, dueBusinessDayRoll: 'FORWARD' })
    expect(resolveDueRule(template(), al)).toEqual({ ok: true, dueDayOfPeriod: 20, dueBusinessDayRoll: 'NONE' })
  })

  it('city: the rule of the client city, or the default', () => {
    expect(resolveDueRule(template({ dueScope: 'CITY' }), se)).toEqual({ ok: true, dueDayOfPeriod: 10, dueBusinessDayRoll: 'BACKWARD' })
    expect(resolveDueRule(template({ dueScope: 'CITY' }), al)).toEqual({ ok: true, dueDayOfPeriod: 20, dueBusinessDayRoll: 'NONE' })
  })

  it('only listed places: a client elsewhere gets no date', () => {
    expect(resolveDueRule(template({ onlyListedLocations: true }), al)).toEqual({ ok: false, message: 'Cliente Mercado fora dos locais desta recorrência' })
    expect(resolveDueRule(template({ onlyListedLocations: true }), se)).toMatchObject({ ok: true, dueDayOfPeriod: 15 })
  })

  it('a client without a valid state or city never gets the default date by mistake', () => {
    expect(resolveDueRule(template(), { ...se, estado: null })).toEqual({ ok: false, message: 'Cliente Padaria sem estado cadastrado' })
    expect(resolveDueRule(template(), { ...se, estado: 'Sergipe' })).toEqual({ ok: false, message: 'Cliente Padaria com estado inválido no cadastro (edite o cliente)' })
    expect(resolveDueRule(template(), { ...se, estado: 'se' })).toEqual({ ok: false, message: 'Cliente Padaria com estado inválido no cadastro (edite o cliente)' })
    expect(resolveDueRule(template({ dueScope: 'CITY' }), { ...se, ibgeCityCode: null })).toEqual({ ok: false, message: 'Cliente Padaria sem cidade cadastrada' })
  })
})
