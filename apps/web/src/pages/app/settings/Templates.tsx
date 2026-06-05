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
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-lg md:text-xl font-bold text-gray-900">Templates de Mensagem</h1>
        <p className="text-sm text-gray-500 mt-1">Personalize as mensagens enviadas automaticamente para cada evento.</p>
      </div>

      {/* Card principal */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

        {/* Header com seletores */}
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/60">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Evento</label>
              <select
                value={event}
                onChange={(e) => setEvent(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#185FA5] focus:border-transparent transition"
              >
                {EVENTS.map((e) => (
                  <option key={e} value={e}>{EVENT_LABEL[e]}</option>
                ))}
              </select>
            </div>
            <div className="sm:w-44 space-y-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Canal</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#185FA5] focus:border-transparent transition"
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Editor */}
        <div className="px-6 py-5">
          <TemplateEditor event={event} channel={channel} />
        </div>

      </div>
    </div>
  )
}
