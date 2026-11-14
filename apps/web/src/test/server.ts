import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

// Fallback for API calls no test mocked: answer 404 here instead of letting them reach a real
// server (a local API running during the tests would get hit and rate-limit the real session).
// Handlers added with server.use() take precedence over this one.
const neverReachTheRealApi = http.all(`${API}/*`, () => HttpResponse.json({ message: 'Não mockado no teste' }, { status: 404 }))

export const server = setupServer(neverReachTheRealApi)
