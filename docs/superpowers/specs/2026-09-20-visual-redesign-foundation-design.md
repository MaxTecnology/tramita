# Redesign Visual Premium — Fundação + Telas Principais — Design

## Objetivo

O Tramita precisa de um visual "premium": denso em dados (o público é contador, que lida com volume de processos/prazos) mas com acabamento de produto moderno — não um dashboard genérico de gestão. Hoje o app não tem nenhum sistema de design: `apps/web/src/index.css` é só `@import "tailwindcss"` puro, sem tema customizado, e a cor da marca (`#185FA5`) está hardcoded via classes arbitrárias (`bg-[#185FA5]`) espalhada em **23 arquivos**. Trocar qualquer cor hoje significa caçar 23 arquivos um por um.

Este documento cobre a primeira fatia de um redesign maior (ver Escopo). Decisões maiores de produto que vieram junto na conversa (tarefas recorrentes, calendário, SLA, métricas de produtividade, evolução de Solicitações→Ordem de Serviço, automação de documentos, protocolo digital) são **fora de escopo aqui** — cada uma vira sua própria spec depois que a fundação visual estiver pronta, porque todas elas vão consumir os componentes definidos aqui.

## Contexto de produto

Tramita é um SaaS B2B multi-tenant (AutoHubs) de acompanhamento de processos entre escritórios contábeis e seus clientes. Inspiração declarada pelo usuário: Nibo (automação/portal do cliente) e Gestta (gestão de tarefas/produtividade), mas construindo uma identidade própria, não uma cópia visual de nenhum dos dois.

## Decisões já validadas com o usuário (via companheiro visual)

- **Paleta**: evolução do azul AutoHubs para um **azul-petróleo** mais sóbrio como cor de acento, com **âmbar** reservado para alerta/urgência e **teal** reservado para sucesso/concluído — evita que uma cor só carregue todos os significados de status.
- **Dark mode**: nativo, via `prefers-color-scheme` do sistema operacional. Sem toggle manual na UI nesta fase — isso é uma limitação aceita conscientemente: adicionar um toggle depois exige refatorar para um atributo/classe controlada por JS no `<html>`, hoje resolvido só em CSS puro.
- **Tipografia**: introduzir a fonte **Inter** via Google Fonts (hoje o app usa a fonte padrão do sistema).
- **Densidade de layout**: validada como está no mockup aprovado — nem mais densa, nem mais arejada (ver seção Mockup de Referência).
- **Reorganização de menu**: Templates, Notificações e Assinatura agrupados sob "Configurações" no menu lateral; Dashboard, Processos, Solicitações, Clientes e Usuários continuam como itens de primeiro nível (uso diário, não deveriam ficar atrás de um submenu).

## Escopo desta fase

**Dentro do escopo:**
- Sistema de tokens de design (cores, tipografia, espaçamento) em `apps/web/src/index.css`
- `apps/web/index.html` — tag de fonte Google Fonts (Inter)
- `apps/web/src/components/AppLayout.tsx` — sidebar + shell, incluindo o agrupamento "Configurações"
- `apps/web/src/pages/app/DashboardMetrics.tsx` — tela real servida em `/app/dashboard`
- `apps/web/src/pages/app/Processes.tsx` — listagem de processos
- `apps/web/src/pages/app/Board.tsx` — Kanban
- Os 7 componentes base `shadcn/ui` em `apps/web/src/components/ui/`: `button.tsx`, `card.tsx`, `badge.tsx`, `dialog.tsx`, `input.tsx`, `label.tsx`, `textarea.tsx` — restilizados com os novos tokens. Como todo o resto do app já consome esses componentes, páginas fora do escopo desta fase herdam parte do visual novo automaticamente, sem trabalho extra.
- Remoção de `apps/web/src/pages/app/Dashboard.tsx` — componente morto (188 linhas, importado em `router.tsx` mas nunca usado como `element` de nenhuma rota; a rota `/app/dashboard` real usa `DashboardMetrics.tsx`). Confirmado via `grep` no router: `Dashboard` só aparece na linha de `import`, nunca em JSX.

**Fora do escopo (specs futuras, reaproveitam a fundação daqui):**
- Portal do cliente (`apps/web/src/pages/portal/*`)
- Clientes, Usuários (`apps/web/src/pages/app/Clients.tsx`, `Users.tsx` ou equivalentes)
- Painel Master (`apps/web/src/pages/master/*`)
- Telas de configurações (Templates, Notificações, Assinatura) — só o item de menu entra nesta fase, as telas em si não
- Toda a modelagem de produto discutida na conversa (tarefas recorrentes, calendário, SLA, métricas, Ordem de Serviço, automação de documentos, protocolo digital)

## Tokens de design

Definidos como CSS custom properties num bloco `@theme` em `apps/web/src/index.css` (mecanismo nativo do Tailwind v4 — sem precisar de `tailwind.config.js` separado), com overrides em `@media (prefers-color-scheme: dark)`.

### Cores — modo claro

| Token | Valor | Uso |
|---|---|---|
| `--color-bg` | `#F8FAFC` | Fundo de página |
| `--color-surface` | `#FFFFFF` | Cards, sidebar, inputs |
| `--color-border` | `#E7ECF3` | Bordas de card/divisores |
| `--color-text-primary` | `#0F1D2E` | Texto principal, títulos |
| `--color-text-secondary` | `#64748B` | Texto de apoio, labels |
| `--color-accent` | `#1E3A5F` | Botão primário, item de nav ativo, ícone da marca |
| `--color-accent-hover` | `#2563A8` | Hover/estado ativo de elementos de acento |
| `--color-status-warning-bg` / `-text` | `#FEF3C7` / `#B45309` | Badges de prazo próximo/urgente |
| `--color-status-success-bg` / `-text` | `#ECFDF9` / `#0D9488` | Badges de concluído |
| `--color-status-neutral-bg` / `-text` | `#F1F5F9` / `#64748B` | Badges de status neutro (pendente etc.) |

### Cores — modo escuro

| Token | Valor | Uso |
|---|---|---|
| `--color-bg` | `#0B1220` | Fundo de página |
| `--color-surface` | `#131B2E` | Cards, sidebar, inputs |
| `--color-border` | `#263449` | Bordas de card/divisores |
| `--color-text-primary` | `#F1F5F9` | Texto principal, títulos |
| `--color-text-secondary` | `#94A3B8` | Texto de apoio, labels |
| `--color-accent` | `#3B82F6` | Botão primário, item de nav ativo |
| `--color-accent-hover` | `#93C5FD` | Hover/estado ativo de elementos de acento |
| `--color-status-warning-bg` / `-text` | `#452C0A` / `#FBBF24` | Badges de prazo próximo/urgente |
| `--color-status-success-bg` / `-text` | `#0F2E2A` / `#2DD4BF` | Badges de concluído |
| `--color-status-neutral-bg` / `-text` | `#1E293B` / `#94A3B8` | Badges de status neutro |

### Tipografia

- Fonte: **Inter** (pesos 400, 500, 600, 700), carregada via `<link>` do Google Fonts em `apps/web/index.html`
- Token `--font-sans` no `@theme` aponta pra `'Inter', -apple-system, 'Segoe UI', sans-serif` (fallback do sistema se a fonte não carregar)

### Espaçamento e forma

Sem token novo aqui — o mockup aprovado usa a escala padrão do Tailwind (múltiplos de 4px) e `border-radius` de 8-10px para cards/botões, consistente com o que já existe no app hoje. Não há necessidade de uma escala customizada.

## Mockup de referência (aprovado)

A densidade/tipografia/espaçamento validados com o usuário: sidebar de 200px com seções "GERAL" e "CONFIGURAÇÕES", 4 stat tiles em grid no topo do conteúdo, lista de processos em linhas (não cards) com badge de status colorido à direita e data de vencimento alinhada à direita. Título de página em 19px/700, stat tiles com label 10.5px + valor 20px/700. Este layout é a referência de "pronto" para `DashboardMetrics.tsx` — `Processes.tsx` e `Board.tsx` seguem a mesma linguagem visual (tokens, tipografia, espaçamento) adaptada à própria estrutura de cada tela, não uma cópia literal do mockup.

## Migração dos 23 arquivos com cor hardcoded

Dos 23 arquivos com `#185FA5`/`#0C447C`/`#378ADD` hardcoded, apenas os que caem dentro do escopo desta fase (`AppLayout.tsx`, `DashboardMetrics.tsx`, `Processes.tsx`, `Board.tsx`, mais qualquer um dos 7 componentes `ui/`) são migrados agora, trocando a cor hardcoded pela classe de token equivalente (`bg-[#185FA5]` → `bg-accent`, etc.). Os arquivos fora do escopo (Login, Register, Master, Subscription, TemplateEditor etc.) continuam com a cor antiga até a fase deles chegar — o app fica com uma mistura visual temporária entre páginas migradas e não migradas, o que é esperado num rollout em fases.

## Testes e verificação

Nenhuma migration de banco, nenhuma mudança de contrato de API — é puramente uma camada de apresentação. Nenhum teste existente (`*.test.tsx`) faz assert em valor de cor hardcoded (confirmado via grep), então a troca de tokens não deve quebrar a suíte atual; a suíte roda normalmente como regressão (nenhuma lógica muda). Não são escritos testes automatizados novos para esta fase — é mudança visual, não lógica de negócio, seguindo a política do projeto de testar lógica crítica, não aparência. Verificação é manual: subir `pnpm --filter web dev`, comparar cada página migrada com o mockup aprovado, nos dois modos (claro via preferência do SO normal, escuro via forçar `prefers-color-scheme: dark` nas devtools do navegador).

## Riscos e limitações conhecidas

- **Dark mode sem toggle manual**: aceito conscientemente nesta fase. Se o produto precisar de um toggle manual no futuro, isso exige uma segunda spec para introduzir controle via atributo/classe no `<html>` + JS, não é uma extensão trivial do que está aqui.
- **Rollout parcial**: enquanto as fases futuras não chegam, o app vai ter páginas com o visual novo e páginas com o visual antigo coexistindo. Isso é esperado e não é tratado como bug.
- **Fonte externa**: depender do Google Fonts introduz uma requisição de rede externa no carregamento inicial — aceito, o fallback (`-apple-system, 'Segoe UI', sans-serif`) garante que o app continua legível se a fonte não carregar.
