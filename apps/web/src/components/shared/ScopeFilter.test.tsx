import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { ScopeFilter, useScopeFilter, type MyScope } from './ScopeFilter'

const fiscal = { id: 'd1', name: 'Fiscal' }
const folha = { id: 'd2', name: 'Folha' }
const member: MyScope = { role: 'ORG_MEMBER', departments: [fiscal], seesDepartmentWork: true }
const memberNoColleagues: MyScope = { ...member, seesDepartmentWork: false }
const manager: MyScope = { role: 'ORG_MANAGER', departments: [fiscal, folha], seesDepartmentWork: true }

function Harness({ me }: { me: MyScope }) {
  const [value, setValue] = useScopeFilter('tasks', me)
  const [renders] = useState(0)
  void renders
  return (
    <>
      <ScopeFilter me={me} value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  )
}

beforeEach(() => localStorage.clear())

it('a member opens on "Minhas" and can switch to the department', () => {
  render(<Harness me={member} />)
  expect(screen.getByTestId('value').textContent).toBe('{"scope":"mine"}')
  fireEvent.click(screen.getByRole('button', { name: 'Meu departamento' }))
  expect(screen.getByTestId('value').textContent).toBe('{"scope":"department"}')
  expect(screen.queryByRole('button', { name: 'Todas' })).toBeNull()
})

it('a member without "see colleagues" has no department option', () => {
  render(<Harness me={memberNoColleagues} />)
  expect(screen.queryByRole('button', { name: 'Meu departamento' })).toBeNull()
})

it('a manager opens on the department, never sees "Todas", and picks one of two departments', () => {
  render(<Harness me={manager} />)
  expect(screen.getByTestId('value').textContent).toBe('{"scope":"department"}')
  expect(screen.queryByRole('button', { name: 'Todas' })).toBeNull()
  fireEvent.change(screen.getByLabelText('Departamento'), { target: { value: 'd2' } })
  expect(screen.getByTestId('value').textContent).toBe('{"scope":"department","departmentId":"d2"}')
})

it('the choice survives a remount (remembered per screen)', () => {
  const first = render(<Harness me={member} />)
  fireEvent.click(screen.getByRole('button', { name: 'Meu departamento' }))
  first.unmount()
  render(<Harness me={member} />)
  expect(screen.getByTestId('value').textContent).toBe('{"scope":"department"}')
})

it('an admin opens on "Todas"', () => {
  render(<Harness me={{ role: 'ORG_ADMIN', departments: [], seesDepartmentWork: true }} />)
  expect(screen.getByTestId('value').textContent).toBe('{"scope":"all"}')
})

it('applies the role default once /users/me arrives after the first render', () => {
  const admin: MyScope = { role: 'ORG_ADMIN', departments: [], seesDepartmentWork: true }
  function Late({ me }: { me?: MyScope }) {
    const [value] = useScopeFilter('guides', me)
    return <output data-testid="late">{JSON.stringify(value)}</output>
  }
  const view = render(<Late />)
  view.rerender(<Late me={admin} />)
  expect(screen.getByTestId('late').textContent).toBe('{"scope":"all"}')
})

it('an admin who belongs to a department gets Minhas and Todas, not "Meu departamento" (it would mean everything)', () => {
  render(<Harness me={{ role: 'ORG_ADMIN', departments: [fiscal], seesDepartmentWork: true }} />)
  expect(screen.getByRole('button', { name: 'Todas' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Meu departamento' })).toBeNull()
})
