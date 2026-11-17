import { api } from '@/lib/api'

// A new password ends the person's other sessions in the API; the one in use is sent to be kept
export function changePassword(currentPassword: string, newPassword: string) {
  const keepRefreshToken = localStorage.getItem('refreshToken')
  return api.post('/auth/change-password', { currentPassword, newPassword, ...(keepRefreshToken ? { keepRefreshToken } : {}) })
}
