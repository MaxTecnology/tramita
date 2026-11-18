import { prisma } from '@/lib/prisma'
import type { Municipality } from './municipalities.types'

// Compares names the way people type them: no accents, no case, single spaces
function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

export async function listMunicipalities(uf: string): Promise<{ ibgeCode: number; name: string }[]> {
  const cities = await prisma.municipality.findMany({ where: { uf }, select: { ibgeCode: true, name: true } })
  return cities.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

export async function findMunicipality(ibgeCode: number): Promise<Municipality | null> {
  return prisma.municipality.findUnique({ where: { ibgeCode } })
}

export async function findMunicipalityByName(name: string, uf: string): Promise<Municipality | null> {
  // Usually the name comes spelled as in the table, case aside: one indexed query
  const exact = await prisma.municipality.findFirst({ where: { uf, name: { equals: name.trim(), mode: 'insensitive' } } })
  if (exact) return exact
  // Accents or spacing differ ("SAO CRISTOVAO"): compare normalized names within the state
  const wanted = normalizeName(name)
  const cities = await prisma.municipality.findMany({ where: { uf } })
  return cities.find((c) => normalizeName(c.name) === wanted) ?? null
}
