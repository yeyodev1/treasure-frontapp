<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { apiLive } from '@/services/api'
import { useSound } from '@/composables/useSound'
import { formatMoney } from '@/utils/format'
import StatCard from '@/components/ui/StatCard.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import type { LiveFeedEvent, LivePulse } from '@/types'

/** Cada cuántos ms se consulta el pulso. */
const POLL_MS = 6000

const { play, muted } = useSound()

const pulse = shallowRef<LivePulse | null>(null)
const feed = ref<LiveFeedEvent[]>([])
const loading = shallowRef(true)
const connected = shallowRef(true)
const lastAt = shallowRef<string | undefined>(undefined)

let timer: ReturnType<typeof setInterval> | null = null

const KIND_META: Record<LiveFeedEvent['kind'], { icon: string; label: string }> = {
  pedido: { icon: 'fa-martini-glass-citrus', label: 'Pedido' },
  cobro: { icon: 'fa-cash-register', label: 'Cobro' },
  inventario: { icon: 'fa-boxes-stacked', label: 'Inventario' },
}

const openTotal = computed(() =>
  (pulse.value?.openAccounts ?? []).reduce((sum, a) => sum + a.total, 0),
)

function mergeFeed(incoming: LiveFeedEvent[]) {
  const known = new Set(feed.value.map((e) => e.id))
  const fresh = incoming.filter((e) => !known.has(e.id))
  if (fresh.length && lastAt.value) {
    // Algo nuevo acaba de pasar a bordo: suena el ping.
    play('ping')
  }
  feed.value = [...fresh, ...feed.value].slice(0, 60)
}

async function tick() {
  try {
    const data = await apiLive(lastAt.value)
    connected.value = true
    pulse.value = data
    mergeFeed(data.feed)
    lastAt.value = data.now
  } catch {
    connected.value = false
  } finally {
    loading.value = false
  }
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })
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
      <h1 class="page-title">
        En vivo
        <span class="live-dot" :class="{ 'live-dot--off': !connected }" aria-hidden="true" />
      </h1>
      <p class="live-sub">
        <template v-if="pulse?.cruise">
          {{ pulse.cruise.name }} · se actualiza solo cada {{ POLL_MS / 1000 }}s
          <i v-if="muted" class="fa-solid fa-volume-xmark live-muted" aria-hidden="true" />
        </template>
        <template v-else-if="!loading">Sin crucero activo</template>
      </p>
    </header>

    <div v-if="loading" class="live-grid">
      <SkeletonList variant="card" :rows="3" />
    </div>

    <template v-else>
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

      <section v-if="pulse?.openAccounts.length" class="cabins card">
        <h3 class="panel-title">Cuentas abiertas por cabina</h3>
        <div class="cabin-row">
          <div v-for="account in pulse.openAccounts" :key="account.cabinNumber" class="cabin-pill">
            <span class="cabin-pill-number">{{ account.cabinNumber }}</span>
            <span class="cabin-pill-total">{{ formatMoney(account.total) }}</span>
          </div>
        </div>
      </section>

      <section class="card feed-card">
        <h3 class="panel-title">
          <i class="fa-solid fa-tower-broadcast" aria-hidden="true" />
          Actividad a bordo
        </h3>

        <p v-if="!feed.length" class="feed-empty">
          Todavía no hay movimientos. En cuanto el bar registre algo, aparece aquí al instante.
        </p>

        <TransitionGroup v-else name="list" tag="ul" class="feed">
          <li v-for="event in feed" :key="event.id" class="event" :class="`event--${event.kind}`">
            <span class="event-icon">
              <i class="fa-solid" :class="KIND_META[event.kind].icon" aria-hidden="true" />
            </span>
            <div class="event-body">
              <div class="event-top">
                <span class="event-title">{{ event.title }}</span>
                <span v-if="event.amount !== null" class="event-amount">
                  {{ formatMoney(event.amount) }}
                </span>
              </div>
              <p class="event-detail">{{ event.detail }}</p>
              <p class="event-meta">
                <i class="fa-regular fa-clock" aria-hidden="true" /> {{ timeOf(event.at) }}
                <template v-if="event.by"> · {{ event.by }}</template>
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
  margin-bottom: 1rem;

  .page-title {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.1rem;
  }
}

.live-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 0 rgba(79, 125, 94, 0.5);
  animation: pulse 2s ease-out infinite;

  &--off {
    background: var(--danger);
    animation: none;
  }
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(79, 125, 94, 0.45);
  }

  70% {
    box-shadow: 0 0 0 9px rgba(79, 125, 94, 0);
  }

  100% {
    box-shadow: 0 0 0 0 rgba(79, 125, 94, 0);
  }
}

.live-sub {
  margin: 0;
  color: var(--ink-400);
  font-size: 0.88rem;
  font-weight: 600;
}

.live-muted {
  margin-left: 0.4rem;
  color: var(--warning);
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
  margin-bottom: 1rem;

  @include tablet {
    max-width: 520px;
  }
}

.panel-title {
  font-size: 0.9rem;
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
  background: var(--cream-200);
  border-radius: 999px;
  padding: 0.35rem 0.8rem 0.35rem 0.4rem;
}

.cabin-pill-number {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--navy-800);
  color: var(--cream-100);
  font-weight: 700;
  font-size: 0.85rem;
}

.cabin-pill-total {
  font-weight: 700;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.feed-card {
  width: 100%;
}

.feed-empty {
  margin: 0;
  color: var(--ink-400);
  font-size: 0.92rem;
}

.feed {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.event {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 0.75rem;
  padding: 0.7rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--cream-100);
  border-left: 3px solid var(--ink-400);

  &--pedido {
    border-left-color: var(--navy-600);
  }

  &--cobro {
    border-left-color: var(--success);
  }

  &--inventario {
    border-left-color: var(--warning);
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

.event-body {
  min-width: 0;
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
  overflow-wrap: break-word;
}

.event-meta {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: var(--ink-400);

  i {
    margin-right: 0.2rem;
  }
}
</style>
