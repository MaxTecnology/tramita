const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

/**
 * `<input type="month">` não é suportado pelo Firefox (cai pra um texto cru tipo "2026-10",
 * sem calendário nenhum) — esse componente substitui por dois <select> comuns, que funcionam
 * igual em qualquer navegador. Mantém o mesmo formato de valor ("YYYY-MM") que o resto do app
 * já usa, então quem consome isso não precisa mudar nada além de trocar o input por este.
 */
export function MonthYearPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [yearStr, monthStr] = value.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const currentYear = new Date().getUTCFullYear()
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - 1 + i)

  return (
    <div className="flex gap-2">
      <select
        value={month}
        onChange={(e) => onChange(`${year}-${String(Number(e.target.value)).padStart(2, '0')}`)}
        className="h-9 rounded-md border border-border bg-surface text-foreground px-2 text-sm"
      >
        {MONTH_NAMES.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}
      </select>
      <select
        value={year}
        onChange={(e) => onChange(`${e.target.value}-${String(month).padStart(2, '0')}`)}
        className="h-9 rounded-md border border-border bg-surface text-foreground px-2 text-sm"
      >
        {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  )
}
