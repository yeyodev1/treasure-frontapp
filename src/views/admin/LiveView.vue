<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { apiLive } from '@/services/api'
import { useSound } from '@/composables/useSound'
import { formatLongDate, formatMoney, formatTime } from '@/utils/format'
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
const lastUpdate = shallowRef<string | null>(null)
const lastAt = shallowRef<string | undefined>(undefined)
const kindFilter = shallowRef<'todo' | LiveKind>('todo')

let timer: ReturnType<typeof setInterval> | null = null

const KIND_META: Record<LiveKind, { icon: string; label: string }> = {
  pedido: { icon: 'fa-martini-glass-citrus', label: 'Pedido' },
  entrega: { icon: 'fa-check-double', label: 'Entrega' },
  cancelacion: { icon: 'fa-ban', label: 'Cancelación' },
  anulacion: { icon: 'fa-rotate-left', label: 'Anulación' },
  cuenta: { icon: 'fa-file-invoice-dollar', label: 'Cuenta' },
  cobro: { icon: 'fa-cash-register', label: 'Cobro' },
  inventario: { icon: 'fa-boxes-stacked', label: 'Inventario' },
  conteo: { icon: 'fa-clipboard-check', label: 'Conteo' },
  catalogo: { icon: 'fa-wine-bottle', label: 'Catálogo' },
  equipo: { icon: 'fa-users', label: 'Equipo' },
  salida: { icon: 'fa-ship', label: 'Salida' },
}

const FILTERS: Array<{ value: 'todo' | LiveKind; label: string }> = [
  { value: 'todo', label: 'Todo' },
  { value: 'pedido', label: 'Pedidos' },
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
    pulse.value = data
    mergeFeed(data.feed)
    lastAt.value = data.now
    lastUpdate.value = data.now
  } catch {
    connected.value = false
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
    <header class="live-head">
      <div>
        <h1 class="page-title">En vivo</h1>
        <p class="live-date">
          <i class="fa-regular fa-calendar" aria-hidden="true" />
          Fecha comercial:
          <strong>{{ pulse ? formatLongDate(pulse.commercialDate) : '…' }}</strong>
        </p>
      </div>
      <div class="live-status">
        <span class="conn" :class="{ 'conn--off': !connected }">
          <span class="conn-dot" aria-hidden="true" />
          {{ connected ? 'Conectado' : 'Sin conexión, reintentando' }}
        </span>
        <span class="updated">
          <i class="fa-solid fa-rotate" aria-hidden="true" />
          Última actualización {{ lastUpdate ? formatTime(lastUpdate) : '—' }}
          <i v-if="muted" class="fa-solid fa-volume-xmark" title="Sonidos silenciados" aria-hidden="true" />
        </span>
      </div>
    </header>

    <div v-if="loading" class="grid-skel">
      <SkeletonList variant="card" :rows="4" />
    </div>

    <template v-else>
      <p v-if="pulse?.cruise" class="cruise">
        <i class="fa-solid fa-ship" aria-hidden="true" />
        {{ pulse.cruise.code ? `Salida ${pulse.cruise.code}` : pulse.cruise.name }}
        <span class="cruise-status">{{ pulse.cruise.status === 'abordo' ? 'A bordo' : 'Programada' }}</span>
      </p>

      <div class="stats">
        <StatCard
          label="Vendido hoy"
          :value="formatMoney(pulse?.today.total ?? 0)"
          :hint="`${pulse?.today.orders ?? 0} pedidos`"
        />
        <StatCard
          label="Por cobrar a bordo"
          :value="formatMoney(openTotal)"
          :hint="`${pulse?.openAccounts.length ?? 0} cabinas con consumo`"
        />
      </div>

      <div class="pending">
        <button
          v-for="chip in pendingChips"
          :key="chip.label"
          type="button"
          class="pending-chip"
          :class="{ 'pending-chip--on': chip.n > 0 }"
          @click="router.push(chip.to)"
        >
          <i class="fa-solid" :class="chip.icon" aria-hidden="true" />
          <strong>{{ chip.n }}</strong> {{ chip.label }}
        </button>
      </div>

      <section v-if="pulse?.openAccounts.length" class="card cabins">
        <h3 class="panel-title">Cuentas abiertas por cabina</h3>
        <div class="cabin-row">
          <div v-for="a in pulse.openAccounts" :key="a.cabinNumber" class="cabin-pill">
            <span class="cabin-pill-number">{{ a.cabinNumber }}</span>
            <span class="cabin-pill-total">{{ formatMoney(a.total) }}</span>
            <span v-if="a.pending" class="cabin-pill-pending" :title="`${a.pending} por entregar`">
              <i class="fa-solid fa-hourglass-half" aria-hidden="true" /> {{ a.pending }}
            </span>
          </div>
        </div>
      </section>

      <section class="card feed-card">
        <div class="feed-head">
          <h3 class="panel-title">
            <i class="fa-solid fa-tower-broadcast" aria-hidden="true" /> Actividad
          </h3>
          <div class="filters">
            <button
              v-for="f in FILTERS"
              :key="f.value"
              type="button"
              class="filter"
              :class="{ on: kindFilter === f.value }"
              @click="kindFilter = f.value"
            >
              {{ f.label }}
            </button>
          </div>
        </div>

        <p v-if="!visibleFeed.length" class="feed-empty">
          Todavía no hay movimientos aquí. En cuanto alguien registre algo, aparece al instante.
        </p>

        <TransitionGroup v-else name="list" tag="ul" class="feed">
          <li v-for="event in visibleFeed" :key="event.id" class="event" :class="`event--${event.kind}`">
            <span class="event-icon">
              <i class="fa-solid" :class="KIND_META[event.kind]?.icon ?? 'fa-circle'" aria-hidden="true" />
            </span>
            <div class="event-body">
              <div class="event-top">
                <span class="event-title">{{ event.title }}</span>
                <span v-if="event.amount !== null" class="event-amount">{{ formatMoney(event.amount) }}</span>
              </div>
              <p v-if="event.detail" class="event-detail">{{ event.detail }}</p>
              <p class="event-meta">
                <i class="fa-regular fa-clock" aria-hidden="true" /> {{ formatTime(event.at) }}
                <template v-if="event.by"> · <i class="fa-regular fa-user" aria-hidden="true" /> {{ event.by }}</template>
                · {{ KIND_META[event.kind]?.label }}
              </p>
            </div>
          </li>
        </TransitionGroup>
      </section>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.live-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;

  .page-title {
    margin-bottom: 0.2rem;
  }
}

.live-date {
  margin: 0;
  color: var(--ink-600);
  font-size: 0.9rem;
  i {
    color: var(--gold-500);
    margin-right: 0.25rem;
  }
}

.live-status {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.3rem;
  font-size: 0.82rem;
}

.conn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  background: rgba(63, 122, 87, 0.13);
  color: var(--success);
  font-weight: 700;

  &--off {
    background: rgba(180, 72, 59, 0.12);
    color: var(--danger);
  }
}

.conn-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 2s ease-out infinite;

  .conn--off & {
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
  color: var(--ink-400);
  font-variant-numeric: tabular-nums;

  i {
    margin: 0 0.15rem;
  }
}

.cruise {
  margin: 0 0 0.8rem;
  font-weight: 600;
  color: var(--ink-600);
  display: flex;
  align-items: center;
  gap: 0.5rem;

  i {
    color: var(--gold-500);
  }
}

.cruise-status {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: var(--powder-100);
  color: var(--navy-700);
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-bottom: 0.9rem;

  @include tablet {
    max-width: 560px;
  }
}

.pending {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.pending-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 40px;
  padding: 0.35rem 0.85rem;
  border-radius: 999px;
  background: var(--surface);
  border: 1.5px solid var(--cream-200);
  font-size: 0.84rem;
  color: var(--ink-400);
  transition: all 0.15s ease;

  &--on {
    border-color: rgba(185, 128, 47, 0.55);
    background: rgba(185, 128, 47, 0.1);
    color: #7a5219;
  }
}

.panel-title {
  font-size: 0.95rem;
  margin-bottom: 0.75rem;
  color: var(--ink-600);
  display: flex;
  align-items: center;
  gap: 0.5rem;

  i {
    color: var(--gold-500);
  }
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
  gap: 0.5rem;
  background: var(--powder-100);
  border-radius: 999px;
  padding: 0.3rem 0.75rem 0.3rem 0.35rem;
}

.cabin-pill-number {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--navy-800);
  color: #fff;
  font-weight: 700;
  font-size: 0.85rem;
}

.cabin-pill-total {
  font-weight: 700;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.cabin-pill-pending {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--warning);
}

.feed-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.4rem;

  .panel-title {
    margin-bottom: 0;
  }
}

.filters {
  display: flex;
  gap: 0.3rem;
  overflow-x: auto;
  scrollbar-width: none;
}

.filter {
  flex-shrink: 0;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-400);
  border: 1px solid var(--cream-200);

  &.on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }
}

.feed-empty {
  margin: 0.6rem 0;
  color: var(--ink-400);
  font-size: 0.92rem;
}

.feed {
  list-style: none;
  margin: 0.6rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.event {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 0.75rem;
  padding: 0.7rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--cream-100);
  border-left: 3px solid var(--ink-400);

  &--pedido,
  &--entrega {
    border-left-color: var(--navy-600);
  }

  &--cobro,
  &--cuenta {
    border-left-color: var(--success);
  }

  &--cancelacion,
  &--anulacion {
    border-left-color: var(--danger);
  }

  &--inventario,
  &--conteo {
    border-left-color: var(--gold-500);
  }
}

.event-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--surface);
  color: var(--navy-700);
  box-shadow: var(--shadow);
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
  font-size: 0.93rem;
}

.event-amount {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.event-detail {
  margin: 0.1rem 0 0;
  font-size: 0.85rem;
  color: var(--ink-600);
  overflow-wrap: anywhere;
}

.event-meta {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: var(--ink-400);
}
</style>
