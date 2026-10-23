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
  /** Pide un motivo obligatorio antes de confirmar. */
  reason?: {
    label: string
    placeholder?: string
    /** Motivos frecuentes para tocar en vez de escribir. */
    suggestions?: string[]
  }
}

/**
 * Confirmaciones de toda la app en un solo modal con estilo propio.
 * `ask()` devuelve true/false; `askReason()` devuelve el motivo o null.
 */
export const useConfirmStore = defineStore('confirm', () => {
  const current = ref<ConfirmRequest | null>(null)
  const visible = shallowRef(false)
  const reasonText = shallowRef('')

  let resolver: ((value: string | null) => void) | null = null

  function open(request: ConfirmRequest): Promise<string | null> {
    current.value = request
    reasonText.value = ''
    visible.value = true
    return new Promise((resolve) => {
      resolver = resolve
    })
  }

  async function ask(request: Omit<ConfirmRequest, 'reason'>): Promise<boolean> {
    return (await open(request)) !== null
  }

  function askReason(request: ConfirmRequest & { reason: NonNullable<ConfirmRequest['reason']> }) {
    return open(request)
  }

  function settle(confirmed: boolean) {
    if (confirmed && current.value?.reason && !reasonText.value.trim()) return
    visible.value = false
    resolver?.(confirmed ? reasonText.value.trim() || 'ok' : null)
    resolver = null
  }

  return { current, visible, reasonText, ask, askReason, settle }
})
