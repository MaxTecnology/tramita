import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { ClipboardList, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Task {
  id: string
  status: string
  columnId: string
}

interface Column {
  id: string
  title: string
  position: number
  tasks: Task[]
}

interface BoardSummary {
  id: string
  title: string
  client: { id: string; name: string }
  dueDate: string | null
  columns: Column[]
}

function getProgress(board: BoardSummary): number {
  const tasks = board.columns
    .flatMap((c) => c.tasks)
    .filter((t) => t.status !== 'CANCELLED')
  if (tasks.length === 0) return 0
  const maxPos = board.columns.length - 1
  if (maxPos <= 0) return 0
  const sum = tasks.reduce((acc, t) => {
    const col = board.columns.find((c) => c.id === t.columnId)
    return acc + (col?.position ?? 0) / maxPos
  }, 0)
  return Math.round((sum / tasks.length) * 100)
}

function getCurrentStage(board: BoardSummary): string {
  const active = board.columns.find((c) =>
    c.tasks.some((t) => t.status !== 'DONE' && t.status !== 'CANCELLED'),
  )
  return active?.title ?? board.columns.at(-1)?.title ?? '—'
}

export default function PortalBoards() {
  const { data: boards = [], isLoading } = useQuery<BoardSummary[]>({
    queryKey: ['portal-boards'],
    queryFn: () => api.get('/boards').then((r) => r.data),
  })

  if (isLoading) return <div className="p-6 text-gray-500 text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-lg md:text-xl font-bold text-gray-900">Meus Processos</h1>

      {boards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-gray-400">
          <ClipboardList size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhum processo encontrado</p>
          <p className="text-xs mt-1">Seu escritório ainda não abriu processos para você.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {boards.map((board) => {
            const progress = getProgress(board)
            const stage = getCurrentStage(board)
            const isOverdue = board.dueDate ? new Date(board.dueDate) < new Date() : false

            return (
              <Link
                key={board.id}
                to={`/portal/board/${board.id}`}
                className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-gray-900 leading-snug flex-1 min-w-0">{board.title}</h2>
                  <ArrowRight size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full truncate">{stage}</span>
                  {board.dueDate && (
                    <span className={cn('text-xs ml-auto flex-shrink-0', isOverdue ? 'text-red-500 font-medium' : 'text-gray-400')}>
                      {isOverdue ? '⚠ ' : ''}{new Date(board.dueDate).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', progress >= 80 ? 'bg-green-500' : 'bg-[#185FA5]')}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-8 text-right flex-shrink-0">{progress}%</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
