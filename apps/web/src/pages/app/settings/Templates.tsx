import { useState } from 'react'
import { TemplateEditor } from '@/components/TemplateEditor'

const EVENTS = ['TASK_CREATED', 'TASK_MOVED', 'TASK_COMPLETED', 'TASK_COMMENT_ADDED', 'TASK_DUE_DATE_APPROACHING'] as const
const CHANNELS = ['WHATSAPP', 'EMAIL'] as const

const EVENT_LABEL: Record<string, string> = {
  TASK_CREATED: 'Tarefa criada',
  TASK_MOVED: 'Tarefa movida',
  TASK_COMPLETED: 'Tarefa concluída',
  TASK_COMMENT_ADDED: 'Comentário adicionado',
  TASK_DUE_DATE_APPROACHING: 'Prazo se aproximando',
}

export default function Templates() {
  const [event, setEvent] = useState<string>('TASK_MOVED')
  const [channel, setChannel] = useState<string>('WHATSAPP')

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Templates de Mensagem</h1>

      <div className="flex gap-4 mb-6">
        <div className="flex-1">
          <label className="text-sm font-medium text-gray-700">Evento</label>
          <select
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
          >
            {EVENTS.map((e) => (
              <option key={e} value={e}>{EVENT_LABEL[e]}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-sm font-medium text-gray-700">Canal</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <TemplateEditor event={event} channel={channel} />
    </div>
  )
}
