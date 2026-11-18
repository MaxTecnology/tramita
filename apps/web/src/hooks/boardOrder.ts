// Where a card dropped on the process board goes. `overId` is a card or a column (its empty part).
// The position is the index the card takes in the target column, the same the API uses.
interface OrderBoard<T extends { id: string }> { columns: { id: string; tasks: T[] }[] }

export function dropTarget<T extends { id: string }>(board: OrderBoard<T>, taskId: string, overId: string): { columnId: string; position: number } | null {
  const from = board.columns.find((c) => c.tasks.some((t) => t.id === taskId))
  const to = board.columns.find((c) => c.id === overId) ?? board.columns.find((c) => c.tasks.some((t) => t.id === overId))
  if (!from || !to) return null
  const overIndex = to.tasks.findIndex((t) => t.id === overId)
  if (from.id === to.id) {
    const current = from.tasks.findIndex((t) => t.id === taskId)
    const target = overIndex === -1 ? from.tasks.length - 1 : overIndex
    return target === current ? null : { columnId: to.id, position: target }
  }
  return { columnId: to.id, position: overIndex === -1 ? to.tasks.length : overIndex }
}

// The board with the card already in its new place (shown before the API answers)
export function placeTask<T extends { id: string }, B extends OrderBoard<T>>(board: B, taskId: string, columnId: string, position: number): B {
  const task = board.columns.flatMap((c) => c.tasks).find((t) => t.id === taskId)
  if (!task) return board
  return {
    ...board,
    columns: board.columns.map((col) => {
      const rest = col.tasks.filter((t) => t.id !== taskId)
      if (col.id !== columnId) return { ...col, tasks: rest }
      const tasks = [...rest]
      tasks.splice(Math.min(position, rest.length), 0, { ...task, columnId, position })
      return { ...col, tasks }
    }),
  }
}
