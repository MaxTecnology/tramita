import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ThemeToggle } from './ThemeToggle'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => vi.unstubAllGlobals())

it('offers Claro, Escuro and Automático; choosing one applies and remembers it', async () => {
  render(<ThemeToggle />)
  expect(screen.getByRole('radio', { name: 'Automático' })).toHaveAttribute('aria-checked', 'true')
  await userEvent.click(screen.getByRole('radio', { name: 'Escuro' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(localStorage.getItem('theme')).toBe('dark')
  expect(screen.getByRole('radio', { name: 'Escuro' })).toHaveAttribute('aria-checked', 'true')
  await userEvent.click(screen.getByRole('radio', { name: 'Automático' }))
  expect(localStorage.getItem('theme')).toBeNull()
  expect(document.documentElement.dataset.theme).toBe('light')
})
