// apps/web/src/pages/app/settings/DocumentModelForm.tsx
import { useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import type { DocumentoExtraido, DocumentoExtraidoItem } from '@/types'

function mensagemDeErro(err: unknown, padrao: string): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? padrao
}

export default function DocumentModelForm() {
  const { id } = useParams<{ id: string }>()
  const isEditing = !!id
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [extraido, setExtraido] = useState<DocumentoExtraido | null>(null)
  const [pagina, setPagina] = useState(0)

  const analisarMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post<DocumentoExtraido>('/document-reader/modelos/analisar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data)
    },
    onSuccess: (data) => { setExtraido(data); setPagina(0) },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao ler o PDF')),
  })

  const paginaAtual = extraido?.paginas[pagina]

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <Link to="/app/settings/document-models" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
        <ArrowLeft size={12} /> Modelos de Documento
      </Link>
      <h1 className="text-lg md:text-xl font-bold text-foreground mb-4">
        {isEditing ? 'Editar modelo' : 'Novo modelo'}
      </h1>

      {!extraido ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Suba um PDF de amostra do documento que o robô vai aprender a reconhecer. O arquivo não
            é salvo — só usamos o texto dele pra você marcar os campos.
          </p>
          <Button onClick={() => fileInputRef.current?.click()} disabled={analisarMutation.isPending}>
            {analisarMutation.isPending ? 'Lendo...' : 'Escolher PDF de amostra'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) analisarMutation.mutate(file)
              e.target.value = ''
            }}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {extraido.paginas.length > 1 && (
            <div className="flex gap-2 items-center text-sm">
              <span className="text-muted-foreground">Página:</span>
              {extraido.paginas.map((p, i) => (
                <button
                  key={p.numero}
                  onClick={() => setPagina(i)}
                  className={`px-2 py-1 rounded ${i === pagina ? 'bg-accent text-accent-foreground' : 'bg-neutral-bg text-muted-foreground'}`}
                >
                  {p.numero}
                </button>
              ))}
            </div>
          )}

          <div
            className="relative w-full bg-surface border border-border rounded-md overflow-hidden"
            style={{ aspectRatio: paginaAtual?.largura && paginaAtual?.altura ? `${paginaAtual.largura} / ${paginaAtual.altura}` : '210 / 297' }}
          >
            {paginaAtual?.itens.map((item: DocumentoExtraidoItem, i: number) => (
              <div
                key={i}
                className="absolute text-[8px] leading-none text-foreground whitespace-nowrap overflow-hidden cursor-pointer hover:bg-accent/20 rounded-sm"
                style={{
                  left: `${item.x * 100}%`,
                  top: `${item.y * 100}%`,
                  width: `${item.w * 100}%`,
                  height: `${item.h * 100}%`,
                }}
                title={item.str}
              >
                {item.str}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
