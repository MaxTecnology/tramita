import { describe, it, expect } from 'vitest'
import { withRoles } from '@/api-docs/roles'

const spec = () => ({
  paths: {
    '/tasks/{id}': { patch: { summary: 'Alterar tarefa', description: 'Título e prazo.' } },
    '/auth/login': { post: { summary: 'Entrar' } },
    '/novidade': { get: { summary: 'Rota nova, ainda fora do probe' } },
  },
})

describe('quem pode chamar cada rota (do probe do audit:routes)', () => {
  it('lists the roles that got through (not 401/403) in the description and in x-roles', () => {
    const out = withRoles(spec(), {
      'PATCH /tasks/:id': { ANON: 401, ORG_ADMIN: 404, ORG_MANAGER: 404, ORG_MEMBER: 404, CLIENT: 403, MASTER: 403 },
    })
    const op = out.paths['/tasks/{id}'].patch
    expect(op['x-roles']).toEqual(['Admin', 'Gerente', 'Membro'])
    expect(op.description).toBe('Título e prazo.\n\n**Quem pode:** Admin, Gerente, Membro')
  })

  it('a route anyone reaches without a token is public', () => {
    const out = withRoles(spec(), { 'POST /auth/login': { ANON: 400, ORG_ADMIN: 400, ORG_MANAGER: 400, ORG_MEMBER: 400, CLIENT: 400, MASTER: 400 } })
    expect(out.paths['/auth/login'].post['x-roles']).toEqual(['público'])
    expect(out.paths['/auth/login'].post.description).toBe('**Quem pode:** público')
  })

  it('a route no bearer token opens (webhook token, stream ticket) points to its own credential', () => {
    const out = withRoles(spec(), { 'POST /auth/login': { ANON: 401, ORG_ADMIN: 401, ORG_MANAGER: 401, ORG_MEMBER: 401, CLIENT: 401, MASTER: 401 } })
    expect(out.paths['/auth/login'].post['x-roles']).toEqual([])
    expect(out.paths['/auth/login'].post.description).toBe('**Quem pode:** quem tem a credencial própria da rota (veja Autenticação)')
  })

  it('roles the catalog declares win over the probe (role checked inside the service, after the body)', () => {
    const out = withRoles(spec(), {
      'PATCH /tasks/:id': { ANON: 401, ORG_ADMIN: 400, ORG_MANAGER: 400, ORG_MEMBER: 400, CLIENT: 403, MASTER: 403 },
    }, { 'PATCH /tasks/:id': ['Admin', 'Gerente'] })
    expect(out.paths['/tasks/{id}'].patch['x-roles']).toEqual(['Admin', 'Gerente'])
  })

  it('a route missing from the probe is left as it is, and is reported', () => {
    const out = withRoles(spec(), {})
    expect(out.paths['/novidade'].get).toEqual({ summary: 'Rota nova, ainda fora do probe' })
    expect(out.missing).toEqual(['PATCH /tasks/:id', 'POST /auth/login', 'GET /novidade'])
  })
})
