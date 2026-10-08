import { useState } from 'react'
import { Bell, X } from 'lucide-react'

interface Props {
  onAccept: () => void
}

export function SlaPermissionBanner({ onAccept }: Props) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div className="flex items-center justify-between gap-3 bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm text-blue-900">
      <div className="flex items-center gap-2">
        <Bell size={16} />
        <span>Ative notificações do navegador para receber alertas de prazo em tempo real.</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button onClick={onAccept} className="font-medium underline">Ativar</button>
        <button aria-label="Fechar" onClick={() => setDismissed(true)} className="text-blue-700">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
