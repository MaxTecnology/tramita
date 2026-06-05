# Portal do Cliente — Redesign Visual + Mobile — Design Spec

**Data:** 2026-06-05
**Escopo:** Melhorar o visual do portal do cliente em todos os 5 arquivos e garantir responsividade mobile completa.
**Motivação:** Portal usa `Card/CardContent` inconsistente, prioridades em inglês, sem navegação mobile, alert() para erros.

---

## Arquivos

- Modify: `apps/web/src/pages/portal/Layout.tsx`
- Modify: `apps/web/src/pages/portal/Boards.tsx`
- Modify: `apps/web/src/pages/portal/Board.tsx`
- Modify: `apps/web/src/pages/portal/Profile.tsx`
- Modify: `apps/web/src/pages/portal/Reports.tsx`

Zero mudanças de backend, lógica ou API.

---

## Layout.tsx

### Desktop (sem mudança estrutural)
- Sidebar `w-52` mantida
- Logo "Tramita" muda de `text-blue-600` para `text-[#185FA5]`
- Links ativos: `bg-blue-50 text-[#185FA5]` em vez de `text-blue-700`
- Nome do usuário exibido abaixo do logo (já existe)

### Mobile — Bottom Tab Bar
- Sidebar: `hidden md:flex flex-col` (some no mobile)
- Bottom tab bar: `fixed bottom-0 left-0 right-0 z-50 md:hidden` com fundo branco, borda superior, altura `h-16`
- 3 tabs: Processos (`LayoutGrid`), Relatórios (`FileText`), Perfil (`User`)
- Tab ativa: ícone + label com cor `#185FA5`, inativa: `text-gray-400`
- `<main>`: adicionar `pb-16 md:pb-0` para conteúdo não ficar coberto pela tab bar

### Estrutura do bottom tab
```tsx
<nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white border-t border-gray-200 flex h-16">
  {tabs.map(tab => (
    <NavLink className="flex-1 flex flex-col items-center justify-center gap-0.5">
      <Icon size={20} />
      <span className="text-[10px] font-medium">{label}</span>
    </NavLink>
  ))}
</nav>
```

---

## Boards.tsx — Meus Processos

### Cards melhorados
- Substituir `rounded-lg border` por `rounded-xl border border-gray-200 shadow-sm hover:shadow-md`
- Header do processo em destaque (`font-semibold text-base`)
- Linha secundária: `text-sm text-gray-400` com data de criação ou placeholder
- Seta `→` no canto inferior direito em `text-[#185FA5]`
- Remover `"Ver detalhes →"` como parágrafo — incorporar no card

### Grid responsivo
- `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`

### Empty state
- Ícone `ClipboardList` centralizado + texto "Nenhum processo encontrado."
- Subtítulo: "Seu escritório ainda não criou processos para você."

---

## Board.tsx — Kanban do cliente

### Prioridades PT-BR
```typescript
const PRIORITY_LABEL: Record<string, string> = {
  LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', URGENT: 'Urgente',
}
```
Substituir `{task.priority}` por `{PRIORITY_LABEL[task.priority] ?? task.priority}`

### Barra de progresso dinâmica
- Verde (`bg-green-500`) quando ≥ 80%
- Azul (`bg-blue-500`) no padrão
- Sem mudança lógica, só a cor

### Busca com ícone
```tsx
<div className="relative">
  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
  <input className="pl-9 ..." />
</div>
```

### Mobile
- Colunas `w-72` com scroll horizontal (já funciona, refinamento de padding)
- Header do board responsivo: `flex-col sm:flex-row`

---

## Profile.tsx

### Remover Card/CardContent
- Substituir por `div rounded-xl border border-gray-200 shadow-sm`
- Padrão com header `px-5 py-3 border-b bg-gray-50/60` e label `uppercase tracking-wide`

### Avatar com iniciais
```tsx
function Avatar({ name }: { name: string }) {
  const initials = (name ?? '?').split(' ').slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?'
  return (
    <div className="h-12 w-12 rounded-full bg-[#185FA5] flex items-center justify-center text-white font-bold text-sm">
      {initials}
    </div>
  )
}
```

### Layout do formulário
- Avatar + nome do usuário no topo
- Campos: WhatsApp, Nova senha, Confirmar senha
- Botão "Salvar alterações" alinhado à direita, `bg-[#185FA5]`
- Mensagem de erro inline (já existe — manter)

---

## Reports.tsx

### Remover Card/CardContent
- Substituir por `div rounded-xl border border-gray-200 shadow-sm`
- Header com label `uppercase tracking-wide`

### Substituir `alert()` por `toast.error()`
```typescript
import { toast } from 'sonner'
// no catch:
toast.error('Relatório não disponível para este período.')
```

### Selects consistentes
```tsx
className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
```

### Botão com marca e ícone
```tsx
<Button className="bg-[#185FA5] hover:bg-[#0C447C] text-white gap-2">
  <Download size={16} />
  {loading ? 'Gerando...' : 'Baixar PDF'}
</Button>
```

---

## Checklist de entrega

- [ ] Sidebar some no mobile (`hidden md:flex`)
- [ ] Bottom tab bar visível no mobile com 3 tabs
- [ ] Tab ativa destacada com `#185FA5`
- [ ] `main` com `pb-16 md:pb-0`
- [ ] Cards de processos com `rounded-xl shadow-sm hover:shadow-md`
- [ ] Grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
- [ ] Empty state com ícone `ClipboardList`
- [ ] Prioridades PT-BR no kanban
- [ ] Barra de progresso verde quando ≥ 80%
- [ ] Busca com ícone `Search` integrado
- [ ] Profile sem `Card` — com avatar de iniciais e botão à direita
- [ ] Reports sem `Card` — `toast.error()` e botão com `Download`
- [ ] Build sem erros TypeScript
