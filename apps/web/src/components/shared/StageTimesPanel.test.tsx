import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { server } from '@/test/server'
import { StageTimesPanel, OSIndicators } from './StageTimesPanel'

const API = 'http://localhost:3000'
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

it('shows the business days per column and per OS (office × client)', async () => {
  server.use(http.get(`${API}/boards/b1/stage-times`, () => HttpResponse.json({
    columns: [{ columnId: 'c1', title: 'Análise', totalBusinessDays: 4, avgBusinessDays: 2 }, { columnId: 'c2', title: 'Prefeitura', totalBusinessDays: 6, avgBusinessDays: 3 }],
    os: [{ taskId: 't1', title: 'Registro na Junta', officeBusinessDays: 5, clientBusinessDays: 2, state: 'DONE' }],
  })))
  wrap(<StageTimesPanel boardId="b1" />)
  expect(await screen.findByText('Prefeitura')).toBeInTheDocument()
  expect(screen.getByText('6 dias úteis (média 3)')).toBeInTheDocument()
  expect(screen.getByText('Registro na Junta')).toBeInTheDocument()
  expect(screen.getByText('5 do escritório · 2 aguardando o cliente')).toBeInTheDocument()
})

it('dashboard indicators: delays by reason, pending reasons and time per model', async () => {
  server.use(http.get(`${API}/dashboard/os`, () => HttpResponse.json({
    delaysByReason: [{ reasonId: 'r1', name: 'Aguardando órgão público', count: 3 }],
    pendingReasons: 2,
    byModel: [{ kind: 'PROCESS', id: 'p1', name: 'Abertura de empresa', count: 4, avgOfficeBusinessDays: 18, avgClientBusinessDays: 12, lateCount: 1 }],
  })))
  wrap(<OSIndicators from="2026-11-01" to="2026-11-30" />)
  expect(await screen.findByText('Aguardando órgão público')).toBeInTheDocument()
  expect(screen.getByText('2 OS ou processos concluídos com atraso sem motivo')).toBeInTheDocument()
  expect(screen.getByText('Abertura de empresa')).toBeInTheDocument()
  expect(screen.getByText('18 dias do escritório + 12 esperando o cliente (média de 4)')).toBeInTheDocument()
})
