import { useState } from 'react'
import { Bell, X } from 'lucide-react'

const DISMISS_KEY = 'sla-permission-banner-dismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

interface Props {
  onAccept: () => void
}

export function SlaPermissionBanner({ onAccept }: Props) {
  const [dismissed, setDismissed] = useState(readDismissed)
  if (dismissed) return null

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // Sem localStorage (modo privado, por ex.) — o dismiss só vale pra sessão atual.
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 flex-shrink-0 bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm text-blue-900">
      <div className="flex items-center gap-2">
        <Bell size={16} />
        <span>Ative notificações do navegador para receber alertas de prazo em tempo real.</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button onClick={onAccept} className="font-medium underline">Ativar</button>
        <button aria-label="Fechar" onClick={dismiss} className="text-blue-700">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
