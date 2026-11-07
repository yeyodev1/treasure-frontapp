<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink } from 'vue-router'
import { useCatalogStore } from '@/stores/catalog'
import { useCruiseStore } from '@/stores/cruise'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'
import { useConsumptionQueue, type QueueOutcome } from '@/composables/useConsumptionQueue'
import { useConsumptionCorrections } from '@/composables/useConsumptionCorrections'
import { apiAvailability, apiCabinSummary, apiCreateRequisition } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { TIMEZONE, formatMoney, formatTime } from '@/utils/format'
import ProductCatalog, { type CatalogFilter } from '@/components/pos/ProductCatalog.vue'
import CocktailBuilder from '@/components/pos/CocktailBuilder.vue'
import CabinAccount from '@/components/pos/CabinAccount.vue'
import TapConfirmation, { type TapState } from '@/components/pos/TapConfirmation.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import type { Availability, CabinConsumption, CabinSummary, CourtesyKind, Product } from '@/types'

/**
 * Bar (guía auditada 27-oct-2026): elegir cabina y tocar la bebida registra
 * lo servido. Sin comanda, sin "Registrar" ni "Entregar" después. Sobre el
 * catálogo, una confirmación grande dice el resultado real (Enviando /
 * Producto agregado a la cuenta / sin conexión / no se agregó).
 * Bar y cuentas en una pantalla (pedido del cliente, 31-oct-2026): la
 * cabina elegida muestra su cuenta completa (por bebida, con − y +, total
 * de hoy y del viaje) y el modo Cortesía; ya no hay barra inferior ni
 * Corregir aparte. Al costado en tableta horizontal; arriba en vertical.
 */
const catalogStore = useCatalogStore()
const cruiseStore = useCruiseStore()
const toast = useToastStore()
const userStore = useUserStore()
const confirmStore = useConfirmStore()
const { play } = useSound()
const corrections = useConsumptionCorrections()

const { sellable, physical } = storeToRefs(catalogStore)
const { active: cruise, cabins } = storeToRefs(cruiseStore)

const loading = shallowRef(true)
const selectedCabin = shallowRef<number | null>(null)
const summaries = ref<Record<number, CabinSummary>>({})
const availability = ref<Availability>({})
/** Modo Cortesía: motivo de la próxima bebida (null = se cobra normal). */
const courtesyMode = shallowRef<{ reason: string; kind: CourtesyKind } | null>(null)
/** Lo que muestra la cuenta mientras la cortesía está activa. */
const courtesyText = computed(() =>
  courtesyMode.value
    ? `${courtesyMode.value.kind === 'agencia' ? 'Agencia' : 'Casa'} · ${courtesyMode.value.reason}`
    : null,
)
const showBuilder = shallowRef(false)
const showQueue = shallowRef(false)
const showMenu = shallowRef(false)
const correcting = shallowRef('')
/**
 * Último registro de la tableta: lo que muestra la barra inferior. Toques
 * seguidos de la misma bebida y cabina se suman (dos toques = dos
 * unidades); cada uno conserva su clave, así un reintento nunca duplica.
 */
interface LastTap {
  keys: string[]
  cabin: number
  productId: string
  name: string
  courtesy: boolean
  saved: string[]
  held: string[]
  rejected: string[]
  at: number
  message?: string
}
const lastTap = shallowRef<LastTap | null>(null)
/** Ventana para sumar toques seguidos de la misma bebida. */
const STREAK_MS = 60_000
const catalogFilter = shallowRef<CatalogFilter>('todas')
const pulse = shallowRef('')
/** Bebida y cabina recién confirmadas por el servidor: se resaltan un momento. */
const confirmed = shallowRef<{ productId: string; cabin: number } | null>(null)
let confirmedTimer: ReturnType<typeof setTimeout> | null = null
/** Posición de la confirmación grande para el último toque. */
const confirmAnchor = shallowRef<{ top?: number; bottom?: number }>({})
/** Alto aproximado de la confirmación más su margen. */
const CONFIRM_SPACE = 104

let availabilityTimer: ReturnType<typeof setInterval> | null = null

/**
 * Modo noche opcional (Especificación de color e iconos, 7-nov-2026): apagado,
 * encendido o automático de 19:00 a 06:00 (hora de Galápagos). Se recuerda en
 * esta tableta.
 */
type NightMode = 'off' | 'on' | 'auto'
const NIGHT_KEY = 'treasure.bar.night'
const NIGHT_OPTIONS: Array<{ value: NightMode; label: string }> = [
  { value: 'off', label: 'Apagado' },
  { value: 'on', label: 'Encendido' },
  { value: 'auto', label: 'Auto 19:00–06:00' },
]
const storedNight = localStorage.getItem(NIGHT_KEY)
const nightMode = shallowRef<NightMode>(storedNight === 'on' || storedNight === 'auto' ? storedNight : 'off')
watch(nightMode, (v) => localStorage.setItem(NIGHT_KEY, v))
const galapagosHour = () => Number(new Date().toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: TIMEZONE }))
const hourNow = shallowRef(galapagosHour())
const isNight = computed(
  () => nightMode.value === 'on' || (nightMode.value === 'auto' && (hourNow.value >= 19 || hourNow.value < 6)),
)
// El fondo de la página también se oscurece mientras se está en el Bar.
watch(isNight, (v) => document.documentElement.classList.toggle('bar-night', v), { immediate: true })

const cabin = computed(() => cabins.value.find((c) => c.number === selectedCabin.value) ?? null)
const summary = computed(() => (selectedCabin.value ? summaries.value[selectedCabin.value] : undefined))
const cruiseLabel = computed(() =>
  cruise.value ? (cruise.value.code ? `Crucero ${cruise.value.code}` : cruise.value.name) : '',
)
const statusLabel = computed(() =>
  cruise.value?.status === 'abordo' ? 'En curso' : cruise.value?.status === 'planificado' ? 'Programado' : 'Finalizado',
)

/** Día de operación y día del viaje (hora de Galápagos). */
const todayLabel = computed(() =>
  new Intl.DateTimeFormat('es-EC', { weekday: 'long', day: 'numeric', month: 'short', timeZone: TIMEZONE }).format(new Date()),
)
const tripDay = computed(() => {
  if (!cruise.value) return null
  const start = new Date(cruise.value.startedAt ?? cruise.value.startDate)
  const key = (d: Date) => new Date(d.toLocaleString('en-US', { timeZone: TIMEZONE })).setHours(0, 0, 0, 0)
  const days = Math.floor((key(new Date()) - key(start)) / 86_400_000) + 1
  return days >= 1 ? days : null
})

const blockedReason = computed(() => {
  if (!cruise.value) return 'Aún no hay crucero programado.'
  if (cruise.value.status === 'planificado') return `${cruiseLabel.value} aún no ha iniciado. Dirección de crucero debe iniciarlo.`
  if (cruise.value.status === 'cerrado') return `La operación de ${cruiseLabel.value} está finalizada: ya no se registran consumos nuevos.`
  if (!cabin.value) return 'Elige la cabina.'
  return ''
})

// ---- Contexto del bar al recargar (checklist 29-oct, 14) ----
// Se guarda por usuario y salida: otro usuario u otro crucero empiezan de cero.
const contextKey = computed(() =>
  userStore.user?.id && cruise.value?._id ? `treasure.bar.${userStore.user.id}.${cruise.value._id}` : null,
)
let restoredKey: string | null = null
const cabinsEl = useTemplateRef<HTMLElement>('cabinsEl')
const chargeEl = useTemplateRef<HTMLElement>('chargeEl')
const accountEl = useTemplateRef<HTMLElement>('accountEl')

function restoreContext() {
  const key = contextKey.value
  if (!key || key === restoredKey) return
  restoredKey = key
  selectedCabin.value = null
  catalogFilter.value = effectiveFavorites.value.length ? 'favoritos' : 'todas'
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as { cabin?: number; filter?: CatalogFilter } | null
    if (!saved) return
    if (saved.filter) catalogFilter.value = saved.filter
    const c = cabins.value.find((x) => x.number === saved.cabin)
    // Solo si la cabina sigue con pasajeros; si no, se elige de nuevo.
    if (c?.passengers.length) {
      selectedCabin.value = c.number
      void nextTick(() =>
        cabinsEl.value?.querySelector(`[data-cabin="${c.number}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' }),
      )
    }
  } catch {
    // Contexto ilegible: se elige de nuevo.
  }
}

watch([selectedCabin, catalogFilter], ([cabinNumber, filter]) => {
  const key = contextKey.value
  if (!key || key !== restoredKey) return
  localStorage.setItem(key, JSON.stringify({ cabin: cabinNumber, filter }))
})

// Cambia el usuario o el crucero: se pide elegir cabina, sin heredar nada.
watch(contextKey, () => {
  if (!loading.value) restoreContext()
})

const queue = useConsumptionQueue({
  userId: () => userStore.user?.id ?? null,
  cruiseId: () => cruise.value?._id ?? null,
  onOutcome,
})

/** Nombre abreviado bajo "Cab N": el pagador (o el primero) y cuántos más. */
function passengerNames(c: { passengers: Array<{ name: string; isPayer?: boolean }> }) {
  const main = c.passengers.find((p) => p.isPayer) ?? c.passengers[0]
  if (!main) return ''
  const first = main.name.trim().split(/\s+/)[0] ?? main.name
  return c.passengers.length > 1 ? `${first} +${c.passengers.length - 1}` : first
}

async function loadAvailability() {
  try {
    availability.value = await apiAvailability()
  } catch {
    // Informativo: el servidor igual bloquea lo que no tiene stock.
  }
}

async function loadSummary(number: number) {
  if (!cruise.value) return
  try {
    summaries.value = { ...summaries.value, [number]: await apiCabinSummary(cruise.value._id, number) }
  } catch {
    // Sin señal: se actualiza con la próxima confirmación.
  }
}

watch(selectedCabin, (n) => {
  if (n) void loadSummary(n)
})

onMounted(async () => {
  try {
    await Promise.all([catalogStore.load(true), cruiseStore.loadActive(true), loadAvailability()])
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
  restoreContext()
  queue.start()
  // Otra tableta pudo cargar a la misma cabina: la cuenta se refresca sola.
  availabilityTimer = setInterval(() => {
    hourNow.value = galapagosHour()
    void loadAvailability()
    if (selectedCabin.value) void loadSummary(selectedCabin.value)
  }, 60_000)
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('bar-night')
  queue.stop()
  if (availabilityTimer) clearInterval(availabilityTimer)
  if (confirmedTimer) clearTimeout(confirmedTimer)
})

/** Un toque intencional suma una unidad a la cabina elegida. */
function tap(product: Product) {
  if (blockedReason.value || !cruise.value || !cabin.value) {
    play('error')
    toast.error(blockedReason.value || 'Elige la cabina')
    return
  }
  const state = availability.value[product._id]
  if (state && !state.available) {
    play('error')
    toast.error(`${product.name} no está disponible: falta ${state.missing}`)
    return
  }
  const entry = queue.enqueue({
    cruiseId: cruise.value._id,
    cabinNumber: cabin.value.number,
    productId: product._id,
    productName: product.name,
    price: product.price,
    courtesy: Boolean(courtesyMode.value),
    courtesyReason: courtesyMode.value?.reason,
    courtesyKind: courtesyMode.value?.kind,
  })
  rememberUse(product._id)
  const prev = lastTap.value
  const now = Date.now()
  const sameStreak =
    prev &&
    prev.cabin === entry.cabinNumber &&
    prev.productId === product._id &&
    prev.courtesy === entry.courtesy &&
    now - prev.at < STREAK_MS &&
    prev.rejected.length < prev.keys.length
  lastTap.value = sameStreak
    ? { ...prev!, keys: [...prev!.keys, entry.key], at: now }
    : {
        keys: [entry.key],
        cabin: entry.cabinNumber,
        productId: product._id,
        name: product.name,
        courtesy: entry.courtesy,
        saved: [],
        held: [],
        rejected: [],
        at: now,
      }
  confirmAnchor.value = anchorFor(product._id)
  pulse.value = product._id
  setTimeout(() => {
    if (pulse.value === product._id) pulse.value = ''
  }, 380)
  play('tap')
  if (courtesyMode.value) courtesyMode.value = null
}

/**
 * Cortesía en el mismo pedido: se pide el motivo y la próxima bebida que se
 * toque va como cortesía (no se cobra; el stock sí se descuenta). Tocar de
 * nuevo lo desactiva.
 */
async function toggleCourtesy() {
  if (courtesyMode.value) {
    courtesyMode.value = null
    return
  }
  const answer = await confirmStore.askChoice({
    title: 'La próxima bebida va como cortesía',
    message: 'No se cobra a la cabina, pero se descuentan los ingredientes. La de agencia se junta en Cuentas › «Cortesías de agencia» para facturarla al final del crucero.',
    confirmLabel: 'Activar cortesía',
    icon: 'fa-gift',
    choice: corrections.COURTESY_CHOICE,
    reason: { label: 'Motivo (obligatorio)', suggestions: corrections.COURTESY_REASONS },
  })
  if (answer) courtesyMode.value = { reason: answer.reason, kind: answer.choice as CourtesyKind }
}

/**
 * La confirmación va bajo las cabinas si cabe antes de la bebida tocada; si
 * no, sobre la barra inferior; si tampoco, bajo la cabecera. Así no tapa la
 * tarjeta ni la cabina que se resaltan al confirmar.
 */
function anchorFor(productId: string): { top?: number; bottom?: number } {
  const card = document.querySelector(`[data-product="${productId}"]`)?.getBoundingClientRect()
  const header = document.querySelector('.context')?.getBoundingClientRect().bottom ?? 0
  const footer = window.innerHeight
  // La cuenta va arriba de la carta salvo en pantallas anchas (al costado).
  const accountAbove = window.innerWidth < 1024
  const cabinsBottom = Math.max(
    cabinsEl.value?.getBoundingClientRect().bottom ?? 0,
    chargeEl.value?.getBoundingClientRect().bottom ?? 0,
    accountAbove ? (accountEl.value?.getBoundingClientRect().bottom ?? 0) : 0,
  )
  if (!card) return {}
  const top = Math.max(header, cabinsBottom) + 10
  if (top + CONFIRM_SPACE <= card.top) return { top }
  if (footer - 10 - CONFIRM_SPACE >= card.bottom) return { bottom: window.innerHeight - footer + 10 }
  return { top: header + 10 }
}

/**
 * Estado real del último registro: Enviando mientras el servidor responde;
 * Guardado solo cuando confirmó todas sus unidades (checklist 29-oct, 13).
 */
const tapState = computed<TapState | null>(() => {
  const t = lastTap.value
  if (!t) return null
  const inQueue = queue.entries.value.filter((e) => t.keys.includes(e.key))
  if (inQueue.some((e) => e.state === 'enviando')) return 'enviando'
  if (inQueue.length) return 'pendiente'
  if (t.rejected.length === t.keys.length) return 'rechazado'
  if (t.held.length) return 'retenido'
  if (t.saved.length + t.rejected.length >= t.keys.length) return t.rejected.length ? 'rechazado' : 'guardado'
  return 'enviando'
})

/** Unidades del último registro que siguen en pie (sin las rechazadas). */
const tapUnits = computed(() => (lastTap.value ? lastTap.value.keys.length - lastTap.value.rejected.length : 0))

/**
 * Unidades que nombra la confirmación grande: agregadas cuando todo se
 * guardó; las que faltan por enviar mientras envía o queda pendiente; las
 * rechazadas si no se agregó. Nunca dice "agregado" de lo no confirmado.
 */
const confirmUnits = computed(() => {
  const t = lastTap.value
  if (!t) return 0
  if (tapState.value === 'enviando' || tapState.value === 'pendiente') {
    return queue.entries.value.filter((e) => t.keys.includes(e.key)).length || 1
  }
  if (tapState.value === 'rechazado') return t.rejected.length
  if (tapState.value === 'retenido') return t.held.length
  return tapUnits.value
})

function markLast(key: string, field: 'saved' | 'held' | 'rejected', message?: string) {
  const t = lastTap.value
  if (!t || !t.keys.includes(key)) return
  lastTap.value = { ...t, [field]: [...t[field], key], ...(message ? { message } : {}) }
}

function onOutcome(outcome: QueueOutcome) {
  if (outcome.kind === 'guardado') {
    if (outcome.summary) {
      summaries.value = { ...summaries.value, [outcome.summary.cabinNumber]: outcome.summary }
    }
    markLast(outcome.entry.key, 'saved')
    flashConfirmed(outcome.entry.productId, outcome.entry.cabinNumber)
    play('success')
    void loadAvailability()
    return
  }
  // Retenido y no guardado los dice la confirmación grande; si no es el
  // último toque (ya se tocó otra bebida), queda también un aviso.
  const isLast = lastTap.value?.keys.includes(outcome.entry.key)
  if (outcome.kind === 'retenido') {
    markLast(outcome.entry.key, 'held')
    if (!isLast) toast.push(`${outcome.entry.productName}: el crucero ya estaba finalizado; queda retenido para revisión`)
    return
  }
  markLast(outcome.entry.key, 'rejected', outcome.message)
  play('error')
  if (!isLast) toast.error(`No se guardó ${outcome.entry.productName} (cabina ${outcome.entry.cabinNumber}): ${outcome.message}`)
  void loadAvailability()
}

function flashConfirmed(productId: string, cabinNumber: number) {
  if (confirmedTimer) clearTimeout(confirmedTimer)
  // Se suelta un cuadro para que la misma bebida confirmada otra vez vuelva a destellar.
  confirmed.value = null
  requestAnimationFrame(() => {
    confirmed.value = { productId, cabin: cabinNumber }
    confirmedTimer = setTimeout(() => (confirmed.value = null), 1400)
  })
}

/** La cuenta se muestra con la cabina elegida y el crucero en curso. */
const showAccount = computed(() => !loading.value && Boolean(cabin.value) && !blockedReason.value)

/** Envíos de esta tableta a la cabina elegida que el servidor aún no confirma. */
const queuedForCabin = computed(() =>
  queue.entries.value.filter((e) => e.cabinNumber === selectedCabin.value && e.cruiseId === cruise.value?._id),
)

/** Unidades de hoy en la cabina por bebida: la tarjeta dice «×2 hoy» (7-nov-2026). */
const todayCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const c of summary.value?.recent ?? []) {
    if (c.today && c.productId && c.qty > 0) counts[c.productId] = (counts[c.productId] ?? 0) + c.qty
  }
  for (const e of queuedForCabin.value) counts[e.productId] = (counts[e.productId] ?? 0) + 1
  return counts
})

const sellableById = computed(() => new Map(sellable.value.map((p) => [p._id, p])))

/** + en la cuenta: la bebida sigue en la carta y no está agotada. */
function canAdd(productId: string) {
  return sellableById.value.has(productId) && availability.value[productId]?.available !== false
}

function addById(productId: string) {
  const product = sellableById.value.get(productId)
  if (product) tap(product)
}

/** Cortesía o Retirar consumo sobre un consumo de la cuenta. */
async function correctRecent(item: CabinConsumption, kind: 'courtesy' | 'retire') {
  if (correcting.value) return
  const cabinNumber = summary.value?.cabinNumber
  const line = { orderId: item.orderId, name: item.name, qty: item.qty, courtesy: item.courtesy }
  correcting.value = item.orderId
  try {
    const result = kind === 'courtesy' ? await corrections.courtesy(line) : await corrections.retire(line)
    if (!result) return
    if (result.summary) summaries.value = { ...summaries.value, [result.summary.cabinNumber]: result.summary }
    else if (cabinNumber) await loadSummary(cabinNumber)
    lastTap.value = null
    play('success')
    toast.success(result.message)
    void loadAvailability()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    correcting.value = ''
  }
}

async function cancelQueued(key: string, name: string) {
  const ok = await confirmStore.ask({
    title: `¿Cancelar ${name}?`,
    message: 'Todavía no llegó al servidor: se quita de esta tableta y no queda en la cuenta.',
    confirmLabel: 'Cancelar envío',
    danger: true,
    icon: 'fa-ban',
  })
  if (!ok) return
  if (!queue.cancel(key)) {
    toast.error('Se está enviando: espera a que el servidor responda')
    return
  }
  const t = lastTap.value
  if (t?.keys.includes(key)) {
    const keys = t.keys.filter((k) => k !== key)
    lastTap.value = keys.length ? { ...t, keys } : null
  }
}

/** El producto aparece agotado pero está en la barra: pedir revisión de inventario. */
async function requestReview(product: Product) {
  const reason = await confirmStore.askReason({
    title: `¿Pedir revisión de inventario de ${product.name}?`,
    message: 'Se revisará con un conteo físico. No se registra el consumo hasta corregir el stock.',
    confirmLabel: 'Pedir revisión',
    icon: 'fa-clipboard-question',
    reason: { label: 'Qué ves', suggestions: ['Hay una botella abierta en la barra', 'Llegó mercadería sin registrar'] },
  })
  if (!reason) return
  const missingId = availability.value[product._id]?.missing
    ? physical.value.find((p) => p.name === availability.value[product._id]!.missing)?._id ?? product._id
    : product._id
  try {
    const req = await apiCreateRequisition({
      kind: 'revision',
      lines: [{ productId: missingId, qty: 0 }],
      note: `${product.name}: ${reason}`,
      idempotencyKey: crypto.randomUUID(),
    })
    play('success')
    toast.success(`Revisión ${req.code} enviada · Se revisará con un conteo.`)
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  }
}

// ---- Favoritos (por usuario y tableta) ----
const favoritesKey = computed(() => `treasure.favorites.${userStore.user?.id ?? 'anon'}`)
const usageKey = computed(() => `treasure.usage.${userStore.user?.id ?? 'anon'}`)
const favorites = ref<string[]>(JSON.parse(localStorage.getItem(favoritesKey.value) ?? '[]'))

function toggleFavorite(product: Product) {
  favorites.value = favorites.value.includes(product._id)
    ? favorites.value.filter((id) => id !== product._id)
    : [...favorites.value, product._id]
  localStorage.setItem(favoritesKey.value, JSON.stringify(favorites.value))
  play('tap')
}

function rememberUse(id: string) {
  const usage = JSON.parse(localStorage.getItem(usageKey.value) ?? '{}') as Record<string, number>
  usage[id] = (usage[id] ?? 0) + 1
  localStorage.setItem(usageKey.value, JSON.stringify(usage))
}

/** Sin favoritos elegidos: los más tocados en esta tableta. */
const effectiveFavorites = computed(() => {
  if (favorites.value.length) return favorites.value
  const usage = JSON.parse(localStorage.getItem(usageKey.value) ?? '{}') as Record<string, number>
  return Object.entries(usage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id]) => id)
})

function onCocktailCreated(product: Product) {
  catalogStore.upsert(product)
  showBuilder.value = false
  play('success')
  toast.success(`Cóctel "${product.name}" creado por ${formatMoney(product.price)}: tócalo para registrarlo`)
  void loadAvailability()
}

/** Cócteles creados en el bar que siguen en la carta (se pueden eliminar). */
const customCocktails = computed(() => sellable.value.filter((p) => p.isCustom))

function onCocktailRemoved(product: Product) {
  catalogStore.remove(product._id)
  favorites.value = favorites.value.filter((id) => id !== product._id)
  localStorage.setItem(favoritesKey.value, JSON.stringify(favorites.value))
  play('success')
  toast.success(`Cóctel "${product.name}" eliminado de la carta`)
}

function onEmptyCabin(number: number) {
  toast.push(`Cabina ${number} sin pasajeros. Dirección de crucero debe registrarlos.`)
}

</script>

<template>
  <div class="bar" :class="{ 'bar--night': isNight }">
    <!-- Arriba: contexto y navegación siempre visibles -->
    <header class="context">
      <div class="context-main">
        <i class="fa-solid fa-ship" aria-hidden="true" />
        <span class="context-text">
          <template v-if="cruise">
            {{ cruiseLabel }}<span v-if="cruise.routeFrom" class="context-route"> · {{ cruise.routeFrom }} → {{ cruise.routeTo }}</span>
          </template>
          <template v-else>Sin crucero</template>
        </span>
        <span v-if="cruise" class="context-status" :class="`context-status--${cruise.status}`">{{ statusLabel }}</span>
        <span v-if="tripDay && cruise?.status === 'abordo'" class="trip-day-badge">Día {{ tripDay }}</span>
      </div>
      <div class="context-date">
        <span class="today">{{ todayLabel }}</span>
        <span v-if="tripDay && cruise?.status === 'abordo'" class="trip-day">Día {{ tripDay }} del viaje</span>
      </div>
      <!-- Envíos sin confirmar de esta tableta: siempre a la vista -->
      <button
        v-if="queue.pending.value"
        type="button"
        class="queue-btn"
        :class="{ 'queue-btn--offline': !queue.online.value }"
        @click="showQueue = true"
      >
        <i class="fa-solid fa-cloud-arrow-up" aria-hidden="true" />
        {{ queue.pending.value }} sin confirmar
      </button>
      <!-- Bar y Abastecimiento ya están en la navegación de la app; aquí solo los atajos del bar -->
      <button type="button" class="tab tab--menu" :aria-expanded="showMenu" @click="showMenu = true">
        <i class="fa-solid fa-ellipsis" aria-hidden="true" /> Más
      </button>
    </header>

    <div class="page bar-page">
      <!-- Cabinas con sus pasajeros -->
      <section class="block">
        <SkeletonList v-if="loading" variant="tile" :rows="9" />
        <div
          v-else
          ref="cabinsEl"
          class="cabins"
          role="radiogroup"
          aria-label="Cabina"
          :style="{ '--cabin-cols': cabins.length }"
        >
          <button
            v-for="c in cabins"
            :key="c.number"
            type="button"
            role="radio"
            class="cabin"
            :class="{
              'cabin--active': c.number === selectedCabin,
              'cabin--empty': !c.passengers.length,
              'cabin--confirmed': confirmed?.cabin === c.number,
            }"
            :aria-checked="c.number === selectedCabin"
            :data-cabin="c.number"
            @click="c.passengers.length ? (selectedCabin = c.number) : onEmptyCabin(c.number)"
          >
            <span class="cabin-number">Cab {{ c.number }}</span>
            <span class="cabin-guests">{{ c.passengers.length ? passengerNames(c) : 'Sin pasajeros' }}</span>
          </button>
        </div>

        <!-- Sin cabina o sin crucero en curso: qué falta -->
        <Transition name="fade">
          <p v-if="!loading && blockedReason" ref="chargeEl" class="blocked">
            <i class="fa-solid" :class="cabin ? 'fa-circle-info' : 'fa-hand-pointer'" aria-hidden="true" /> {{ blockedReason }}
          </p>
        </Transition>
      </section>

      <div class="bar-grid" :class="{ 'bar-grid--account': showAccount }">
        <!-- La cuenta de la cabina elegida: arriba en vertical, al costado en horizontal -->
        <aside v-if="showAccount && cabin" ref="accountEl" class="account-col">
          <Transition name="fade" mode="out-in">
            <CabinAccount
              :key="cabin.number"
              :cabin="cabin"
              :summary="summary"
              :queued="queuedForCabin"
              :can-add="canAdd"
              :courtesy-mode="courtesyText"
              :correcting="correcting"
              @add="addById"
              @retire="(item) => correctRecent(item, 'retire')"
              @courtesy="(item) => correctRecent(item, 'courtesy')"
              @toggle-courtesy="toggleCourtesy"
            />
          </Transition>
        </aside>

        <!-- Bebidas fáciles de tocar -->
        <section class="block catalog-col">
          <SkeletonList v-if="loading" variant="tile" :rows="12" />
          <ProductCatalog
            v-else
            :products="sellable"
            :availability="availability"
            v-model:filter="catalogFilter"
            :favorites="effectiveFavorites"
            :pinned="favorites"
            :pulse="pulse"
            :confirmed="confirmed?.productId ?? ''"
            :disabled="Boolean(blockedReason)"
            :today-counts="todayCounts"
            :target="cabin ? `la Cabina ${cabin.number}` : ''"
            @add="tap"
            @toggle-favorite="toggleFavorite"
            @request-review="requestReview"
            @create-cocktail="showBuilder = true"
          />
        </section>
      </div>
    </div>

    <!-- Confirmación grande del último toque (sobre el catálogo, no bloquea) -->
    <TapConfirmation
      v-if="lastTap"
      :state="tapState"
      :cabin="lastTap.cabin"
      :units="confirmUnits"
      :name="lastTap.name"
      :message="lastTap.message"
      :offline="queue.offlineConfirmed.value"
      :stamp="`${lastTap.at}.${lastTap.saved.length}.${lastTap.held.length}.${lastTap.rejected.length}`"
      :anchor="confirmAnchor"
    />

    <!-- Envíos sin confirmar en esta tableta -->
    <BaseModal v-if="showQueue" title="Sin confirmar en esta tableta" @close="showQueue = false">
      <p class="queue-help">
        <template v-if="queue.online.value">Se están enviando en orden. No cierres la sesión.</template>
        <template v-else-if="queue.offlineConfirmed.value">Sin conexión: se envían solos al volver la conexión, sin duplicarse.</template>
        <template v-else>El servidor no respondió: se reintentan solos, sin duplicarse.</template>
      </p>
      <ul class="queue-list">
        <li v-for="e in queue.entries.value" :key="e.key" class="queue-item">
          <span>
            <strong>Cabina {{ e.cabinNumber }}</strong> · 1 {{ e.productName }}
            <small>{{ formatTime(e.clientAt) }} · {{ e.state === 'enviando' ? 'Enviando…' : 'Pendiente' }}</small>
          </span>
          <button
            type="button"
            class="queue-cancel"
            :disabled="e.state === 'enviando'"
            @click="cancelQueued(e.key, e.productName)"
          >
            Cancelar
          </button>
        </li>
      </ul>
      <button type="button" class="btn btn-primary" @click="queue.run()">
        <i class="fa-solid fa-rotate" aria-hidden="true" /> Reintentar ahora
      </button>
    </BaseModal>

    <!-- Menú del bar: abastecimiento -->
    <BaseModal v-if="showMenu" title="Atajos del bar" @close="showMenu = false">
      <div class="menu-grid">
        <RouterLink to="/inventario/pedido" class="menu-tile" @click="showMenu = false">
          <i class="fa-solid fa-calendar-week" aria-hidden="true" />
          <strong>Pedido semanal</strong>
          <small>Revisa la propuesta del miércoles y envíala a revisión.</small>
        </RouterLink>
        <RouterLink to="/inventario/compras/solicitudes?nuevo=1" class="menu-tile" @click="showMenu = false">
          <i class="fa-solid fa-dolly" aria-hidden="true" />
          <strong>Solicitar producto</strong>
          <small>Producto, cantidad y unidad. Dirección de crucero la aprueba.</small>
        </RouterLink>
        <RouterLink to="/inventario/compras/solicitudes" class="menu-tile" @click="showMenu = false">
          <i class="fa-solid fa-list-check" aria-hidden="true" />
          <strong>Mis solicitudes</strong>
          <small>Solicitada, aprobada, recibida.</small>
        </RouterLink>
        <button type="button" class="menu-tile" @click="(showMenu = false), (showBuilder = true)">
          <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
          <strong>Crear cóctel</strong>
          <small>Con precio automático según sus medidas.</small>
        </button>
      </div>
      <div class="night" role="group" aria-labelledby="night-label">
        <span id="night-label" class="night-label"><i class="fa-solid fa-moon" aria-hidden="true" /> Modo noche</span>
        <div class="night-options">
          <button
            v-for="opt in NIGHT_OPTIONS"
            :key="opt.value"
            type="button"
            class="night-option"
            :class="{ 'night-option--on': nightMode === opt.value }"
            :aria-pressed="nightMode === opt.value"
            @click="nightMode = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </BaseModal>

    <CocktailBuilder
      v-if="showBuilder"
      :physical="physical"
      :custom="customCocktails"
      @close="showBuilder = false"
      @created="onCocktailCreated"
      @removed="onCocktailRemoved"
    />
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.bar {
  min-width: 0;
  padding-bottom: calc(1.5rem + env(safe-area-inset-bottom));
}

// Bajo la cabecera de la app (barra + secciones; solo la barra en escritorio).
.context {
  position: sticky;
  top: calc(var(--header-h, 64px) + env(safe-area-inset-top));
  z-index: 15;
  display: flex;
  align-items: center;
  gap: 0.5rem 1rem;
  padding: 0.4rem max(16px, env(safe-area-inset-left, 0px));
  background: var(--navy-700);
  color: #fff;

  @include desktop {
    padding: 0.6rem 1.5rem;
  }
}

.context-main {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  flex: 1 1 auto;

  > i {
    color: var(--powder-300);
  }
}

.context-route {
  display: none;

  @include tablet {
    display: inline;
  }
}

.context-text {
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-status {
  flex-shrink: 0;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);

  &--abordo {
    background: #4f9a6c;
  }
}

.trip-day-badge {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);

  @include tablet {
    display: none;
  }
}

.context-date {
  display: none;
  gap: 0.6rem;
  align-items: baseline;
  font-size: 0.85rem;
  color: var(--powder-300);

  @include tablet {
    display: flex;
  }

  .today {
    text-transform: capitalize;
  }

  .trip-day {
    font-weight: 700;
    color: #fff;
  }
}

.tab {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 48px;
  padding: 0 0.95rem;
  border-radius: 12px;
  font-weight: 600;
  font-size: 0.9rem;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  transition:
    background 0.15s ease,
    transform 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  &:active {
    transform: scale(0.97);
  }

  &--on {
    background: var(--surface);
    color: var(--navy-ink, var(--navy-800));
  }

  &--menu {
    padding: 0 0.8rem;
  }
}

.bar-page {
  padding-top: 0.6rem;

  @include tablet {
    padding-top: 0.9rem;
  }
}

.block {
  min-width: 0;
  margin-bottom: 0.6rem;

  @include tablet {
    margin-bottom: 1rem;
  }
}

// Celular (checklist 29-oct, 12): las 9 cabinas en una fila deslizable para
// que las bebidas queden a la vista; cada cabina conserva 48 px de toque.
.cabins {
  display: flex;
  gap: 0.45rem;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
  padding: 0.15rem 0;

  &::-webkit-scrollbar {
    display: none;
  }

  .cabin {
    flex: 0 0 auto;
    width: 92px;
    scroll-snap-align: start;
  }

  // Tableta: todas las cabinas en una sola fila, sin huérfanas.
  @include tablet {
    display: grid;
    grid-template-columns: repeat(var(--cabin-cols, 9), minmax(0, 1fr));
    gap: 0.45rem;
    overflow: visible;
    padding: 0;

    .cabin {
      width: auto;
    }
  }
}

.cabin {
  @include touch-target;
  min-width: 0;
  min-height: 62px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0.2rem;
  padding: 0.5rem 0.6rem;

  @include tablet {
    padding: 0.5rem 0.5rem;
  }
  background: var(--surface);
  border: 2px solid var(--cream-200);
  border-radius: var(--radius-sm);
  text-align: left;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.12s ease,
    box-shadow 0.15s ease;

  &:active {
    transform: scale(0.97);
  }

  &--active {
    border-color: var(--navy-800);
    background: var(--navy-800);
    color: #fff;
    box-shadow: var(--shadow-lg);

    .cabin-guests {
      color: var(--powder-300);
    }
  }

  &--empty {
    opacity: 0.5;
    border-style: dashed;
  }

  // Recién confirmada por el servidor: destello de éxito.
  &--confirmed {
    animation: cabin-confirmed 1.4s ease;
  }
}

@keyframes cabin-confirmed {
  0%,
  60% {
    box-shadow:
      0 0 0 3px var(--surface),
      0 0 0 6px var(--success);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(63, 122, 87, 0);
  }
}

.cabin-number {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  font-family: var(--font-serif);
  font-size: 1.2rem;
  white-space: nowrap;
  font-weight: 700;
  line-height: 1;
}

.cabin-guests {
  width: 100%;
  font-size: 0.78rem;
  color: var(--ink-400);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// Carta y cuenta de la cabina. Celular y tableta vertical: la cuenta arriba
// (con su propio scroll). Pantalla ancha: la cuenta fija al costado.
.bar-grid {
  display: flex;
  flex-direction: column;
  min-width: 0;

  @include desktop {
    &--account {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(300px, 340px);
      grid-template-areas: 'catalog account';
      align-items: start;
      gap: 1.1rem;
    }
  }
}

.catalog-col {
  grid-area: catalog;
}

.account-col {
  grid-area: account;
  min-width: 0;
  margin-bottom: 0.8rem;

  @include desktop {
    position: sticky;
    top: calc(var(--header-h, 64px) + env(safe-area-inset-top) + 76px);
    margin-bottom: 0;

    > .account {
      // Cabe entero antes de desplazarse (bajo cabecera, contexto y cabinas):
      // los totales siempre a la vista; la lista se desplaza por dentro.
      max-height: calc(100dvh - var(--header-h, 64px) - env(safe-area-inset-top) - 190px);
      min-height: 320px;
    }
  }
}

.blocked {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  min-height: 48px;
  margin-top: 0.6rem;
  padding: 0.5rem 0.9rem;
  border-radius: var(--radius-sm);
  border: 1.5px dashed var(--powder-300);
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--ink-600);

  i {
    color: var(--navy-ink, var(--navy-600));
  }
}

// En la cabecera oscura: aviso de envíos sin confirmar.
.queue-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 44px;
  padding: 0 0.9rem;
  border-radius: 12px;
  font-weight: 700;
  font-size: 0.85rem;
  background: #f3dfb8;
  color: #6b4a14;
  transition: transform 0.12s ease;

  &:active {
    transform: scale(0.97);
  }

  &--offline {
    background: #f6c9c0;
    color: #7a2417;
  }
}

.queue-help {
  margin-bottom: 0.8rem;
  color: var(--ink-600);
  font-size: 0.9rem;
}

.queue-list {
  list-style: none;
  padding: 0;
  margin: 0 0 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.queue-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--cream-200);
  border-radius: var(--radius-sm);

  small {
    display: block;
    color: var(--ink-400);
  }
}

.queue-cancel {
  min-height: 44px;
  padding: 0 0.8rem;
  border-radius: 10px;
  color: var(--danger);
  font-weight: 700;

  &:disabled {
    opacity: 0.4;
  }
}

.menu-grid {
  display: grid;
  gap: 0.6rem;
}

.night {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem 1rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
}

.night-label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
}

.night-options {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.night-option {
  min-height: 44px;
  padding: 0 0.9rem;
  border-radius: 999px;
  border: 1.5px solid var(--cream-200);
  font-weight: 600;
  font-size: 0.88rem;
  color: var(--ink-600);

  &--on {
    background: #27445a;
    border-color: #27445a;
    color: #fff;
  }
}

.menu-tile {
  display: grid;
  grid-template-columns: 44px 1fr;
  grid-template-rows: auto auto;
  column-gap: 0.75rem;
  align-items: center;
  min-height: 72px;
  padding: 0.75rem 0.9rem;
  border: 2px solid var(--cream-200);
  border-radius: var(--radius);
  text-align: left;
  transition:
    border-color 0.15s ease,
    transform 0.12s ease;

  &:hover {
    border-color: var(--navy-600);
  }

  &:active {
    transform: scale(0.98);
  }

  i {
    grid-row: span 2;
    font-size: 1.4rem;
    color: var(--gold-ink, var(--gold-500));
  }

  small {
    color: var(--ink-400);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
