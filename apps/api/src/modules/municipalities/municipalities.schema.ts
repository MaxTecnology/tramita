import { z } from 'zod'
import { ufSchema } from '@/lib/uf'

export const listMunicipalitiesQuerySchema = z.object({
  uf: ufSchema,
})

export type ListMunicipalitiesQuery = z.infer<typeof listMunicipalitiesQuerySchema>
