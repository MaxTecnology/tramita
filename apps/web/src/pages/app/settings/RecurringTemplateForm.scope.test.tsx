import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import RecurringTemplateForm from './RecurringTemplateForm'

const API = 'http://localhost:3000'

const confirmMock = vi.fn()
vi.mock('@/components/ui/app-dialogs', () => ({ askConfirm: (o: unknown) => confirmMock(o) }))

const CITIES: Record<string, { ibgeCode: number; name: string }[]> = {
  SE: [{ ibgeCode: 2800308, name: 'Aracaju' }],
  AL: [{ ibgeCode: 2704302, name: 'Maceió' }],
}

let saved: Record<string, unknown> | null = null

function renderForm() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/settings/recurring-templates/new']}>
        <Routes>
          <Route path="/app/settings/recurring-templates/new" element={<RecurringTemplateForm />} />
          <Route path="/app/settings/recurring-templates" element={<p>lista de templates</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  saved = null
  confirmMock.mockReset().mockResolvedValue(true)
  server.use(
    http.get(`${API}/departments`, () => HttpResponse.json([{ id: 'dp', name: 'Fiscal' }])),
    http.get(`${API}/document-reader/obrigacoes`, () => HttpResponse.json([])),
    http.get(`${API}/municipalities`, ({ request }) => HttpResponse.json(CITIES[new URL(request.url).searchParams.get('uf') ?? ''] ?? [])),
    http.post(`${API}/recurring-templates`, async ({ request }) => { saved = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: 't1' }) }),
  )
})

async function fillBasics() {
  await userEvent.type(await screen.findByLabelText('Título'), 'ICMS')
  await userEvent.selectOptions(screen.getByLabelText('Departamento'), 'dp')
}

async function addRule(place: { uf: string; city?: string }, day: string, roll: string) {
  await userEvent.selectOptions(screen.getByLabelText('Estado da exceção'), place.uf)
  if (place.city) {
    const city = screen.getByLabelText('Cidade da exceção')
    await waitFor(() => expect(within(city).getByRole('option', { name: place.city })).toBeInTheDocument())
    await userEvent.selectOptions(city, place.city)
  }
  await userEvent.selectOptions(screen.getByLabelText('Dia da exceção'), day)
  await userEvent.selectOptions(screen.getByLabelText('Se cair no fim de semana (exceção)'), roll)
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar exceção' }))
}

describe('abrangência do vencimento na recorrência', () => {
  it('starts federal, as today, without exceptions nor "only listed places"', async () => {
    renderForm()
    const scope = await screen.findByRole('radiogroup', { name: 'Abrangência do vencimento' })
    expect(within(scope).getByRole('radio', { name: 'Federal' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByLabelText('Estado da exceção')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Só para os locais listados' })).not.toBeInTheDocument()
  })

  it('state: adds exceptions (a used state leaves the list) and saves them', async () => {
    renderForm()
    await fillBasics()
    await userEvent.click(screen.getByRole('radio', { name: 'Estadual' }))
    await addRule({ uf: 'SE' }, '15', 'FORWARD')
    expect(screen.getByText(/SE · dia 15 · adiar/)).toBeInTheDocument()
    expect(within(screen.getByLabelText('Estado da exceção')).queryByRole('option', { name: 'SE' })).not.toBeInTheDocument()
    await addRule({ uf: 'AL' }, '10', 'BACKWARD')
    await userEvent.click(screen.getByRole('switch', { name: 'Só para os locais listados' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar template' }))
    await waitFor(() => expect(saved).not.toBeNull())
    expect(saved).toMatchObject({
      dueScope: 'STATE', onlyListedLocations: true,
      dueRules: [
        { uf: 'SE', dueDayOfPeriod: 15, dueBusinessDayRoll: 'FORWARD' },
        { uf: 'AL', dueDayOfPeriod: 10, dueBusinessDayRoll: 'BACKWARD' },
      ],
    })
  })

  it('city: picks the state then the city, and sends the IBGE code only', async () => {
    renderForm()
    await fillBasics()
    await userEvent.click(screen.getByRole('radio', { name: 'Municipal' }))
    await addRule({ uf: 'SE', city: 'Aracaju' }, '10', 'NONE')
    expect(screen.getByText(/Aracaju \(SE\) · dia 10/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Salvar template' }))
    await waitFor(() => expect(saved).not.toBeNull())
    expect(saved).toMatchObject({ dueScope: 'CITY', dueRules: [{ ibgeCityCode: 2800308, dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE' }] })
    expect((saved?.dueRules as Record<string, unknown>[])[0]).not.toHaveProperty('uf')
  })

  it('changing the scope with exceptions asks first and then clears them; saying no keeps everything', async () => {
    renderForm()
    await fillBasics()
    await userEvent.click(screen.getByRole('radio', { name: 'Estadual' }))
    await addRule({ uf: 'SE' }, '15', 'NONE')
    confirmMock.mockResolvedValueOnce(false)
    await userEvent.click(screen.getByRole('radio', { name: 'Municipal' }))
    expect(screen.getByRole('radio', { name: 'Estadual' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/SE · dia 15/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Federal' }))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Federal' })).toHaveAttribute('aria-checked', 'true'))
    expect(screen.queryByText(/SE · dia 15/)).not.toBeInTheDocument()
    expect(confirmMock).toHaveBeenCalledTimes(2)
  })

  it('weekly exceptions use the weekdays, like the default due day', async () => {
    renderForm()
    await fillBasics()
    await userEvent.click(screen.getByRole('radio', { name: 'Semanal' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Estadual' }))
    expect(within(screen.getByLabelText('Dia da exceção')).getByRole('option', { name: 'Sexta' })).toBeInTheDocument()
    expect(within(screen.getByLabelText('Dia da exceção')).queryByRole('option', { name: '15' })).not.toBeInTheDocument()
  })
})
