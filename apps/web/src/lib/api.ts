import axios from 'axios'

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
          const { data } = await axios.post(
            `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/auth/refresh`,
            { refreshToken },
          )
          localStorage.setItem('accessToken', data.accessToken)
          error.config.headers.Authorization = `Bearer ${data.accessToken}`
          return api.request(error.config)
        } catch {
          localStorage.removeItem('accessToken')
          localStorage.removeItem('refreshToken')
          localStorage.removeItem('user')
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(error)
  },
)
