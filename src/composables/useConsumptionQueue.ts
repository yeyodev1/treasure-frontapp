import { computed, ref, shallowRef, watch } from 'vue'
import axios from 'axios'
import { apiConsume, apiHeartbeat } from '@/services/api'
import { apiErrorMessage, isNetworkError } from '@/services/httpBase'
import type { CabinSummary } from '@/types'

/**
 * Cola de consumos del bar (guía auditada 27-oct-2026). Cada toque es un
 * registro con su identificador único: se guarda primero en la tableta
 * (por usuario), se envía en orden y solo se marca Guardado cuando el
 * servidor confirma. Sin señal queda Pendiente y se reintenta con el mismo
 * identificador, así nunca se duplica. Lo no enviado se puede cancelar.
 */
export type QueueState = 'enviando' | 'pendiente'

export interface QueueEntry {
  key: string
  cruiseId: string
  cabinNumber: number
  productId: string
  productName: string
  price: number
  courtesy: boolean
  clientAt: string
  state: QueueState
  attempts: number
}

export interface QueueOutcome {
  entry: QueueEntry
  kind: 'guardado' | 'retenido' | 'rechazado'
  summary?: CabinSummary
  orderId?: string
  message?: string
  code?: string
  missingProductId?: string
}

const DEVICE_KEY = 'treasure.device'

function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export function useConsumptionQueue(options: {
  userId: () => string | null
  cruiseId: () => string | null
  onOutcome: (outcome: QueueOutcome) => void
}) {
  const entries = ref<QueueEntry[]>([])
  const lastSyncAt = shallowRef<string | null>(null)
  const online = shallowRef(navigator.onLine)
  let running = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  const storageKey = () => `treasure.queue.${options.userId() ?? 'anon'}`

  function load() {
    try {
      const raw = localStorage.getItem(storageKey())
      const saved = raw ? (JSON.parse(raw) as QueueEntry[]) : []
      // Lo que quedó "enviando" al cerrar la app se resuelve reenviando con su clave.
      entries.value = saved.map((e) => ({ ...e, state: 'pendiente' as const }))
    } catch {
      entries.value = []
    }
    lastSyncAt.value = localStorage.getItem(`${storageKey()}.sync`)
  }

  function persist() {
    localStorage.setItem(storageKey(), JSON.stringify(entries.value))
  }

  watch(entries, persist, { deep: true })

  const pending = computed(() => entries.value.length)

  function enqueue(input: Omit<QueueEntry, 'key' | 'clientAt' | 'state' | 'attempts'>) {
    const entry: QueueEntry = {
      ...input,
      key: crypto.randomUUID(),
      clientAt: new Date().toISOString(),
      state: 'pendiente',
      attempts: 0,
    }
    entries.value = [...entries.value, entry]
    void run()
    return entry
  }

  /** Solo se cancela lo que aún no salió de la tableta. */
  function cancel(key: string): boolean {
    const entry = entries.value.find((e) => e.key === key)
    if (!entry || entry.state === 'enviando') return false
    entries.value = entries.value.filter((e) => e.key !== key)
    return true
  }

  function remove(key: string) {
    entries.value = entries.value.filter((e) => e.key !== key)
  }

  function scheduleRetry(delay: number) {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = setTimeout(() => void run(), delay)
  }

  async function run() {
    if (running) return
    running = true
    let sent = 0
    try {
      while (entries.value.length) {
        const entry = entries.value[0]!
        entry.state = 'enviando'
        entry.attempts += 1
        try {
          const result = await apiConsume({
            cruiseId: entry.cruiseId,
            cabinNumber: entry.cabinNumber,
            productId: entry.productId,
            courtesy: entry.courtesy,
            idempotencyKey: entry.key,
            clientAt: entry.clientAt,
          })
          remove(entry.key)
          sent += 1
          online.value = true
          lastSyncAt.value = new Date().toISOString()
          localStorage.setItem(`${storageKey()}.sync`, lastSyncAt.value)
          options.onOutcome({
            entry,
            kind: result.held ? 'retenido' : 'guardado',
            summary: result.summary,
            orderId: result.order?._id,
          })
        } catch (err) {
          if (isNetworkError(err) || (axios.isAxiosError(err) && err.response?.status === 401)) {
            // Sin señal o sesión vencida: queda pendiente con la misma clave.
            entry.state = 'pendiente'
            online.value = !isNetworkError(err)
            scheduleRetry(Math.min(30_000, 3_000 * entry.attempts))
            return
          }
          // El servidor no pudo completarlo (sin stock, salida cerrada…): no se guardó nada.
          remove(entry.key)
          const data = axios.isAxiosError(err)
            ? (err.response?.data as { code?: string; productId?: string } | undefined)
            : undefined
          options.onOutcome({
            entry,
            kind: 'rechazado',
            message: apiErrorMessage(err),
            code: data?.code,
            missingProductId: data?.productId,
          })
        }
      }
    } finally {
      running = false
      // Cola vacía: la directora ve al instante que esta tableta ya sincronizó.
      if (sent && !entries.value.length) void heartbeat()
    }
  }

  async function heartbeat() {
    if (!options.userId()) return
    try {
      await apiHeartbeat({
        deviceId: deviceId(),
        label: `Tableta del bar · ${navigator.userAgent.includes('iPad') ? 'iPad' : 'equipo'}`,
        pending: entries.value.length,
        lastSyncAt: lastSyncAt.value,
        cruiseId: options.cruiseId(),
      })
      online.value = true
    } catch (err) {
      if (isNetworkError(err)) online.value = false
    }
  }

  function onOnline() {
    online.value = true
    void run()
    void heartbeat()
  }
  function onOffline() {
    online.value = false
  }

  function start() {
    load()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    heartbeatTimer = setInterval(() => void heartbeat(), 60_000)
    void heartbeat()
    void run()
  }

  function stop() {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (retryTimer) clearTimeout(retryTimer)
  }

  return { entries, pending, online, lastSyncAt, enqueue, cancel, run, start, stop, heartbeat }
}
