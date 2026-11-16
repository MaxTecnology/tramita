// Start page of each profile (login and "page not found" lead there)
export function homeForRole(role: string): string {
  if (role === 'MASTER') return '/master/dashboard'
  if (role === 'ORG_ADMIN' || role === 'ORG_MANAGER' || role === 'ORG_MEMBER') return '/app/dashboard'
  return '/portal/home'
}
