import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { SessionUser } from '@/types'
import { apiLogin, apiMe } from '@/services/api'
import { getToken, setToken } from '@/services/httpBase'

export const useUserStore = defineStore('user', () => {
  const user = ref<SessionUser | null>(null)
  const loading = shallowRef(false)

  const isLogged = computed(() => Boolean(user.value))
  const role = computed(() => user.value?.role ?? null)
  const isAdmin = computed(() => role.value === 'admin')
  const canCollect = computed(() => role.value === 'admin' || role.value === 'direccion')

  async function login(email: string, password: string) {
    loading.value = true
    try {
      const data = await apiLogin(email, password)
      setToken(data.token)
      user.value = data.user
    } finally {
      loading.value = false
    }
  }

  /** Restaura la sesión al recargar si hay token guardado. */
  async function restore() {
    if (!getToken()) return
    try {
      user.value = await apiMe()
    } catch {
      clear()
    }
  }

  function clear() {
    setToken(null)
    user.value = null
  }

  return { user, loading, isLogged, role, isAdmin, canCollect, login, restore, clear }
})
