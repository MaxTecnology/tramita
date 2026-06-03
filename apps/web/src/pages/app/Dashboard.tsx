import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Board } from '@/types'

interface BoardSummary extends Pick<Board, 'id' | 'title' | 'client' | 'columns'> {}

export default function Dashboard() {
  const { data: boards = [], isLoading } = useQuery<BoardSummary[]>({
    queryKey: ['boards'],
    queryFn: () => api.get('/boards').then((r) => r.data),
  })

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Dashboard</h1>

      {boards.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>Nenhum board cadastrado ainda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {boards.map((board) => {
            const allTasks = board.columns?.flatMap((c) => c.tasks ?? []) ?? []
            const doneTasks = allTasks.filter((t) => t.status === 'DONE').length
            const overdueTasks = allTasks.filter(
              (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'DONE',
            ).length
            const progress = allTasks.length > 0 ? Math.round((doneTasks / allTasks.length) * 100) : 0

            return (
              <Link key={board.id} to={`/app/board/${board.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardHeader>
                    <CardTitle className="text-base">{board.title}</CardTitle>
                    <p className="text-sm text-gray-500">{board.client?.name}</p>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-2">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Progresso</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                    {overdueTasks > 0 && (
                      <p className="text-xs text-red-500 font-medium mt-2">
                        ⚠ {overdueTasks} tarefa{overdueTasks > 1 ? 's' : ''} vencida{overdueTasks > 1 ? 's' : ''}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
