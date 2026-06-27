import { render, screen } from '@testing-library/react'
import { TaskCard } from '@/components/TaskCard'
import type { Task } from '@/types'

const baseTask: Task = {
  id: '1',
  title: 'Abertura LTDA',
  priority: 'HIGH',
  status: 'OPEN',
  position: 0,
  columnId: 'col1',
  tags: [],
  creatorId: 'u1',
  assigneeId: null,
  dueDate: null,
  description: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  sourceRequestId: null,
}

it('renders task title', () => {
  render(<TaskCard task={baseTask} onClick={() => {}} />)
  expect(screen.getByText('Abertura LTDA')).toBeInTheDocument()
})

it('renders priority badge with correct color class for HIGH', () => {
  render(<TaskCard task={baseTask} onClick={() => {}} />)
  const badge = screen.getByText('Alta')
  expect(badge).toHaveClass('bg-orange-100')
})

it('highlights overdue task when dueDate is in the past and status is not DONE', () => {
  const overdueTask: Task = { ...baseTask, dueDate: '2020-01-01T00:00:00.000Z' }
  const { container } = render(<TaskCard task={overdueTask} onClick={() => {}} />)
  expect(container.firstChild).toHaveClass('border-red-400')
})

it('does not highlight completed task even if dueDate is in the past', () => {
  const doneTask: Task = { ...baseTask, dueDate: '2020-01-01T00:00:00.000Z', status: 'DONE' }
  const { container } = render(<TaskCard task={doneTask} onClick={() => {}} />)
  expect(container.firstChild).not.toHaveClass('border-red-400')
})

it('exibe badge de solicitação quando sourceRequestId está preenchido', () => {
  render(<TaskCard task={{ ...baseTask, sourceRequestId: 'req-123' }} onClick={() => {}} />)
  expect(screen.getByText('Solicitação')).toBeInTheDocument()
})
