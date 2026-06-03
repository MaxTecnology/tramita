import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

interface CommentAuthor {
  id: string
  name: string
}

interface Comment {
  id: string
  content: string
  authorType: 'USER' | 'CLIENT'
  user: CommentAuthor | null
  client: CommentAuthor | null
  createdAt: string
}

interface Props {
  taskId: string
}

export function Comments({ taskId }: Props) {
  const queryClient = useQueryClient()
  const [content, setContent] = useState('')

  const { data: comments = [] } = useQuery<Comment[]>({
    queryKey: ['comments', taskId],
    queryFn: () => api.get(`/tasks/${taskId}/comments`).then((r) => r.data),
  })

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/tasks/${taskId}/comments`, { content }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', taskId] })
      setContent('')
    },
  })

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {comments.map((c) => {
          const author = c.authorType === 'CLIENT' ? c.client : c.user
          return (
            <div key={c.id} className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-semibold text-blue-700 flex-shrink-0">
                {author?.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-700">{author?.name}</p>
                <p className="text-sm text-gray-800 mt-0.5">{c.content}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(c.createdAt).toLocaleString('pt-BR')}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 items-start">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Adicionar comentário..."
          rows={2}
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
        />
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !content.trim()}
          size="sm"
        >
          Enviar
        </Button>
      </div>
    </div>
  )
}
