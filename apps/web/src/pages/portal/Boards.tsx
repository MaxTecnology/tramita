import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'

interface BoardSummary {
  id: string
  title: string
  client: { id: string; name: string }
}

export default function PortalBoards() {
  const { data: boards = [], isLoading } = useQuery<BoardSummary[]>({
    queryKey: ['portal-boards'],
    queryFn: () => api.get('/boards').then((r) => r.data),
  })

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Meus Processos</h1>

      {boards.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p>Nenhum processo encontrado.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {boards.map((board) => (
            <Link
              key={board.id}
              to={`/portal/board/${board.id}`}
              className="block rounded-lg border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
            >
              <h2 className="text-base font-semibold text-gray-900">{board.title}</h2>
              <p className="text-sm text-blue-600 mt-1">Ver detalhes →</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
