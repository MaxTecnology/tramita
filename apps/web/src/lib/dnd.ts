import { KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type KeyboardCodes, type ScreenReaderInstructions, type KeyboardCoordinateGetter } from '@dnd-kit/core'

// Keyboard on the boards: Enter opens the card (handled by the card), Space picks it up and drops it,
// arrows move it, Esc cancels
const KEYS: KeyboardCodes = { start: ['Space'], cancel: ['Escape'], end: ['Space'] }

export function useBoardSensors(coordinateGetter?: KeyboardCoordinateGetter) {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { keyboardCodes: KEYS, ...(coordinateGetter ? { coordinateGetter } : {}) }),
  )
}

export const DND_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: 'Enter abre a tarefa. Para mover: Espaço pega o cartão, as setas levam para outra posição ou coluna, Espaço solta e Esc cancela.',
}

// What the screen reader says while a card moves; `name` turns an id (card or column) into its name
export function dndAnnouncements(name: (id: string | number) => string): Announcements {
  return {
    onDragStart: ({ active }) => `Cartão ${name(active.id)} pego.`,
    onDragOver: ({ active, over }) => (over ? `${name(active.id)} sobre ${name(over.id)}.` : `${name(active.id)} fora de uma coluna.`),
    onDragEnd: ({ active, over }) => (over ? `${name(active.id)} solto em ${name(over.id)}.` : `${name(active.id)} solto fora de uma coluna, nada mudou.`),
    onDragCancel: ({ active }) => `Movimento de ${name(active.id)} cancelado.`,
  }
}
