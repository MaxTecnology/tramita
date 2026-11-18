import { describe, expect, it } from 'vitest'
import { dropTarget, placeTask } from './boardOrder'

const board = {
  columns: [
    { id: 'todo', tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
    { id: 'doing', tasks: [{ id: 'x' }, { id: 'y' }] },
  ],
}

describe('onde o cartão cai no quadro', () => {
  it('on a card of the same column: takes its place (reorder)', () => {
    expect(dropTarget(board, 'c', 'a')).toEqual({ columnId: 'todo', position: 0 })
    expect(dropTarget(board, 'a', 'c')).toEqual({ columnId: 'todo', position: 2 })
  })
  it('on its own place or on the empty part of its column at the end: nothing to do', () => {
    expect(dropTarget(board, 'b', 'b')).toBeNull()
    expect(dropTarget(board, 'c', 'todo')).toBeNull()
  })
  it('on a card of another column: goes before it; on the empty part: at the end', () => {
    expect(dropTarget(board, 'a', 'y')).toEqual({ columnId: 'doing', position: 1 })
    expect(dropTarget(board, 'a', 'doing')).toEqual({ columnId: 'doing', position: 2 })
  })
  it('the board shows the new order at once', () => {
    const moved = placeTask(board, 'c', 'todo', 0)
    expect(moved.columns[0].tasks.map((t) => t.id)).toEqual(['c', 'a', 'b'])
    const across = placeTask(board, 'a', 'doing', 1)
    expect(across.columns.map((c) => c.tasks.map((t) => t.id))).toEqual([['b', 'c'], ['x', 'a', 'y']])
  })
})
