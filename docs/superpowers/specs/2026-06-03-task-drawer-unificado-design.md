# Design — TaskDrawer Unificado

**Data:** 2026-06-03
**Status:** Aprovado para implementação
**Contexto:** Substitui o `TaskModal` atual (colaboradores) e refatora o `TaskDrawer` do portal (clientes) em um único componente compartilhado com rendering condicional por role.

---

## Problema

O fluxo atual tem dois componentes separados e desconexos:

- **`TaskModal.tsx`** (colaboradores) — modal básico com edição de título e prioridade. Sem histórico, sem comentários, sem visão completa.
- **`portal/TaskDrawer.tsx`** (clientes) — drawer lateral com histórico, anexos e comentários, mas somente leitura nos campos.

O resultado: cliente e colaborador vivem experiências completamente diferentes do mesmo objeto, sem possibilidade de ver os comentários e anexos um do outro em tempo real.

---

## Solução

Um único componente `TaskDrawer` compartilhado, renderizado contextualmente com base no role do usuário autenticado.

---

## Layout

**Tipo:** Drawer lateral (slide-over), abre sobre o kanban com overlay escuro.
**Largura:** `min-w-[560px] w-[50vw]` — mais largo que o atual `w-96` do portal.
**Animação:** slide da direita, igual ao portal atual.

### Estrutura interna

```
┌─────────────────────────────────────┐
│ HEADER FIXO (não rola)              │
│  Título (editável inline — collab)  │
│  [Prioridade] [Responsável] [Data]  │
│  Descrição (textarea — collab)      │
│─────────────────────────────────────│
│ ABAS                                │
│  💬 Comentários  📎 Anexos  🕐 Hist │
│─────────────────────────────────────│
│ CONTEÚDO DA ABA (rola)             │
│  (padrão: Comentários)              │
└─────────────────────────────────────┘
```

---

## Header Fixo

Sempre visível independente da aba ativa.

| Elemento | Colaborador | Cliente |
|---|---|---|
| Título | Editável inline (click-to-edit) | Read-only |
| Prioridade | Badge clicável → select dropdown | Badge read-only |
| Responsável | Badge clicável → select de users | Badge read-only |
| Vencimento | Badge clicável → date picker | Badge com status de atraso |
| Descrição | Textarea editável | Read-only (oculta se vazia) |

Edições no header disparam `PATCH /tasks/:id` individualmente ao confirmar (blur ou Enter).

---

## Abas

### 💬 Comentários (padrão ao abrir)

**Diferenciação visual:**
- Comentário de **cliente** → borda esquerda azul (`border-blue-500`), badge "Cliente"
- Comentário de **colaborador** → borda esquerda roxa (`border-violet-500`), badge com nome

**Soft delete de comentários:**
- Qualquer autor pode remover o próprio comentário
- Ao remover: `deletedAt` e `deletedBy` são preenchidos — o registro permanece no banco
- Na UI: balão exibe *"Comentário removido em DD/MM/YYYY às HH:mm"* (sem conteúdo)
- `ORG_ADMIN` e `ORG_MANAGER` veem um botão discreto **"Ver conteúdo"** que revela o texto original
- `ORG_MEMBER` e `CLIENT` veem apenas o placeholder

**Input de novo comentário:**
- Textarea com botão "Enviar" — disponível para colaboradores e clientes
- Dispara `POST /tasks/:taskId/comments`
- SSE publica evento para atualização em tempo real no board

### 📎 Anexos

- Grid de arquivos com nome, tamanho e botão de download (signed URL)
- **Upload disponível para colaboradores e clientes**
- Limite: 20 MB, tipos aceitos: PDF, PNG, JPG, GIF, WEBP, DOC, DOCX, XLS, XLSX, TXT, ZIP
- Permissões de deleção:
  - Colaborador: pode deletar qualquer anexo
  - Cliente: pode deletar apenas os próprios anexos

### 🕐 Histórico

- Timeline read-only para ambos (colaborador e cliente)
- Exibe: quem moveu, mudou prioridade, alterou responsável, etc.
- Endpoint: `GET /portal/tasks/:taskId/history` (portal) e equivalente interno

---

## Permissões Completas

| Ação | ORG_ADMIN | ORG_MANAGER | ORG_MEMBER | CLIENT |
|---|---|---|---|---|
| Editar título / campos / descrição | ✅ | ✅ | ✅ | ❌ |
| Comentar | ✅ | ✅ | ✅ | ✅ |
| Deletar próprio comentário | ✅ | ✅ | ✅ | ✅ |
| Ver conteúdo de comentário deletado | ✅ | ✅ | ❌ | ❌ |
| Upload de anexo | ✅ | ✅ | ✅ | ✅ |
| Deletar qualquer anexo | ✅ | ✅ | ✅ | ❌ |
| Deletar próprio anexo | ✅ | ✅ | ✅ | ✅ |
| Ver histórico | ✅ | ✅ | ✅ | ✅ |

---

## Mudanças de Schema

### Migration 1 — Soft delete em Comment

```prisma
model Comment {
  // campos existentes mantidos
  deletedAt     DateTime?
  deletedBy     String?    // userId ou clientId de quem deletou
  deletedByType String?    // "USER" | "CLIENT"
}
```

### Migration 2 — Rastrear uploads de cliente em Attachment

O modelo `Attachment` atual tem `uploadedBy` como FK obrigatória para `User`. Precisa suportar upload de cliente:

```prisma
model Attachment {
  // campos existentes mantidos
  uploadedBy        String?  // userId (nullable — era obrigatório)
  uploadedByClient  String?  // clientId (novo)

  uploader          User?    @relation(fields: [uploadedBy], references: [id])
  uploaderClient    Client?  @relation(fields: [uploadedByClient], references: [id])
}
```

Restrição: exatamente um dos dois deve ser não-nulo (validado na camada de serviço).

---

## Mudanças de Backend

### `tasks.routes.ts`
- `GET /tasks/:id/history` — novo endpoint para colaboradores (ORG roles). O portal usa `GET /portal/tasks/:taskId/history`; o drawer interno vai usar esta rota equivalente com `verifyJWT` + `verifyOrg`.

### `attachments.routes.ts`
- `POST /tasks/:id/attachments` — adicionar `CLIENT` aos roles permitidos
- Identificar o uploader: se token for CLIENT, usar `clientId`; se USER, usar `userId`

### `attachments.service.ts`
- `uploadAttachment()` — aceitar `uploadedByClient?: string` além do `uploadedBy`
- `deleteAttachment()` — validar: CLIENT só pode deletar anexo onde `uploadedByClient === clientId`

### `comments.service.ts`
- `deleteComment()` — trocar hard delete por soft delete: `update({ deletedAt, deletedBy, deletedByType })`
- `listComments()` — retornar `content: null` quando `deletedAt != null` para CLIENT e ORG_MEMBER; retornar conteúdo real para ORG_ADMIN e ORG_MANAGER

---

## Mudanças de Frontend

### Componentes

| Arquivo atual | Destino |
|---|---|
| `components/TaskModal.tsx` | Removido |
| `components/portal/TaskDrawer.tsx` | Refatorado → usa componente unificado |
| `components/portal/Comments.tsx` | Movido → `components/shared/Comments.tsx` |
| *(novo)* | `components/shared/TaskDrawer.tsx` — componente central |

### `TaskDrawer` unificado — props

```typescript
interface TaskDrawerProps {
  taskId: string
  open: boolean
  onClose: () => void
  role: 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER' | 'CLIENT'
}
```

O componente busca os dados internamente via `taskId`. Rendering condicional baseado em `role`.

### Uso no Board interno (`pages/app/Board.tsx`)
```tsx
// substitui TaskModal
<TaskDrawer taskId={selectedTaskId} open={!!selectedTaskId} onClose={() => setSelectedTaskId(null)} role={user.role} />
```

### Uso no Portal (`pages/portal/Board.tsx`)
```tsx
// substitui portal/TaskDrawer
<TaskDrawer taskId={selectedTaskId} open={!!selectedTaskId} onClose={() => setSelectedTaskId(null)} role="CLIENT" />
```

---

## Tipos TypeScript (shared)

```typescript
// apps/web/src/types/index.ts — adições

export interface Comment {
  id: string
  content: string | null          // null quando deletedAt != null e sem permissão
  authorType: 'USER' | 'CLIENT'
  user: { id: string; name: string } | null
  client: { id: string; name: string } | null
  deletedAt: string | null
  deletedBy: string | null
  deletedByType: 'USER' | 'CLIENT' | null
  deletedContent?: string         // só presente para ORG_ADMIN e ORG_MANAGER
  createdAt: string
}

export interface Attachment {
  id: string
  filename: string
  mimeType: string
  size: number
  signedUrl: string
  uploadedBy: string | null       // userId
  uploadedByClient: string | null // clientId
  uploaderName: string            // nome resolvido para exibição
  createdAt: string
}
```

---

## Checklist de PR

- [ ] Migration aplicada e validada
- [ ] `POST /tasks/:id/attachments` aceita CLIENT
- [ ] Soft delete de comentários funcionando (conteúdo preservado no banco)
- [ ] ORG_ADMIN/MANAGER veem conteúdo deletado, outros não
- [ ] TaskDrawer unificado renderiza corretamente para ORG e CLIENT
- [ ] TaskModal removido do Board interno
- [ ] portal/TaskDrawer usa componente unificado
- [ ] Testes de permissão: CLIENT não edita campos, não deleta anexo de outro
- [ ] SSE atualiza comentários e anexos em tempo real
- [ ] `.env.example` sem alterações necessárias
