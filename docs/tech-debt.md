# Débito Técnico — Tramita

## Mocking de dependências externas em testes — padronizar em `vi.spyOn`

**Contexto:** `apps/api/src/test/setup.ts` cria uma única instância `buildApp()` no carregamento do módulo, antes que os `vi.mock(module, factory)` de cada arquivo de teste tenham chance de fazer hoist. Quando uma rota nova passa a importar de verdade um service que outro arquivo de teste mockava via `vi.mock(...)` (ex.: `portal.routes.ts` importando `requests.service`/`request-attachments.service` na Fase de Requests), o app compartilhado já capturou o binding real, e o `vi.mock` do outro arquivo deixa de interceptar — causando chamadas reais (rede, fila) vazarem em testes que pareciam isolados.

**Já corrigido pontualmente em:** `requests.service.test.ts` e `request-attachments.service.test.ts`, convertidos de `vi.mock(module, factory)` para `vi.spyOn(namespaceImport, 'fn')` em `beforeEach`/`afterEach` — mesmo padrão já usado em `attachments.service.test.ts`.

**Pendente:** padronizar todos os arquivos de teste que mockam dependências externas (queue, b2, mailer, maximizebot) para `vi.spyOn`, evitando que a mesma fragilidade volte a aparecer quando uma rota nova importar um desses services pela primeira vez. Alternativa a avaliar: `isolate: true` no Vitest por arquivo (tem custo de performance por recriar `buildApp()` a cada arquivo — avaliar trade-off antes de adotar).
