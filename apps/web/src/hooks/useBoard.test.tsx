import { renderHook, waitFor, act } from '@testing-library/react'
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
  client: { id: 'c1', name: 'Empresa ABC' },
  columns: [
    {
      id: 'col-1',
      title: 'Backlog',
      position: 0,
      isFinal: false,
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
    {
      id: 'col-2',
      title: 'Concluído',
      position: 1,
      isFinal: true,
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
