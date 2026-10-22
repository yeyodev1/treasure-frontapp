import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Acción destructiva: el botón se pinta en rojo. */
  danger?: boolean
  icon?: string
}

/**
 * Confirmaciones de toda la app en un solo modal con estilo propio:
 * `await confirmStore.ask({...})` devuelve true/false.
 */
export const useConfirmStore = defineStore('confirm', () => {
  const current = ref<ConfirmRequest | null>(null)
  const visible = shallowRef(false)

  let resolver: ((value: boolean) => void) | null = null

  function ask(request: ConfirmRequest): Promise<boolean> {
    current.value = request
    visible.value = true
    return new Promise((resolve) => {
      resolver = resolve
    })
  }

  function settle(value: boolean) {
    visible.value = false
    resolver?.(value)
    resolver = null
  }

  return { current, visible, ask, settle }
})
