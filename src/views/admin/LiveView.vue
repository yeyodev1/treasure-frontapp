<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { apiLive } from '@/services/api'
import { isNetworkError } from '@/services/httpBase'
import { useSound } from '@/composables/useSound'
import { dayKeyOf, formatDayHeading, formatHour, formatLongDate, formatMoney, formatTime, todayKey } from '@/utils/format'
import StatCard from '@/components/ui/StatCard.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import type { LiveFeedEvent, LiveKind, LivePulse } from '@/types'

/** Cada cuántos ms se consulta el pulso. */
const POLL_MS = 6000

const router = useRouter()
const { play, muted } = useSound()

const pulse = shallowRef<LivePulse | null>(null)
const feed = ref<LiveFeedEvent[]>([])
const loading = shallowRef(true)
const connected = shallowRef(true)
/** Solo se dice "Sin conexión" si no hubo respuesta del servidor. */
const offline = shallowRef(false)
const lastUpdate = shallowRef<string | null>(null)
const lastAt = shallowRef<string | undefined>(undefined)
const kindFilter = shallowRef<'todo' | LiveKind>('todo')

let timer: ReturnType<typeof setInterval> | null = null

const KIND_META: Record<LiveKind, { icon: string; label: string }> = {
  consumo: { icon: 'fa-martini-glass-citrus', label: 'Consumo' },
  requerimiento: { icon: 'fa-dolly', label: 'Solicitud' },
  compra: { icon: 'fa-truck-ramp-box', label: 'Compra' },
  registro: { icon: 'fa-clipboard-list', label: 'Registro ISM' },
  pedido: { icon: 'fa-martini-glass-citrus', label: 'Consumo' },
  entrega: { icon: 'fa-check-double', label: 'Entrega' },
  cancelacion: { icon: 'fa-ban', label: 'Cancelación' },
  anulacion: { icon: 'fa-rotate-left', label: 'Anulación' },
  cuenta: { icon: 'fa-file-invoice-dollar', label: 'Cuenta' },
  cobro: { icon: 'fa-cash-register', label: 'Cobro' },
  inventario: { icon: 'fa-boxes-stacked', label: 'Inventario' },
  conteo: { icon: 'fa-clipboard-check', label: 'Conteo' },
  catalogo: { icon: 'fa-wine-bottle', label: 'Catálogo' },
  equipo: { icon: 'fa-users', label: 'Equipo' },
  salida: { icon: 'fa-ship', label: 'Crucero' },
}

const FILTERS: Array<{ value: 'todo' | LiveKind; label: string }> = [
  { value: 'todo', label: 'Todo' },
  { value: 'consumo', label: 'Consumos' },
  { value: 'requerimiento', label: 'Solicitudes' },
  { value: 'compra', label: 'Compras' },
  { value: 'entrega', label: 'Entregas' },
  { value: 'cancelacion', label: 'Cancelaciones' },
  { value: 'cuenta', label: 'Cuentas' },
  { value: 'cobro', label: 'Cobros' },
  { value: 'inventario', label: 'Inventario' },
  { value: 'conteo', label: 'Conteos' },
]

const openTotal = computed(() =>
  (pulse.value?.openAccounts ?? []).reduce((sum, a) => sum + a.total, 0),
)

const visibleFeed = computed(() =>
  kindFilter.value === 'todo' ? feed.value : feed.value.filter((e) => e.kind === kindFilter.value),
)

/**
 * Actividad agrupada por día de Galápagos: un consumo de anoche 23:30 queda
 * bajo su día, no bajo el de hoy (checklist 29-oct, 04 / P03).
 */
const feedRows = computed(() => {
  const today = todayKey()
  const rows: Array<
    { type: 'day'; id: string; label: string } | { type: 'event'; id: string; event: LiveFeedEvent }
  > = []
  let current = ''
  for (const event of visibleFeed.value) {
    const key = dayKeyOf(event.at)
    if (key !== current) {
      current = key
      rows.push({ type: 'day', id: `day-${key}`, label: key === today ? `Hoy · ${formatDayHeading(key)}` : formatDayHeading(key) })
    }
    rows.push({ type: 'event', id: event.id, event })
  }
  return rows
})

const pendingChips = computed(() => {
  const p = pulse.value?.pending
  if (!p) return []
  return [
    { n: p.deliveries, label: 'bebidas por entregar', icon: 'fa-hourglass-half', to: '/' },
    { n: p.reviews, label: 'cuentas en revisión', icon: 'fa-file-invoice-dollar', to: '/cuentas' },
    { n: p.annulments, label: 'anulaciones por revisar', icon: 'fa-rotate-left', to: '/cuentas' },
    { n: p.counts, label: 'conteos por aprobar', icon: 'fa-clipboard-check', to: '/admin/inventario' },
  ]
})

function mergeFeed(incoming: LiveFeedEvent[]) {
  const known = new Set(feed.value.map((e) => e.id))
  const fresh = incoming.filter((e) => !known.has(e.id))
  if (fresh.length && lastAt.value) play('ping')
  feed.value = [...fresh, ...feed.value].slice(0, 80)
}

async function tick() {
  try {
    const data = await apiLive(lastAt.value)
    connected.value = true
    offline.value = false
    pulse.value = data
    mergeFeed(data.feed)
    lastAt.value = data.now
    lastUpdate.value = data.now
  } catch (err) {
    connected.value = false
    offline.value = isNetworkError(err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  tick()
  timer = setInterval(tick, POLL_MS)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head-text">
        <h1 class="page-title">En vivo</h1>
        <p class="page-lead">
          Día de operación:
          <strong>{{ pulse ? formatLongDate(pulse.commercialDate) : '…' }}</strong>
          <span v-if="pulse?.cruise" class="lead-cruise">
            <i class="fa-solid fa-ship" aria-hidden="true" />
            {{ pulse.cruise.code ? `Crucero ${pulse.cruise.code}` : pulse.cruise.name }}
            <span class="estado" :class="pulse.cruise.status === 'abordo' ? 'estado--ok' : 'estado--info'">
              {{ pulse.cruise.status === 'abordo' ? 'En curso' : 'Programado' }}
            </span>
          </span>
        </p>
      </div>
      <div class="live-status" aria-live="polite">
        <span class="estado conn" :class="connected ? 'estado--ok' : 'estado--danger'">
          <span class="conn-dot" aria-hidden="true" />
          {{ connected ? 'Conectado' : offline ? 'Sin conexión, reintentando' : 'No se pudo actualizar, reintentando' }}
        </span>
        <span class="updated">
          Última actualización {{ lastUpdate ? formatTime(lastUpdate) : '—' }}
          <span v-if="muted" class="muted-note">
            <i class="fa-solid fa-volume-xmark" aria-hidden="true" /> Sonidos silenciados
          </span>
        </span>
      </div>
    </header>

    <div v-if="loading" class="grid-skel">
      <SkeletonList variant="card" :rows="4" />
    </div>

    <template v-else>
      <div class="top">
        <div class="stats">
          <StatCard
            label="Consumos de hoy"
            :value="formatMoney(pulse?.today.total ?? 0)"
            :hint="`${pulse?.today.orders ?? 0} registros`"
          />
          <StatCard
            label="Por cobrar a bordo"
            :value="formatMoney(openTotal)"
            :hint="`${pulse?.openAccounts.length ?? 0} cabinas con consumo`"
          />
        </div>

        <nav class="pending" aria-label="Pendientes">
          <button
            v-for="chip in pendingChips"
            :key="chip.label"
            type="button"
            class="pending-chip"
            :class="{ 'pending-chip--on': chip.n > 0 }"
            @click="router.push(chip.to)"
          >
            <i class="fa-solid" :class="chip.icon" aria-hidden="true" />
            <strong class="num">{{ chip.n }}</strong>
            <span>{{ chip.label }}</span>
            <i class="fa-solid fa-arrow-right pending-go" aria-hidden="true" />
          </button>
        </nav>
      </div>

      <section v-if="pulse?.openAccounts.length" class="card cabins" aria-labelledby="live-cabins-title">
        <h2 id="live-cabins-title" class="section-title">Cuentas abiertas por cabina</h2>
        <div class="cabin-row">
          <div v-for="a in pulse.openAccounts" :key="a.cabinNumber" class="cabin-pill">
            <span class="cabin-pill-number">{{ a.cabinNumber }}</span>
            <span class="cabin-pill-total">{{ formatMoney(a.total) }}</span>
            <span v-if="a.pending" class="cabin-pill-pending">
              <i class="fa-solid fa-hourglass-half" aria-hidden="true" /> {{ a.pending }} por entregar
            </span>
          </div>
        </div>
      </section>

      <section class="card feed-card" aria-labelledby="live-feed-title">
        <div class="feed-head">
          <h2 id="live-feed-title" class="section-title">Actividad</h2>
          <div class="segs filters" role="tablist" aria-label="Filtrar actividad">
            <button
              v-for="f in FILTERS"
              :key="f.value"
              type="button"
              role="tab"
              class="segs-item"
              :class="{ 'segs-item--on': kindFilter === f.value }"
              :aria-selected="kindFilter === f.value"
              @click="kindFilter = f.value"
            >
              {{ f.label }}
            </button>
          </div>
        </div>

        <div v-if="!visibleFeed.length" class="vacio">
          <i class="fa-solid fa-tower-broadcast" aria-hidden="true" />
          <p>Todavía no hay movimientos aquí. En cuanto se registre algo, aparece al instante.</p>
        </div>

        <TransitionGroup v-else name="list" tag="ul" class="feed">
          <template v-for="row in feedRows" :key="row.id">
            <li v-if="row.type === 'day'" class="feed-day">{{ row.label }}</li>
            <li v-else class="event" :class="`event--${row.event.kind}`">
              <span class="event-icon">
                <i class="fa-solid" :class="KIND_META[row.event.kind]?.icon ?? 'fa-circle'" aria-hidden="true" />
              </span>
              <div class="event-body">
                <div class="event-top">
                  <span class="event-title">{{ row.event.title }}</span>
                  <span v-if="row.event.amount !== null" class="event-amount">{{ formatMoney(row.event.amount) }}</span>
                </div>
                <p v-if="row.event.detail" class="event-detail">{{ row.event.detail }}</p>
                <p class="event-meta">
                  <span class="num">{{ formatHour(row.event.at) }}</span>
                  <template v-if="row.event.by"> · {{ row.event.by }}</template>
                  · {{ KIND_META[row.event.kind]?.label }}
                </p>
              </div>
            </li>
          </template>
        </TransitionGroup>
      </section>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.page-lead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;

  strong {
    color: var(--ink-900);
  }
}

.lead-cruise {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin-left: 0.6rem;
  font-weight: 600;
  color: var(--ink-900);

  > i {
    color: var(--navy-600);
  }
}

.live-status {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;

  @include tablet {
    align-items: flex-end;
  }
}

.conn {
  min-height: 32px;
  font-size: 0.9rem;
}

.conn-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 2s ease-out infinite;

  .estado--danger & {
    animation: none;
  }
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(63, 122, 87, 0.45);
  }

  70% {
    box-shadow: 0 0 0 8px rgba(63, 122, 87, 0);
  }

  100% {
    box-shadow: 0 0 0 0 rgba(63, 122, 87, 0);
  }
}

.updated {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 0.6rem;
  font-size: 0.92rem;
  color: var(--ink-600);
  font-variant-numeric: tabular-nums;
}

.muted-note i {
  margin-right: 0.2rem;
}

.top {
  display: grid;
  gap: 0.9rem;
  margin-bottom: 1rem;

  @include desktop {
    grid-template-columns: minmax(0, 560px) minmax(0, 1fr);
    align-items: start;
  }
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.pending {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.5rem;

  @include tablet {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.pending-chip {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 52px;
  padding: 0.5rem 0.95rem;
  border-radius: var(--radius-sm);
  background: var(--surface);
  border: 1px solid var(--line);
  font-size: 1rem;
  text-align: left;
  color: var(--ink-600);
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    transform 0.14s var(--ease-out);

  > i:first-child {
    color: var(--ink-300);
  }

  strong {
    font-size: 1.1rem;
    color: var(--ink-900);
  }

  &:hover {
    border-color: var(--navy-600);
  }

  &:active {
    transform: scale(0.98);
  }

  &--on {
    border-color: transparent;
    background: var(--pill-warn-bg);
    color: var(--pill-warn-ink);

    > i:first-child,
    strong {
      color: var(--pill-warn-ink);
    }
  }
}

.pending-go {
  margin-left: auto;
  font-size: 0.85rem;
  opacity: 0.55;
  transition:
    transform 0.16s var(--ease-out),
    opacity 0.16s ease;

  .pending-chip:hover & {
    opacity: 1;
    transform: translateX(3px);
  }
}

.section-title {
  margin-bottom: 0.8rem;
}

.cabins {
  margin-bottom: 1rem;
}

.cabin-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.cabin-pill {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 44px;
  padding: 0.3rem 0.9rem 0.3rem 0.35rem;
  border-radius: 999px;
  background: var(--powder-100);
}

.cabin-pill-number {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--navy-800);
  color: #fff;
  font-weight: 700;
  font-size: 0.95rem;
}

.cabin-pill-total {
  font-weight: 700;
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
}

.cabin-pill-pending {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--pill-warn-ink);
}

.feed-head {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-bottom: 0.4rem;

  .section-title {
    margin-bottom: 0;
  }
}

.filters {
  max-width: 100%;
}

.feed {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.feed-day {
  padding: 1rem 0 0.4rem;
  font-family: var(--font-serif);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--navy-800);

  &:first-child {
    padding-top: 0.4rem;
  }
}

.event {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 0.8rem;
  padding: 0.75rem 0.1rem;
  border-top: 1px solid var(--rule);

  &--pedido,
  &--consumo,
  &--entrega {
    .event-icon {
      background: var(--pill-info-bg);
      color: var(--pill-info-ink);
    }
  }

  &--cobro,
  &--cuenta {
    .event-icon {
      background: var(--pill-ok-bg);
      color: var(--pill-ok-ink);
    }
  }

  &--cancelacion,
  &--anulacion {
    .event-icon {
      background: var(--pill-danger-bg);
      color: var(--pill-danger-ink);
    }
  }

  &--inventario,
  &--conteo,
  &--requerimiento,
  &--compra {
    .event-icon {
      background: var(--pill-warn-bg);
      color: var(--pill-warn-ink);
    }
  }
}

.event-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--pill-neutral-bg);
  color: var(--pill-neutral-ink);
  font-size: 0.95rem;
}

.event-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.6rem;
}

.event-title {
  font-weight: 700;
  font-size: 1rem;
  color: var(--ink-900);
}

.event-amount {
  font-weight: 700;
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.event-detail {
  margin: 0.1rem 0 0;
  font-size: 0.98rem;
  color: var(--ink-600);
  overflow-wrap: anywhere;
}

.event-meta {
  margin: 0.2rem 0 0;
  font-size: 0.9rem;
  color: var(--ink-400);
}
</style>
