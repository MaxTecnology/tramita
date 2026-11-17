import type { BusinessDayRoll } from '@prisma/client'
import { isUf } from '@/lib/uf'

// Which due day applies to a client: the template's default, or the rule of the client's state
// (scope STATE) or city (scope CITY). A client the scope cannot place never falls back to the
// default date: the generation fails with the reason, and the office fixes the client.

export type DueRuleTemplate = {
  dueScope: 'FEDERAL' | 'STATE' | 'CITY'
  onlyListedLocations: boolean
  dueDayOfPeriod: number
  dueBusinessDayRoll: BusinessDayRoll
  dueRules: { uf: string | null; ibgeCityCode: number | null; dueDayOfPeriod: number; dueBusinessDayRoll: BusinessDayRoll }[]
}

export type ClientLocation = { name: string; estado: string | null; ibgeCityCode: number | null }

export type ResolvedDueRule =
  | { ok: true; dueDayOfPeriod: number; dueBusinessDayRoll: BusinessDayRoll }
  | { ok: false; message: string }

export function resolveDueRule(t: DueRuleTemplate, client: ClientLocation): ResolvedDueRule {
  const fallback: ResolvedDueRule = { ok: true, dueDayOfPeriod: t.dueDayOfPeriod, dueBusinessDayRoll: t.dueBusinessDayRoll }
  if (t.dueScope === 'FEDERAL') return fallback

  if (t.dueScope === 'STATE' && !isUf(client.estado)) return { ok: false, message: `Cliente ${client.name} sem estado cadastrado` }
  if (t.dueScope === 'CITY' && client.ibgeCityCode === null) return { ok: false, message: `Cliente ${client.name} sem cidade cadastrada` }

  const rule = t.dueScope === 'STATE'
    ? t.dueRules.find((r) => r.uf === client.estado)
    : t.dueRules.find((r) => r.ibgeCityCode === client.ibgeCityCode)
  if (rule) return { ok: true, dueDayOfPeriod: rule.dueDayOfPeriod, dueBusinessDayRoll: rule.dueBusinessDayRoll }
  if (t.onlyListedLocations) return { ok: false, message: `Cliente ${client.name} fora dos locais desta recorrência` }
  return fallback
}
