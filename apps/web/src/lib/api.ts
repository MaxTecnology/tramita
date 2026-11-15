import axios, { type InternalAxiosRequestConfig } from 'axios'
import { redirectToLogin, refreshAccessToken } from './auth-refresh'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// A 401 from the auth routes is an answer (wrong password, invalid refresh), never an expired token
const AUTH_ROUTE = /^\/?auth\//

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const config = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined
    const isAuthRoute = AUTH_ROUTE.test(config?.url ?? '')
    // Refresh and repeat at most once: a request that is refused again is a real 401, not a loop
    if (error.response?.status === 401 && config && !isAuthRoute && !config._retried) {
      const refreshToken = localStorage.getItem('refreshToken')
      if (refreshToken) {
        try {
          const accessToken = await refreshAccessToken()
          config._retried = true
          config.headers.Authorization = `Bearer ${accessToken}`
          return api.request(config)
        } catch {
          redirectToLogin()
        }
      }
    }
    return Promise.reject(error)
  },
)
