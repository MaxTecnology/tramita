import { useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

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
      alert('Relatório não disponível para este período.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Relatórios</h1>

      <Card>
        <CardHeader>
          <CardTitle>Download de relatório mensal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium text-gray-700">Mês</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
              >
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Ano</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="mt-1 flex h-9 w-24 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
              >
                {[now.getFullYear(), now.getFullYear() - 1].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          <Button onClick={handleDownload} disabled={loading}>
            {loading ? 'Gerando...' : 'Baixar PDF'}
          </Button>

          <p className="text-xs text-gray-400">
            O relatório inclui todas as tarefas movimentadas no período selecionado.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
