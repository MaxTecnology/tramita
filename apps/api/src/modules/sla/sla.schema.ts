import { z } from 'zod'

const SOUND_OPTIONS = ['CHIME', 'BELL', 'SOFT_PING', 'MUTE', 'ORG_CUSTOM'] as const

export const updateSlaPreferenceSchema = z.object({
  targetWarningSound: z.enum(SOUND_OPTIONS).optional(),
  targetWarningVolume: z.number().int().min(0).max(100).optional(),
  dueCriticalSound: z.enum(SOUND_OPTIONS).optional(),
  dueCriticalVolume: z.number().int().min(0).max(100).optional(),
})

export type UpdateSlaPreferenceBody = z.infer<typeof updateSlaPreferenceSchema>
