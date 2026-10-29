<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
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
import { formatMoney, formatTime } from '@/utils/format'
import ProductCatalog from '@/components/pos/ProductCatalog.vue'
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
/** Último toque de la tableta: lo que muestra la barra inferior. */
const lastTap = shallowRef<{ key: string; cabin: number; name: string; state: 'enviando' | 'pendiente' | 'guardado' | 'retenido' | 'rechazado'; message?: string } | null>(null)
const pulse = shallowRef('')

let availabilityTimer: ReturnType<typeof setInterval> | null = null

const cabin = computed(() => cabins.value.find((c) => c.number === selectedCabin.value) ?? null)
const summary = computed(() => (selectedCabin.value ? summaries.value[selectedCabin.value] : undefined))
const cruiseLabel = computed(() =>
  cruise.value ? (cruise.value.code ? `Salida ${cruise.value.code}` : cruise.value.name) : '',
)
const statusLabel = computed(() =>
  cruise.value?.status === 'abordo' ? 'En curso' : cruise.value?.status === 'planificado' ? 'Programada' : 'Finalizada',
)

/** Fecha comercial y día del viaje (hora de Ecuador). */
const todayLabel = computed(() =>
  new Intl.DateTimeFormat('es-EC', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'America/Guayaquil' }).format(new Date()),
)
const tripDay = computed(() => {
  if (!cruise.value) return null
  const start = new Date(cruise.value.startedAt ?? cruise.value.startDate)
  const key = (d: Date) => new Date(d.toLocaleString('en-US', { timeZone: 'America/Guayaquil' })).setHours(0, 0, 0, 0)
  const days = Math.floor((key(new Date()) - key(start)) / 86_400_000) + 1
  return days >= 1 ? days : null
})

const blockedReason = computed(() => {
  if (!cruise.value) return 'No hay salida programada. La directora la crea en Salidas.'
  if (cruise.value.status === 'planificado') return `${cruiseLabel.value} está programada: la directora debe iniciar el crucero.`
  if (cruise.value.status === 'cerrado') return `${cruiseLabel.value} está finalizada.`
  if (!cabin.value) return 'Elige la cabina.'
  return ''
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
  lastTap.value = { key: entry.key, cabin: entry.cabinNumber, name: product.name, state: 'enviando' }
  pulse.value = product._id
  setTimeout(() => {
    if (pulse.value === product._id) pulse.value = ''
  }, 380)
  play('tap')
  if (courtesyMode.value) courtesyMode.value = false
}

// Estado visible del último toque mientras viaja.
watch(
  () => queue.entries.value.map((e) => `${e.key}:${e.state}`).join('|'),
  () => {
    const tapState = lastTap.value
    if (!tapState) return
    const entry = queue.entries.value.find((e) => e.key === tapState.key)
    if (entry) lastTap.value = { ...tapState, state: entry.state }
  },
)

function onOutcome(outcome: QueueOutcome) {
  const isLast = lastTap.value?.key === outcome.entry.key
  if (outcome.kind === 'guardado') {
    if (outcome.summary) {
      summaries.value = { ...summaries.value, [outcome.summary.cabinNumber]: outcome.summary }
    }
    if (isLast) lastTap.value = { ...lastTap.value!, state: 'guardado' }
    play('success')
    void loadAvailability()
    return
  }
  if (outcome.kind === 'retenido') {
    if (isLast) lastTap.value = { ...lastTap.value!, state: 'retenido' }
    toast.push(`${outcome.entry.productName}: la salida ya estaba finalizada; queda retenido para la directora`)
    return
  }
  if (isLast) lastTap.value = { ...lastTap.value!, state: 'rechazado', message: outcome.message }
  play('error')
  toast.error(`No se guardó ${outcome.entry.productName} (cabina ${outcome.entry.cabinNumber}): ${outcome.message}`)
  void loadAvailability()
}

/** Deshacer error: solo lo propio y con la cuenta abierta; reverso auditable. */
async function undoLast() {
  const last = summary.value?.last
  if (!last?.canUndo || undoing.value) return
  const reason = await confirmStore.askReason({
    title: `¿Deshacer ${last.qty} ${last.name} de cabina ${summary.value!.cabinNumber}?`,
    message: 'Se quita el cargo y los ingredientes vuelven al stock a bordo. Queda registrado quién y por qué.',
    confirmLabel: 'Deshacer',
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
    toast.success('Consumo deshecho: cargo y stock revertidos')
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
  if (!queue.cancel(key)) toast.error('Se está enviando: espera a que el servidor responda')
  else if (lastTap.value?.key === key) lastTap.value = null
}

/** El producto aparece agotado pero está en la barra: pedir revisión de inventario. */
async function requestReview(product: Product) {
  const reason = await confirmStore.askReason({
    title: `¿Pedir revisión de inventario de ${product.name}?`,
    message: 'La administradora lo revisa con un conteo físico. No se registra el consumo hasta que el stock esté corregido.',
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
    toast.success(`Revisión ${req.code} enviada a la administradora`)
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
  toast.push(`La cabina ${number} está vacía: la directora registra sus pasajeros en Salidas`)
}

const statusText = computed(() => {
  const t = lastTap.value
  if (!t) return ''
  const what = `Cabina ${t.cabin} · 1 ${t.name}`
  switch (t.state) {
    case 'enviando':
      return `Enviando · ${what}`
    case 'pendiente':
      return `Pendiente sin señal · ${what}`
    case 'guardado':
      return `Guardado · ${what}`
    case 'retenido':
      return `Retenido para revisión · ${what}`
    default:
      return `No se guardó · ${what}`
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
          <template v-else>Sin salida</template>
        </span>
        <span v-if="cruise" class="context-status" :class="`context-status--${cruise.status}`">{{ statusLabel }}</span>
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
        <div v-else class="cabins" role="radiogroup" aria-label="Cabina">
          <button
            v-for="c in cabins"
            :key="c.number"
            type="button"
            role="radio"
            class="cabin"
            :class="{ 'cabin--active': c.number === selectedCabin, 'cabin--empty': !c.passengers.length }"
            :aria-checked="c.number === selectedCabin"
            @click="c.passengers.length ? (selectedCabin = c.number) : onEmptyCabin(c.number)"
          >
            <span class="cabin-number">{{ c.number }}</span>
            <span class="cabin-guests">{{ c.passengers.length ? passengerNames(c) : 'Vacía' }}</span>
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
      <div class="result-status" :class="lastTap ? `result-status--${lastTap.state}` : ''">
        <template v-if="lastTap">
          <i
            class="fa-solid"
            :class="{
              'fa-spinner fa-spin': lastTap.state === 'enviando',
              'fa-cloud-arrow-up': lastTap.state === 'pendiente',
              'fa-circle-check': lastTap.state === 'guardado',
              'fa-hourglass-half': lastTap.state === 'retenido',
              'fa-circle-exclamation': lastTap.state === 'rechazado',
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
          :title="summary?.last && !summary.last.canUndo ? 'Solo lo que registraste tú y con la cuenta abierta; si no, la directora lo revisa' : undefined"
          @click="undoLast"
        >
          <i class="fa-solid fa-rotate-left" aria-hidden="true" /> Deshacer error
        </button>
      </div>
    </footer>

    <!-- Envíos sin confirmar en esta tableta -->
    <BaseModal v-if="showQueue" title="Sin confirmar en esta tableta" @close="showQueue = false">
      <p class="queue-help">
        <template v-if="queue.online.value">Se están enviando en orden. No cierres la sesión.</template>
        <template v-else>Sin señal: se envían solos al volver la conexión, sin duplicarse.</template>
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
          <strong>Solicitar abastecimiento</strong>
          <small>Producto, cantidad y unidad. La directora lo aprueba.</small>
        </RouterLink>
        <RouterLink to="/abastecimiento" class="menu-tile" @click="showMenu = false">
          <i class="fa-solid fa-list-check" aria-hidden="true" />
          <strong>Mis requerimientos</strong>
          <small>Solicitado, aprobado, recibido.</small>
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

.context-date {
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
  font-size: 0.85rem;
  color: var(--powder-300);

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
  margin-left: auto;
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
  padding-top: 0.9rem;
}

.block {
  min-width: 0;
  margin-bottom: 1rem;
}

.cabins {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 0.5rem;
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
