import axios from 'axios'
import { redirectToLogin, refreshAccessToken } from './auth-refresh'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      const refreshToken = localStorage.getItem('refreshToken')
      if (refreshToken) {
        try {
          const accessToken = await refreshAccessToken()
          error.config.headers.Authorization = `Bearer ${accessToken}`
          return api.request(error.config)
        } catch {
          redirectToLogin()
        }
      }
    }
    return Promise.reject(error)
  },
)
