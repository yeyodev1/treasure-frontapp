import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { SessionUser, UserRole } from '@/types'
import { apiLogin, apiMe } from '@/services/api'
import { getToken, setToken } from '@/services/httpBase'

export const useUserStore = defineStore('user', () => {
  const user = ref<SessionUser | null>(null)
  const loading = shallowRef(false)

  /**
   * "Ver como": administración puede mirar la app exactamente como la ve
   * otro rol y volver cuando quiera. Solo cambia lo que se muestra; los
   * permisos reales del backend siguen siendo los de la sesión.
   */
  const viewAs = shallowRef<UserRole | null>(null)

  const isLogged = computed(() => Boolean(user.value))
  const realRole = computed(() => user.value?.role ?? null)
  const role = computed(() => (realRole.value === 'admin' && viewAs.value) || realRole.value)
  const isAdmin = computed(() => role.value === 'admin')
  const isRealAdmin = computed(() => realRole.value === 'admin')
  const canCollect = computed(() => role.value === 'admin' || role.value === 'direccion')

  function setViewAs(target: UserRole | null) {
    if (realRole.value !== 'admin') return
    viewAs.value = target === 'admin' ? null : target
  }

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
    viewAs.value = null
  }

  return {
    user,
    loading,
    isLogged,
    role,
    realRole,
    viewAs,
    isAdmin,
    isRealAdmin,
    canCollect,
    setViewAs,
    login,
    restore,
    clear,
  }
})
