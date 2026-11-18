import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import { changeTaskStatus, waitsForAnotherOS } from './tasksStatusChange'
import type { Task } from '@/types'

const API = 'http://localhost:3000'
const choiceMock = vi.fn()
vi.mock('@/components/ui/app-dialogs', () => ({ askChoice: (o: unknown) => choiceMock(o) }))

let sent: Record<string, unknown>[] = []
beforeEach(() => {
  sent = []
  choiceMock.mockReset()
  server.use(
    http.get(`${API}/delay-reasons`, () => HttpResponse.json([{ id: 'r1', name: 'Cliente atrasou', isActive: true, requiresNote: false }])),
    http.patch(`${API}/tasks/t1`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      sent.push(body)
      if (body.status === 'DONE' && !body.delayReasonId) return HttpResponse.json({ message: 'Informe o motivo do atraso' }, { status: 422 })
      return HttpResponse.json({ id: 't1', ...body })
    }),
  )
})

describe('mudar status pelo Kanban', () => {
  it('finishing a late OS asks the reason and sends it, like the task panel', async () => {
    choiceMock.mockResolvedValue({ value: 'r1' })
    expect(await changeTaskStatus('t1', 'DONE')).toBe(true)
    expect(sent).toEqual([{ status: 'DONE' }, { status: 'DONE', delayReasonId: 'r1' }])
  })

  it('giving up the reason changes nothing', async () => {
    choiceMock.mockResolvedValue(null)
    expect(await changeTaskStatus('t1', 'DONE')).toBe(false)
    expect(sent).toEqual([{ status: 'DONE' }])
  })

  it('other statuses go straight', async () => {
    expect(await changeTaskStatus('t1', 'STARTED')).toBe(true)
    expect(choiceMock).not.toHaveBeenCalled()
  })

  it('an OS waiting for another one cannot change status (it starts when released)', () => {
    const base = { status: 'OPEN', osModelId: 'm1', releasedAt: null } as Pick<Task, 'status' | 'osModelId' | 'releasedAt'>
    expect(waitsForAnotherOS(base)).toBe(true)
    expect(waitsForAnotherOS({ ...base, releasedAt: '2026-11-01' })).toBe(false)
    expect(waitsForAnotherOS({ ...base, osModelId: null })).toBe(false)
    expect(waitsForAnotherOS({ ...base, status: 'DONE' })).toBe(false)
  })
})
