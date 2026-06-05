import { useState } from 'react'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const SELECT_CLS = 'mt-1 flex h-9 w-full rounded-lg border border-gray-200 bg-white px-3 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#185FA5]'

export default function PortalReports() {
  const { user } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [loading, setLoading] = useState(false)

  async function handleDownload() {
    setLoading(true)
    try {
      const monthStr = `${year}-${String(month).padStart(2, '0')}`
      const res = await api.get(`/clients/${user?.id}/report?month=${monthStr}`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `relatorio-${monthStr}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Relatório não disponível para este período.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-lg">
      <h1 className="text-lg md:text-xl font-bold text-gray-900 mb-6">Relatórios</h1>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5 space-y-5">
        <div>
          <p className="text-sm font-medium text-gray-700 mb-1">Download de relatório mensal</p>
          <p className="text-xs text-gray-400">Inclui todas as tarefas movimentadas no período selecionado.</p>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-gray-600">Mês</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={SELECT_CLS}>
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="w-24">
            <label className="text-xs font-medium text-gray-600">Ano</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={SELECT_CLS}>
              {[now.getFullYear(), now.getFullYear() - 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleDownload}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-[#185FA5] hover:bg-[#145088] text-white text-sm font-medium px-4 py-2 transition-colors disabled:opacity-50"
        >
          <Download size={15} />
          {loading ? 'Gerando...' : 'Baixar PDF'}
        </button>
      </div>
    </div>
  )
}
