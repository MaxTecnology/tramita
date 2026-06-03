// apps/web/e2e/fixtures.ts
import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test'

const API = process.env.VITE_API_URL ?? 'http://localhost:3001'

async function loginAndInject(
  page: Page,
  request: APIRequestContext,
  email: string,
  password: string,
) {
  const res = await request.post(`${API}/auth/login`, {
    data: { email, password },
  })
  expect(res.ok()).toBeTruthy()
  const { accessToken, refreshToken, user } = await res.json()

  await page.goto('/')
  await page.evaluate(
    ({ at, rt, u }) => {
      localStorage.setItem('accessToken', at)
      localStorage.setItem('refreshToken', rt)
      localStorage.setItem('user', JSON.stringify(u))
    },
    { at: accessToken, rt: refreshToken, u: user },
  )
}

export const test = base.extend<{
  orgAdminPage: Page
  clientPage: Page
}>({
  orgAdminPage: async ({ page, request }, use) => {
    await loginAndInject(page, request, 'admin@g2a.com.br', 'G2A@Admin2025')
    await use(page)
  },

  clientPage: async ({ page, request }, use) => {
    await loginAndInject(page, request, 'cliente@g2a.com.br', 'Cliente@2025')
    await use(page)
  },
})

export { expect }
