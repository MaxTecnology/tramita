import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ListTable } from './list-table'

const rows = [{ id: 'a', name: 'Fiscal', people: 3 }, { id: 'b', name: 'Pessoal', people: 0 }]
const columns = [
  { header: 'Nome', width: 'minmax(0,2fr)', cell: (r: typeof rows[number]) => r.name },
  { header: 'Pessoas', width: 'minmax(0,1fr)', cell: (r: typeof rows[number]) => String(r.people) },
]

describe('ListTable', () => {
  it('shows a header and one row per item, with its actions', () => {
    render(<ListTable label="Departamentos" columns={columns} rows={rows} rowKey={(r) => r.id} actions={(r) => <button type="button">Editar {r.name}</button>} empty="vazio" />)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Nome', 'Pessoas'])
    const list = screen.getByRole('list', { name: 'Departamentos' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByRole('button', { name: 'Editar Pessoal' })).toBeInTheDocument()
  })

  it('shows the empty message instead of rows, and a skeleton while loading', () => {
    const { rerender } = render(<ListTable label="Departamentos" columns={columns} rows={[]} rowKey={(r) => r.id} empty="Nenhum departamento" />)
    expect(screen.getByText('Nenhum departamento')).toBeInTheDocument()
    rerender(<ListTable label="Departamentos" columns={columns} rows={[]} rowKey={(r) => r.id} empty="Nenhum departamento" loading />)
    expect(screen.getByLabelText('Carregando departamentos')).toBeInTheDocument()
  })
})
