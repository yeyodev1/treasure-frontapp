import { shallowRef } from 'vue'
import { apiErrorMessage, isNetworkError } from '@/services/httpBase'
import { newKey } from '@/utils/format'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Un intento de guardado con clave única.
 * - Muestra Guardando… y Guardado solo cuando el servidor confirma.
 * - Sin señal, la clave se conserva: reintentar no duplica (el servidor
 *   reconoce la clave y devuelve lo ya guardado).
 * - Si el servidor rechaza (stock, validación), no se guardó nada.
 * `what` nombra lo que se intenta guardar ("la factura") para que el aviso
 * diga qué no se guardó y qué hacer (checklist 29-oct, 24).
 */
export function useSaveAttempt(what = 'el registro') {
  const state = shallowRef<SaveState>('idle')
  const message = shallowRef('')
  const offline = shallowRef(false)
  let key: string | null = null

  function reset() {
    key = null
    state.value = 'idle'
    message.value = ''
    offline.value = false
  }

  async function run<T>(action: (key: string) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    if (state.value === 'saving') return { ok: false, error: new Error('busy') }
    if (!key) key = newKey()
    state.value = 'saving'
    message.value = ''
    offline.value = false
    try {
      const value = await action(key)
      state.value = 'saved'
      key = null
      return { ok: true, value }
    } catch (error) {
      state.value = 'error'
      offline.value = isNetworkError(error)
      message.value = offline.value
        ? `No se pudo guardar ${what}. Revisa la conexión e inténtalo de nuevo; no se duplica. Los datos escritos siguen en pantalla.`
        : apiErrorMessage(error)
      // El servidor lo rechazó: no quedó nada guardado; el próximo intento es otro.
      if (!offline.value) key = null
      return { ok: false, error }
    }
  }

  return { state, message, offline, run, reset }
}
