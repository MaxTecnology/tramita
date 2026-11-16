import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { server } from '@/test/server'
import MasterDashboard from './Dashboard'

it('splits the MRR between Asaas and direct agreements', async () => {
  server.use(http.get('http://localhost:3000/master/revenue', () => HttpResponse.json({ mrr: 394, mrrAsaas: 197, mrrManual: 197, totalOrgsAtivas: 2, churn: 0 })))
  render(<QueryClientProvider client={new QueryClient()}><MasterDashboard /></QueryClientProvider>)
  expect(await screen.findByText('R$ 394,00')).toBeInTheDocument()
  expect(screen.getByText('Asaas R$ 197,00 · acerto direto R$ 197,00')).toBeInTheDocument()
})
