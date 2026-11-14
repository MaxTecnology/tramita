import { Upload } from 'lucide-react'
import { UPLOAD_ACCEPT } from '@/lib/upload'

// File input that looks like a button (the native "Escolher arquivo" looks like plain text)
export function FilePicker({ label, file, onChange, accept = UPLOAD_ACCEPT }: {
  label: string
  file: File | null
  onChange: (file: File | null) => void
  accept?: string
}) {
  return (
    <div className="text-xs text-muted-foreground">
      <span className="block mb-1">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-neutral-bg focus-within:ring-2 focus-within:ring-accent">
          <Upload size={14} />
          {file ? 'Trocar arquivo' : 'Escolher arquivo'}
          <input aria-label={label} type="file" accept={accept} className="sr-only" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
        </label>
        <span className={file ? 'text-foreground truncate max-w-[16rem]' : ''}>{file ? file.name : 'Nenhum arquivo escolhido'}</span>
      </div>
    </div>
  )
}
