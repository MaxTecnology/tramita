export type Role = 'MASTER' | 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER' | 'CLIENT'

export interface AuthUser {
  id: string
  name: string
  role: Role
  organizationId: string | null
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  user: AuthUser
}
