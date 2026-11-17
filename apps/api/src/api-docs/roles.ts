// Who can call each route, as measured by the route audit probe (`pnpm --filter api audit:routes`):
// every route is called with no token and with a token of each role; a role "gets through" when
// the answer is not 401/403. A role checked inside the service is invisible to the probe (the body
// fails first), so the catalog declares those. Added to the generated spec, never to the live reference.

export type Probe = Record<string, Record<string, number>>

type Operation = { description?: string; 'x-roles'?: string[]; [key: string]: unknown }
export type Spec = { paths: Record<string, Record<string, Operation>>; [key: string]: unknown }

const ROLE_LABEL: [string, string][] = [
  ['ORG_ADMIN', 'Admin'], ['ORG_MANAGER', 'Gerente'], ['ORG_MEMBER', 'Membro'], ['CLIENT', 'Cliente'], ['MASTER', 'Master'],
]

const passes = (status: number | undefined) => status !== undefined && status !== 401 && status !== 403

function rolesFor(result: Record<string, number>): string[] {
  if (passes(result.ANON)) return ['público']
  return ROLE_LABEL.filter(([role]) => passes(result[role])).map(([, label]) => label)
}

export function withRoles(spec: Spec, probe: Probe, declared: Record<string, string[]> = {}): Spec & { missing: string[] } {
  const missing: string[] = []
  const paths: Spec['paths'] = {}
  for (const [path, operations] of Object.entries(spec.paths)) {
    paths[path] = {}
    for (const [method, op] of Object.entries(operations)) {
      const key = `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`
      const result = probe[key]
      if (!result) {
        missing.push(key)
        paths[path][method] = op
        continue
      }
      const roles = declared[key] ?? rolesFor(result)
      const who = `**Quem pode:** ${roles.length ? roles.join(', ') : 'quem tem a credencial própria da rota (veja Autenticação)'}`
      paths[path][method] = { ...op, 'x-roles': roles, description: op.description ? `${op.description}\n\n${who}` : who }
    }
  }
  return { ...spec, paths, missing }
}
