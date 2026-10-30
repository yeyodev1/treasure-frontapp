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
import {
  apiAvailability,
  apiCabinSummary,
  apiCreateRequisition,
  apiUndoConsumption,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { TIMEZONE, formatMoney, formatTime } from '@/utils/format'
import ProductCatalog, { type CatalogFilter } from '@/components/pos/ProductCatalog.vue'
import CocktailBuilder from '@/components/pos/CocktailBuilder.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import type { Availability, CabinSummary, Product } from '@/types'

/**
 * Bar (guía auditada 27-oct-2026): elegir cabina y tocar la bebida registra
 * lo servido. Sin comanda, sin "Registrar" ni "Entregar" después. La barra
 * inferior muestra el resultado real (Enviando / Pendiente / Guardado), el
 * total de hoy y del viaje y el botón Deshacer error.
 */
const catalogStore = useCatalogStore()
const cruiseStore = useCruiseStore()
const toast = useToastStore()
const userStore = useUserStore()
const confirmStore = useConfirmStore()
const { play } = useSound()

const { sellable, physical } = storeToRefs(catalogStore)
const { active: cruise, cabins } = storeToRefs(cruiseStore)

const loading = shallowRef(true)
const selectedCabin = shallowRef<number | null>(null)
const summaries = ref<Record<number, CabinSummary>>({})
const availability = ref<Availability>({})
const courtesyMode = shallowRef(false)
const showBuilder = shallowRef(false)
const showQueue = shallowRef(false)
const showMenu = shallowRef(false)
const undoing = shallowRef(false)
type TapState = 'enviando' | 'pendiente' | 'guardado' | 'retenido' | 'rechazado'
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

let availabilityTimer: ReturnType<typeof setInterval> | null = null

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

function passengerNames(c: { passengers: Array<{ name: string }> }) {
  return c.passengers.map((p) => p.name.split(' ')[0]).join(' / ')
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
  availabilityTimer = setInterval(loadAvailability, 60_000)
})

onBeforeUnmount(() => {
  queue.stop()
  if (availabilityTimer) clearInterval(availabilityTimer)
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
    courtesy: courtesyMode.value && userStore.isLead,
  })
  rememberUse(product._id)
  const prev = lastTap.value
  const now = Date.now()
  const sameStreak =
    prev &&
    prev.cabin === entry.cabinNumber &&
    prev.productId === product._id &&
    now - prev.at < STREAK_MS &&
    prev.rejected.length < prev.keys.length
  lastTap.value = sameStreak
    ? { ...prev!, keys: [...prev!.keys, entry.key], at: now }
    : { keys: [entry.key], cabin: entry.cabinNumber, productId: product._id, name: product.name, saved: [], held: [], rejected: [], at: now }
  pulse.value = product._id
  setTimeout(() => {
    if (pulse.value === product._id) pulse.value = ''
  }, 380)
  play('tap')
  if (courtesyMode.value) courtesyMode.value = false
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
    play('success')
    void loadAvailability()
    return
  }
  if (outcome.kind === 'retenido') {
    markLast(outcome.entry.key, 'held')
    toast.push(`${outcome.entry.productName}: el crucero ya estaba finalizado; queda retenido para revisión`)
    return
  }
  markLast(outcome.entry.key, 'rejected', outcome.message)
  play('error')
  toast.error(`No se guardó ${outcome.entry.productName} (cabina ${outcome.entry.cabinNumber}): ${outcome.message}`)
  void loadAvailability()
}

/** Deshacer registro por error: solo lo propio y con la cuenta abierta; reverso auditable. */
async function undoLast() {
  const last = summary.value?.last
  if (!last?.canUndo || undoing.value) return
  const reason = await confirmStore.askReason({
    title: `¿Deshacer ${last.qty} ${last.name} de cabina ${summary.value!.cabinNumber}?`,
    message: 'Se quitará el cargo y se devolverán los ingredientes porque la bebida no se sirvió. Queda registrado quién y por qué. Si se sirvió y no se cobra, no lo deshagas: márcalo como cortesía en Cuentas.',
    confirmLabel: 'Deshacer registro',
    danger: true,
    icon: 'fa-rotate-left',
    reason: {
      label: 'Motivo',
      suggestions: ['Toqué otra bebida', 'Cabina equivocada', 'No se sirvió'],
    },
  })
  if (!reason) return
  undoing.value = true
  try {
    const data = await apiUndoConsumption(last.orderId, reason)
    summaries.value = { ...summaries.value, [data.summary.cabinNumber]: data.summary }
    lastTap.value = null
    play('success')
    toast.success('Registro deshecho: se quitó el cargo y los ingredientes volvieron al stock')
    void loadAvailability()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    undoing.value = false
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

function onEmptyCabin(number: number) {
  toast.push(`Cabina ${number} sin pasajeros. Dirección de crucero debe registrarlos.`)
}

const statusText = computed(() => {
  const t = lastTap.value
  if (!t || !tapState.value) return ''
  const what = `Cabina ${t.cabin} · ${tapState.value === 'rechazado' ? t.keys.length : tapUnits.value} ${t.name}`
  switch (tapState.value) {
    case 'enviando':
      return `Enviando consumo… · ${what}`
    case 'pendiente':
      return queue.offlineConfirmed.value
        ? `Sin conexión. El consumo está pendiente de enviar · ${what}`
        : `Sin confirmar: el servidor no respondió, se reintenta solo · ${what}`
    case 'guardado':
      return `Guardado · ${what}`
    case 'retenido':
      return `Retenido para revisión · ${what}`
    default:
      return `No se guardó · ${what}${t.message ? `: ${t.message}` : ''}`
  }
})
</script>

<template>
  <div class="bar">
    <!-- Arriba: contexto y navegación siempre visibles -->
    <header class="context">
      <div class="context-main">
        <i class="fa-solid fa-ship" aria-hidden="true" />
        <span class="context-text">
          <template v-if="cruise">
            {{ cruiseLabel }}<template v-if="cruise.routeFrom"> · {{ cruise.routeFrom }} → {{ cruise.routeTo }}</template>
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
      <nav class="context-tabs" aria-label="Bar">
        <span class="tab tab--on" aria-current="page"><i class="fa-solid fa-martini-glass-citrus" aria-hidden="true" /> Consumos</span>
        <RouterLink to="/cuentas" class="tab"><i class="fa-solid fa-file-invoice-dollar" aria-hidden="true" /> Cuentas</RouterLink>
        <button type="button" class="tab tab--menu" :aria-expanded="showMenu" @click="showMenu = true">
          <i class="fa-solid fa-bars" aria-hidden="true" /> Menú
        </button>
      </nav>
    </header>

    <div class="page bar-page">
      <!-- Cabinas con sus pasajeros -->
      <section class="block">
        <SkeletonList v-if="loading" variant="tile" :rows="9" />
        <div v-else ref="cabinsEl" class="cabins" role="radiogroup" aria-label="Cabina">
          <button
            v-for="c in cabins"
            :key="c.number"
            type="button"
            role="radio"
            class="cabin"
            :class="{ 'cabin--active': c.number === selectedCabin, 'cabin--empty': !c.passengers.length }"
            :aria-checked="c.number === selectedCabin"
            :data-cabin="c.number"
            @click="c.passengers.length ? (selectedCabin = c.number) : onEmptyCabin(c.number)"
          >
            <span class="cabin-number">{{ c.number }}</span>
            <span class="cabin-guests">{{ c.passengers.length ? passengerNames(c) : 'Sin pasajeros' }}</span>
          </button>
        </div>
        <Transition name="fade">
          <p v-if="!loading && blockedReason" class="blocked">
            <i class="fa-solid fa-circle-info" aria-hidden="true" /> {{ blockedReason }}
          </p>
        </Transition>
      </section>

      <!-- Centro: bebidas fáciles de tocar -->
      <section class="block">
        <SkeletonList v-if="loading" variant="tile" :rows="12" />
        <ProductCatalog
          v-else
          :products="sellable"
          :availability="availability"
          v-model:filter="catalogFilter"
          :favorites="effectiveFavorites"
          :pinned="favorites"
          :pulse="pulse"
          :disabled="Boolean(blockedReason)"
          @add="tap"
          @toggle-favorite="toggleFavorite"
          @request-review="requestReview"
          @create-cocktail="showBuilder = true"
        />
      </section>
    </div>

    <!-- Abajo: resultado y corrección, siempre visibles -->
    <footer class="result" aria-live="polite">
      <div class="result-status" :class="tapState ? `result-status--${tapState}` : ''">
        <template v-if="lastTap && tapState">
          <i
            class="fa-solid"
            :class="{
              'fa-spinner fa-spin': tapState === 'enviando',
              'fa-wifi': tapState === 'pendiente' && queue.offlineConfirmed.value,
              'fa-cloud-arrow-up': tapState === 'pendiente' && !queue.offlineConfirmed.value,
              'fa-circle-check': tapState === 'guardado',
              'fa-hourglass-half': tapState === 'retenido',
              'fa-circle-exclamation': tapState === 'rechazado',
            }"
            aria-hidden="true"
          />
          <span>{{ statusText }}</span>
        </template>
        <template v-else-if="summary?.last">
          <i class="fa-solid fa-clock-rotate-left" aria-hidden="true" />
          <span>Último · Cabina {{ summary.cabinNumber }} · {{ summary.last.qty }} {{ summary.last.name }} · {{ formatTime(summary.last.at) }}</span>
        </template>
        <template v-else>
          <i class="fa-solid fa-hand-pointer" aria-hidden="true" />
          <span>Elige cabina y toca la bebida</span>
        </template>
      </div>

      <div v-if="summary" class="result-totals">
        <span>Hoy <strong>{{ formatMoney(summary.todayTotal) }}</strong></span>
        <span class="sep" aria-hidden="true">/</span>
        <span>Viaje <strong>{{ formatMoney(summary.tripTotal) }}</strong></span>
      </div>

      <div class="result-actions">
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
        <button
          v-if="userStore.isLead"
          type="button"
          class="courtesy-btn"
          :class="{ 'courtesy-btn--on': courtesyMode }"
          :aria-pressed="courtesyMode"
          @click="courtesyMode = !courtesyMode"
        >
          <i class="fa-solid fa-gift" aria-hidden="true" /> Cortesía
        </button>
        <button
          type="button"
          class="undo-btn"
          :disabled="!summary?.last?.canUndo || undoing || queue.pending.value > 0"
          :title="summary?.last && !summary.last.canUndo ? 'Solo lo que registraste tú y con la cuenta abierta; si no, lo revisa Dirección de crucero' : undefined"
          @click="undoLast"
        >
          <i class="fa-solid fa-rotate-left" aria-hidden="true" /> Deshacer registro por error
        </button>
      </div>
    </footer>

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
    <BaseModal v-if="showMenu" title="Menú del bar" @close="showMenu = false">
      <div class="menu-grid">
        <RouterLink to="/abastecimiento?nuevo=1" class="menu-tile" @click="showMenu = false">
          <i class="fa-solid fa-dolly" aria-hidden="true" />
          <strong>Solicitar producto</strong>
          <small>Producto, cantidad y unidad. Dirección de crucero la aprueba.</small>
        </RouterLink>
        <RouterLink to="/abastecimiento" class="menu-tile" @click="showMenu = false">
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
    </BaseModal>

    <CocktailBuilder
      v-if="showBuilder"
      :physical="physical"
      @close="showBuilder = false"
      @created="onCocktailCreated"
    />
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.bar {
  min-width: 0;
  padding-bottom: calc(150px + env(safe-area-inset-bottom));

  @include tablet {
    padding-bottom: calc(96px + env(safe-area-inset-bottom));
  }
}

.context {
  position: sticky;
  top: calc(64px + env(safe-area-inset-top));
  z-index: 15;
  display: flex;
  align-items: center;
  gap: 0.5rem 1rem;
  flex-wrap: wrap;
  padding: 0.55rem max(16px, env(safe-area-inset-left, 0px));
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
  flex: 1 1 260px;

  > i {
    color: var(--powder-300);
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

.context-tabs {
  display: flex;
  gap: 0.35rem;
  flex: 1 1 100%;

  .tab {
    flex: 1 1 0;
    justify-content: center;
  }

  @include tablet {
    flex: 0 0 auto;
    margin-left: auto;

    .tab {
      flex: 0 0 auto;
    }
  }
}

.tab {
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
    background: #fff;
    color: var(--navy-800);
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
    width: 76px;
    scroll-snap-align: start;
  }

  @include tablet {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 0.5rem;
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
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.55rem 0.7rem;
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
}

.cabin-number {
  font-family: var(--font-serif);
  font-size: 1.35rem;
  font-weight: 700;
  line-height: 1;
}

.cabin-guests {
  width: 100%;
  font-size: 0.76rem;
  color: var(--ink-400);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.blocked {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.6rem;
  font-size: 0.88rem;
  color: var(--ink-600);
}

.result {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
  padding: 0.6rem max(14px, env(safe-area-inset-left, 0px)) calc(0.6rem + env(safe-area-inset-bottom));
  background: var(--surface);
  border-top: 1px solid var(--cream-200);
  box-shadow: 0 -6px 24px rgba(27, 43, 37, 0.08);

  @include desktop {
    left: var(--shell-rail, 76px);
    padding-left: 1.5rem;
    padding-right: 1.5rem;
  }
}

.result-status {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex: 1 1 260px;
  min-width: 0;
  font-weight: 600;
  color: var(--ink-600);
  transition: color 0.2s ease;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &--guardado {
    color: var(--success);
  }

  &--pendiente,
  &--retenido {
    color: var(--warning);
  }

  &--rechazado {
    color: var(--danger);
  }
}

.result-totals {
  display: flex;
  gap: 0.45rem;
  align-items: baseline;
  font-size: 0.92rem;
  color: var(--ink-600);

  strong {
    font-size: 1.05rem;
    color: var(--ink-900);
    font-variant-numeric: tabular-nums;
  }

  .sep {
    color: var(--cream-200);
  }
}

.result-actions {
  display: flex;
  gap: 0.5rem;
  margin-left: auto;
}

.undo-btn,
.courtesy-btn,
.queue-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 48px;
  padding: 0 1rem;
  border-radius: 12px;
  font-weight: 700;
  font-size: 0.88rem;
  border: 2px solid var(--cream-200);
  background: var(--surface);
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease,
    transform 0.12s ease;

  &:active:not(:disabled) {
    transform: scale(0.97);
  }

  &:disabled {
    opacity: 0.4;
  }
}

.undo-btn:not(:disabled) {
  border-color: var(--danger);
  color: var(--danger);
}

.courtesy-btn--on {
  background: var(--gold-500);
  border-color: var(--gold-500);
  color: #fff;
}

.queue-btn {
  border-color: var(--warning);
  color: var(--warning);

  &--offline {
    background: rgba(185, 128, 47, 0.12);
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
    color: var(--gold-500);
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
