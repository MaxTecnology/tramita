import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import { ClientForm } from './ClientForm'
import { EMPTY_COMPANY, type ClientFormState } from './clientFormStatus'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: string) => toastError(m) } }))

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
}

const CITIES: Record<string, { ibgeCode: number; name: string }[]> = {
  SE: [{ ibgeCode: 2800308, name: 'Aracaju' }, { ibgeCode: 2804805, name: 'Nossa Senhora do Socorro' }],
  AL: [{ ibgeCode: 2700300, name: 'Arapiraca' }, { ibgeCode: 2704302, name: 'Maceió' }],
}

const complete = (company: Partial<ClientFormState['company']>): ClientFormState => ({
  company: { ...EMPTY_COMPANY, name: 'Fulano', codigo: '1', clientType: 'PF', cpf: '529.982.247-25', ...company },
  departments: [{ departmentId: 'fiscal', responsibleUserId: 'u1' }],
  clientUsers: [{ name: 'Ana', email: 'a@a.com', password: 'Senha@1234', phone: '82999991234', departmentIds: ['fiscal'] }],
})

const onSubmit = vi.fn()
function renderForm(initial: ClientFormState) {
  return render(<ClientForm initial={initial} submitLabel="Salvar" isSaving={false} onSubmit={onSubmit} onCancel={() => {}} />, { wrapper })
}

beforeEach(() => {
  onSubmit.mockReset()
  toastError.mockReset()
  server.use(
    http.get(`${API}/departments`, () => HttpResponse.json([{ id: 'fiscal', name: 'Fiscal' }])),
    http.get(`${API}/users/options`, () => HttpResponse.json([{ id: 'u1', name: 'Bia', role: 'ORG_ADMIN', departmentIds: ['fiscal'] }])),
    http.get(`${API}/municipalities`, ({ request }) => HttpResponse.json(CITIES[new URL(request.url).searchParams.get('uf') ?? ''] ?? [])),
  )
})

describe('estado e cidade no cadastro do cliente', () => {
  it('the state is a list of the 27 UFs and the city list follows the state; changing the state clears the city', async () => {
    renderForm(complete({}))
    const uf = screen.getByLabelText(/Estado/) as HTMLSelectElement
    expect(within(uf).getAllByRole('option').filter((o) => (o as HTMLOptionElement).value)).toHaveLength(27)
    fireEvent.change(uf, { target: { value: 'SE' } })
    const city = await screen.findByLabelText(/Cidade/) as HTMLSelectElement
    await waitFor(() => expect(within(city).getByRole('option', { name: 'Aracaju' })).toBeInTheDocument())
    fireEvent.change(city, { target: { value: '2800308' } })
    expect(city.value).toBe('2800308')
    fireEvent.change(uf, { target: { value: 'AL' } })
    await waitFor(() => expect(within(screen.getByLabelText(/Cidade/)).getByRole('option', { name: 'Maceió' })).toBeInTheDocument())
    expect((screen.getByLabelText(/Cidade/) as HTMLSelectElement).value).toBe('')
  })

  it('without the city, the form says so and cannot be saved', async () => {
    renderForm(complete({ estado: 'SE' }))
    expect(await screen.findByText('Informe a cidade do cliente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('sends the state and the city code', async () => {
    renderForm(complete({ estado: 'SE', ibgeCityCode: 2800308, cidade: 'Aracaju' }))
    const save = screen.getByRole('button', { name: 'Salvar' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)
    expect(onSubmit.mock.calls[0][0].company).toMatchObject({ estado: 'SE', ibgeCityCode: 2800308 })
  })

  it('the CNPJ lookup fills the state and the city', async () => {
    server.use(http.get(`${API}/clients/lookup-cnpj/11222333000181`, () => HttpResponse.json({
      razaoSocial: 'ACME', cep: '49000000', estado: 'SE', cidade: 'Aracaju', ibgeCityCode: 2800308, bairro: 'Centro', logradouro: 'Rua A', numero: '1', complemento: null,
    })))
    renderForm(complete({ clientType: 'PJ', cnpj: '11.222.333/0001-81', cpf: '' }))
    fireEvent.click(screen.getByRole('button', { name: /Buscar CNPJ/ }))
    await waitFor(() => expect((screen.getByLabelText(/Estado/) as HTMLSelectElement).value).toBe('SE'))
    await waitFor(() => expect((screen.getByLabelText(/Cidade/) as HTMLSelectElement).value).toBe('2800308'))
  })

  it('a lookup without the city code leaves the city to be chosen', async () => {
    server.use(http.get(`${API}/clients/lookup-cnpj/11222333000181`, () => HttpResponse.json({
      razaoSocial: 'ACME', cep: null, estado: 'SE', cidade: 'CIDADE NOVA', ibgeCityCode: null, bairro: null, logradouro: null, numero: null, complemento: null,
    })))
    renderForm(complete({ clientType: 'PJ', cnpj: '11.222.333/0001-81', cpf: '' }))
    fireEvent.click(screen.getByRole('button', { name: /Buscar CNPJ/ }))
    expect(await screen.findByText('Escolha a cidade')).toBeInTheDocument()
    expect((screen.getByLabelText(/Cidade/) as HTMLSelectElement).value).toBe('')
  })

  it('the lookup down shows the server message and keeps the form editable', async () => {
    server.use(http.get(`${API}/clients/lookup-cnpj/11222333000181`, () => HttpResponse.json(
      { message: 'Serviço de consulta de CNPJ indisponível no momento. Tente de novo ou preencha os dados à mão.' }, { status: 502 },
    )))
    renderForm(complete({ clientType: 'PJ', cnpj: '11.222.333/0001-81', cpf: '' }))
    fireEvent.click(screen.getByRole('button', { name: /Buscar CNPJ/ }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Serviço de consulta de CNPJ indisponível no momento. Tente de novo ou preencha os dados à mão.'))
    expect(screen.getByLabelText(/Estado/)).toBeEnabled()
  })

  it('an old client with the state written out and no city code opens empty, showing the old values', async () => {
    renderForm(complete({ estado: 'Sergipe', cidade: 'Aracaju', ibgeCityCode: null }))
    expect((screen.getByLabelText(/Estado/) as HTMLSelectElement).value).toBe('')
    expect(screen.getByText('Cadastro anterior: Aracaju — Sergipe')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })
})
