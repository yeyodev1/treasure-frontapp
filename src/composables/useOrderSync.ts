import { onBeforeUnmount, shallowRef, type ShallowRef } from 'vue'
import { apiSaveWeeklyOrder } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import type { WeeklyOrder } from '@/types'

export type SyncState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'
export type OrderPayload = Array<{ productId: string; qty: number; observation: string; counted: number | null }>

/**
 * BAR - STOCK (19-nov-2026): cada cambio del pedido se guarda solo, un momento
 * después de tocar. Si no hay señal, queda en la tableta (localStorage) y se
 * reintenta; si alguien más cambió el pedido, se avisa en vez de pisarlo.
 */
export function useOrderSync(order: ShallowRef<WeeklyOrder | null>, payload: () => OrderPayload) {
  const sync = shallowRef<SyncState>('idle')
  const message = shallowRef('')
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Sube con cada cambio: si cambió mientras se guardaba, se vuelve a guardar. */
  let rev = 0

  const key = () => (order.value ? `bar-stock:${order.value._id}` : '')

  function persist() {
    if (!order.value) return
    try {
      localStorage.setItem(key(), JSON.stringify({ version: order.value.version, lines: payload() }))
    } catch {
      // Sin almacenamiento: igual se guarda en el servidor.
    }
  }

  function forget() {
    try {
      localStorage.removeItem(key())
    } catch {
      // nada que borrar
    }
  }

  /** Borrador de la tableta que no llegó al servidor (misma versión del pedido). */
  function draft(): OrderPayload | null {
    if (!order.value) return null
    try {
      const raw = localStorage.getItem(key())
      if (!raw) return null
      const d = JSON.parse(raw) as { version: number; lines: OrderPayload }
      if (d.version !== order.value.version) {
        forget()
        return null
      }
      return d.lines
    } catch {
      return null
    }
  }

  function touch() {
    rev += 1
    persist()
    sync.value = 'pending'
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void save(), 1200)
  }

  async function save(): Promise<boolean> {
    const o = order.value
    if (!o) return false
    const mine = rev
    sync.value = 'saving'
    try {
      const saved = await apiSaveWeeklyOrder(o._id, o.version, payload())
      order.value = saved
      if (mine === rev) {
        forget()
        sync.value = 'saved'
      } else {
        persist()
        touch()
      }
      return true
    } catch (err) {
      sync.value = 'error'
      message.value = apiErrorMessage(err)
      return false
    }
  }

  /** Antes de enviar o aprobar, lo pendiente debe estar guardado. */
  async function flush(): Promise<boolean> {
    if (timer) clearTimeout(timer)
    if (sync.value === 'pending' || sync.value === 'error') return save()
    return true
  }

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
  })

  return { sync, message, touch, save, flush, draft, forget }
}

export const SYNC_TEXT: Record<SyncState, string> = {
  idle: '',
  pending: 'Guardando…',
  saving: 'Guardando…',
  saved: 'Guardado',
  error: '',
}
