import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type { SessionUser, UserRole } from '@/types'
import { apiDepartmentLogin, apiLogin, apiMe, apiRefresh } from '@/services/api'
import axios from 'axios'
import { getToken, setToken, setViewAsHeader, tokenTimes } from '@/services/httpBase'

export const useUserStore = defineStore('user', () => {
  const user = ref<SessionUser | null>(null)
  const loading = shallowRef(false)

  /**
   * "Ver como": administración puede mirar la app exactamente como la ve
   * otro rol y volver cuando quiera. Desde el 4-nov-2026 el servidor también
   * le aplica los permisos de ese rol (encabezado X-View-As).
   */
  const viewAs = shallowRef<UserRole | null>(null)

  const isLogged = computed(() => Boolean(user.value))
  const realRole = computed(() => user.value?.role ?? null)
  /** La dueña (Paula) puede mirar la app como otro rol. */
  const canViewAs = computed(() => realRole.value === 'duena')
  const role = computed(() => (canViewAs.value && viewAs.value) || realRole.value)
  /** Dueña: precios, ajustes, conteos, reversos, equipo y finanzas. */
  const isOwner = computed(() => role.value === 'duena')
  /** Compatibilidad: "admin" en la app es la dueña (lo que antes hacía Paula). */
  const isAdmin = isOwner
  const isRealAdmin = computed(() => realRole.value === 'duena')
  /** Administradora: conteo, diferencias, compras y recepciones. */
  const isManager = computed(() => role.value === 'duena' || role.value === 'admin')
  /** Directora y dueña revisan cuentas, cortesías y anulaciones. */
  const isLead = computed(() => role.value === 'duena' || role.value === 'direccion')
  const isDirector = computed(() => role.value === 'duena' || role.value === 'direccion')
  /** Bodega y administradora registran compras, recepciones y cargas. */
  const isWarehouse = computed(() => ['duena', 'admin', 'bodega'].includes(role.value ?? ''))
  /** Cobra la directora (o la dueña). */
  const canCollect = computed(() => role.value === 'duena' || role.value === 'direccion')

  function setViewAs(target: UserRole | null) {
    if (!canViewAs.value) return
    viewAs.value = target === 'duena' ? null : target
  }

  async function login(email: string, password: string, remember = false) {
    loading.value = true
    try {
      const data = await apiLogin(email, password, remember)
      setToken(data.token)
      user.value = data.user
    } finally {
      loading.value = false
    }
  }

  async function loginDepartment(department: string, pin: string, remember = false) {
    loading.value = true
    try {
      const data = await apiDepartmentLogin(department, pin, remember)
      setToken(data.token)
      user.value = data.user
    } finally {
      loading.value = false
    }
  }

  /**
   * Restaura la sesión al recargar si hay token guardado. Solo un 401 la
   * cierra: sin señal se usa el usuario guardado en el token.
   */
  async function restore() {
    const token = getToken()
    if (!token) return
    try {
      user.value = await apiMe()
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        clear()
        return
      }
      const cached = localStorage.getItem('treasure.user')
      if (cached) user.value = JSON.parse(cached) as SessionUser
    }
  }

  /** Renueva el token cuando pasó la mitad de su vida (sesión deslizante). */
  async function refreshIfNeeded() {
    const times = tokenTimes(getToken())
    if (!times || !user.value) return
    const half = times.iat + (times.exp - times.iat) / 2
    if (Date.now() < half) return
    try {
      const data = await apiRefresh()
      setToken(data.token)
      user.value = data.user
    } catch {
      // Se reintenta en el próximo uso.
    }
  }

  function clear() {
    setToken(null)
    localStorage.removeItem('treasure.user')
    user.value = null
    viewAs.value = null
  }

  watch(viewAs, (value) => setViewAsHeader(value), { immediate: true })

  watch(user, (value) => {
    if (value) localStorage.setItem('treasure.user', JSON.stringify(value))
  })

  return {
    user,
    loading,
    isLogged,
    role,
    realRole,
    viewAs,
    isAdmin,
    isOwner,
    isRealAdmin,
    canViewAs,
    isManager,
    isLead,
    isDirector,
    isWarehouse,
    canCollect,
    setViewAs,
    login,
    loginDepartment,
    restore,
    refreshIfNeeded,
    clear,
  }
})
