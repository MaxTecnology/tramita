import { afterEach, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { changePassword } from './change-password'

afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

it('keeps the session in use (the API ends the other ones)', async () => {
  localStorage.setItem('refreshToken', '0b7c1f0e-8a5e-4a52-9a37-5f0c6b1f2d11')
  const post = vi.spyOn(api, 'post').mockResolvedValue({ data: null })
  await changePassword('Atual@123', 'Nova@12345')
  expect(post).toHaveBeenCalledWith('/auth/change-password', {
    currentPassword: 'Atual@123', newPassword: 'Nova@12345', keepRefreshToken: '0b7c1f0e-8a5e-4a52-9a37-5f0c6b1f2d11',
  })
})

it('without a stored session it only changes the password', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ data: null })
  await changePassword('Atual@123', 'Nova@12345')
  expect(post).toHaveBeenCalledWith('/auth/change-password', { currentPassword: 'Atual@123', newPassword: 'Nova@12345' })
})
