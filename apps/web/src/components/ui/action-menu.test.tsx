import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ActionMenu } from './action-menu'

function setup() {
  const onA = vi.fn()
  render(
    <>
      <ActionMenu label="Mais ações" items={[{ label: 'Primeira', onSelect: onA }, { label: 'Segunda', onSelect: vi.fn() }, { label: 'Última', onSelect: vi.fn(), danger: true, separated: true }]} />
      <button type="button">depois</button>
    </>,
  )
  return { onA }
}

describe('ActionMenu', () => {
  it('Tab leaves the menu closed', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.tab()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('arrows, Home and End move between items', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações' }))
    expect(screen.getByRole('menuitem', { name: 'Primeira' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Última' })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('menuitem', { name: 'Primeira' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Segunda' })).toHaveFocus()
  })

  it('choosing an item closes the menu and gives the focus back to the button', async () => {
    const { onA } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Primeira' }))
    expect(onA).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mais ações' })).toHaveFocus()
  })
})
