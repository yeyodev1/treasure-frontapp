import axios from 'axios'

const TOKEN_KEY = 'treasure.token'

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8200/api',
  // Con la señal del barco una petición colgada no debe dejar la tablet esperando.
  timeout: 20_000,
})

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

/** Vida del token: emitido (iat) y vencimiento (exp), en milisegundos. */
export function tokenTimes(token: string | null): { iat: number; exp: number } | null {
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')))
    return { iat: payload.iat * 1000, exp: payload.exp * 1000 }
  } catch {
    return null
  }
}

/** "Ver como": el servidor aplica los permisos del rol que Gerencia está mirando. */
let viewAsRole: string | null = null
export function setViewAsHeader(role: string | null) {
  viewAsRole = role
}

http.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  if (viewAsRole) config.headers['X-View-As'] = viewAsRole
  return config
})

http.interceptors.response.use(
  (res) => res,
  (error) => {
    // Solo un 401 real cierra la sesión; sin señal o con el servidor
    // arrancando (503) la sesión se conserva.
    if (error.response?.status === 401 && !String(error.config?.url ?? '').includes('/auth/login')) {
      window.dispatchEvent(new CustomEvent('auth:token-expired'))
    }
    return Promise.reject(error)
  },
)

/** Sin respuesta del servidor: sin señal, tiempo agotado o servidor caído. */
export function isNetworkError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false
  return !error.response || error.response.status >= 502
}

/**
 * Mensaje para la persona: qué no se completó y qué hacer (checklist
 * 29-oct, 24). Si el servidor da una causa, se muestra esa.
 */
export function apiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'No se pudo completar. Revisa la conexión e inténtalo de nuevo.'
    const message = (error.response?.data as { message?: string })?.message
    if (message) return message
    return 'No se pudo completar por un fallo del servidor. Inténtalo de nuevo.'
  }
  return 'No se pudo completar. Inténtalo de nuevo; si se repite, recarga la página.'
}
