import { renderHook, waitFor, act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppDialogs } from '@/components/ui/app-dialogs'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useBoard } from '@/hooks/useBoard'
import type { Board } from '@/types'

const mockBoard: Board = {
  id: 'board-1',
  title: 'Processo ABC',
  description: null,
  clientId: 'c1',
  organizationId: 'o1',
  responsibleUserId: null,
  responsibleUser: null,
  isActive: true,
  dueDate: null,
  type: 'PROCESS',
  client: { id: 'c1', name: 'Empresa ABC', codigo: null },
  columns: [
    {
      id: 'col-1',
      title: 'Backlog',
      position: 0,
      statusEffect: 'NONE',
      notifyClient: false,
      color: null,
      boardId: 'board-1',
      tasks: [
        {
          id: 't1',
          title: 'Tarefa 1',
          position: 0,
          columnId: 'col-1',
          priority: 'MEDIUM',
          status: 'OPEN',
          tags: [],
          creatorId: 'u1',
          assigneeId: null,
          dueDate: null,
          description: null,
          sourceRequestId: null,
          departmentId: null,
          competence: null,
          targetDate: null,
          recurringTemplateId: null,
          visibleToClient: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
    {
      id: 'col-2',
      title: 'Concluído',
      position: 1,
      statusEffect: 'DONE',
      notifyClient: false,
      color: null,
      boardId: 'board-1',
      tasks: [],
    },
  ],
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

it('returns board data from API', async () => {
  server.use(
    http.get('http://localhost:3000/boards/board-1', () => HttpResponse.json(mockBoard)),
  )

  const { result } = renderHook(() => useBoard('board-1'), { wrapper })

  await waitFor(() => expect(result.current.board).toBeDefined())
  expect(result.current.board!.columns).toHaveLength(2)
  expect(result.current.board!.columns[0].tasks).toHaveLength(1)
})

it('reverts optimistic update on moveTask error', async () => {
  server.use(
    http.get('http://localhost:3000/boards/board-1', () => HttpResponse.json(mockBoard)),
    http.patch('http://localhost:3000/tasks/t1/move', () =>
      HttpResponse.json({ message: 'error' }, { status: 500 }),
    ),
  )

  const { result } = renderHook(() => useBoard('board-1'), { wrapper })
  await waitFor(() => expect(result.current.board).toBeDefined())

  act(() => {
    result.current.moveTask({ taskId: 't1', columnId: 'col-2', position: 0 })
  })

  // After error, task should revert to col-1
  await waitFor(() => {
    const col1 = result.current.board?.columns.find((c) => c.id === 'col-1')
    expect(col1?.tasks.some((t) => t.id === 't1')).toBe(true)
  })
})

it('moving a late OS to the done column asks the reason and moves with it', async () => {
  const bodies: unknown[] = []
  server.use(
    http.get('http://localhost:3000/boards/board-1', () => HttpResponse.json(mockBoard)),
    http.get('http://localhost:3000/delay-reasons', () => HttpResponse.json([{ id: 'r1', name: 'Aguardando órgão público', requiresNote: false, isActive: true, position: 0 }])),
    http.patch('http://localhost:3000/tasks/t1/move', async ({ request }) => {
      bodies.push(await request.json())
      return bodies.length === 1
        ? HttpResponse.json({ message: 'Informe o motivo do atraso' }, { status: 422 })
        : HttpResponse.json({})
    }),
  )
  render(<AppDialogs />)
  const { result } = renderHook(() => useBoard('board-1'), { wrapper })
  await waitFor(() => expect(result.current.board).toBeDefined())
  act(() => { result.current.moveTask({ taskId: 't1', columnId: 'col-2', position: 0 }) })
  await userEvent.selectOptions(await screen.findByLabelText('Motivo'), 'r1')
  await userEvent.click(screen.getByRole('button', { name: 'Concluir' }))
  await waitFor(() => expect(bodies.at(-1)).toEqual({ columnId: 'col-2', position: 0, delayReasonId: 'r1' }))
})
