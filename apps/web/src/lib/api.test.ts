import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { server } from '@/test/server'
import { api } from './api'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '')
const token = () => `${b64({ alg: 'RS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 900 })}.sig`

let logins = 0
let refreshes = 0
beforeEach(() => {
  logins = 0
  refreshes = 0
  // A session of another user is still stored in this browser
  localStorage.setItem('accessToken', token())
  localStorage.setItem('refreshToken', 'r-old')
  server.use(
    http.post(`${API}/auth/login`, () => { logins++; return HttpResponse.json({ message: 'Credenciais inválidas' }, { status: 401 }) }),
    http.post(`${API}/auth/refresh`, () => { refreshes++; return HttpResponse.json({ accessToken: token() }) }),
  )
})
afterEach(() => localStorage.clear())

it('a wrong password is a plain 401: no token refresh, no retry loop', async () => {
  await expect(api.post('/auth/login', { email: 'a@b.com', password: 'errada' })).rejects.toMatchObject({ response: { status: 401 } })
  expect(logins).toBe(1)
  expect(refreshes).toBe(0)
})

it('an expired token is refreshed and the request repeated only once', async () => {
  let calls = 0
  server.use(http.get(`${API}/tasks`, () => { calls++; return HttpResponse.json({ message: 'Token inválido' }, { status: 401 }) }))
  await expect(api.get('/tasks')).rejects.toBeTruthy()
  expect(calls).toBe(2)
  expect(refreshes).toBe(1)
})
