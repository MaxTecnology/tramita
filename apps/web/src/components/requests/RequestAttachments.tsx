import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Paperclip } from 'lucide-react'
import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import { UPLOAD_ACCEPT } from '@/lib/upload'
import type { RequestAttachment } from '@/types'

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function uploadRequestAttachment(requestId: string, file: File) {
  const data = new FormData()
  data.append('file', file)
  return api.post(`/portal/requests/${requestId}/attachments`, data)
}

// Files of a client request: the office downloads them; the client adds more while it is under
// evaluation (pending or waiting for information)
export function RequestAttachments({ requestId, attachments, canUpload }: { requestId: string; attachments: RequestAttachment[]; canUpload: boolean }) {
  const qc = useQueryClient()
  const upload = useMutation({
    mutationFn: (file: File) => uploadRequestAttachment(requestId, file),
    onSuccess: () => {
      toast.success('Arquivo anexado')
      qc.invalidateQueries({ queryKey: ['portal-requests'] })
    },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao anexar o arquivo')),
  })
  if (attachments.length === 0 && !canUpload) return null
  return (
    <div className="mt-2 space-y-1">
      {attachments.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-xs">
          <Paperclip size={12} className="text-muted-foreground flex-shrink-0" />
          <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-accent-hover hover:underline truncate">{a.filename}</a>
          <span className="text-muted-foreground flex-shrink-0">{formatSize(a.size)}</span>
        </div>
      ))}
      {canUpload && (
        <label className="inline-flex items-center gap-1 text-xs text-accent-hover hover:underline cursor-pointer">
          <Paperclip size={12} />
          {upload.isPending ? 'Enviando...' : 'Anexar arquivo'}
          <input type="file" accept={UPLOAD_ACCEPT} className="sr-only" aria-label="Anexar arquivo" disabled={upload.isPending}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = '' }} />
        </label>
      )}
    </div>
  )
}
