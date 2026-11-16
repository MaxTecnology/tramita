import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import NotFound from './NotFound'

afterEach(() => localStorage.clear())

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<p>tela de login</p>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </MemoryRouter>,
  )
}

function logIn(role: string) {
  localStorage.setItem('accessToken', 'token')
  localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'Bruna', role, organizationId: 'o1', orgName: 'G2A' }))
}

it('without a session an unknown address goes to the login', () => {
  renderAt('/app/board-que-nao-existe')
  expect(screen.getByText('tela de login')).toBeInTheDocument()
})

it.each([
  ['ORG_MEMBER', '/app/dashboard'],
  ['ORG_ADMIN', '/app/dashboard'],
  ['CLIENT', '/portal/home'],
  ['MASTER', '/master/dashboard'],
])('a logged %s sees the page was not found and a way back to their start', (role, home) => {
  logIn(role)
  renderAt('/app/boards/x')
  expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Voltar para o início' })).toHaveAttribute('href', home)
})
