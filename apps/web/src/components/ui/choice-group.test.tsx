import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { ChoiceGroup } from './choice-group'

function Demo() {
  const [v, setV] = useState('a')
  return <ChoiceGroup label="Situação" value={v} onChange={setV} options={[{ value: 'a', label: 'Abertas' }, { value: 'b', label: 'Atrasadas' }, { value: 'c', label: 'Concluídas' }]} />
}

it('is one radio group: one tab stop, arrows move and choose, Home/End jump', async () => {
  render(<Demo />)
  expect(screen.getByRole('radiogroup', { name: 'Situação' })).toBeInTheDocument()
  const [a, b, c] = screen.getAllByRole('radio')
  expect(a).toHaveAttribute('aria-checked', 'true')
  expect(a).toHaveAttribute('tabindex', '0')
  expect(b).toHaveAttribute('tabindex', '-1')
  a.focus()
  await userEvent.keyboard('{ArrowRight}')
  expect(b).toHaveFocus()
  expect(b).toHaveAttribute('aria-checked', 'true')
  await userEvent.keyboard('{End}')
  expect(c).toHaveAttribute('aria-checked', 'true')
  await userEvent.keyboard('{ArrowRight}')
  expect(a).toHaveAttribute('aria-checked', 'true')
  await userEvent.keyboard('{ArrowLeft}')
  expect(c).toHaveFocus()
})
