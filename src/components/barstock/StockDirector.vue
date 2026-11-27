<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import { awaitingDirector, loadOpenOrders, replaceOrder } from '@/components/barstock/orders'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { apiApproveWeeklyOrder, apiDirectorConfirmArrival, apiReturnWeeklyOrder } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime, formatHour } from '@/utils/format'
import type { WeeklyOrder, WeeklyOrderLine } from '@/types'

/**
 * BAR - STOCK, pantalla de la directora tal cual la especificación (24-nov-2026, pág. 9):
 * cuántos productos y solo los ajustes del bartender con su motivo; Aprobar o
 * Devolver al bartender. Aprobado → le llega a Compras en tierra.
 */
const confirmStore = useConfirmStore()
const toast = useToastStore()
const { play } = useSound()

const orders = shallowRef<WeeklyOrder[]>([])
const order = shallowRef<WeeklyOrder | null>(null)
const loading = shallowRef(true)
const busy = shallowRef(false)

const pending = computed(() => orders.value.filter((o) => o.status === 'bar' || o.status === 'directora'))
const approved = computed(() => orders.value.filter((o) => o.status === 'aprobado' && !o.noNeeds))

function open(o: WeeklyOrder | null) {
  order.value = o
}

async function load() {
  loading.value = true
  try {
    const { orders: list } = await loadOpenOrders()
    orders.value = list
    open(list.find((o) => o.status === 'directora') ?? list.find((o) => o.status === 'bar') ?? null)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}
onMounted(load)

const weekText = computed(() =>
  order.value
    ? new Date(`${order.value.week}T12:00:00-06:00`).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', timeZone: 'Pacific/Galapagos' }).replace('.', '')
    : '',
)
const products = computed(() => (order.value?.lines ?? []).filter((l) => l.qty > 0).length)
/** Lo que el bartender cambió de la propuesta (incluye lo que agregó). */
const adjustments = computed(() =>
  (order.value?.lines ?? []).filter((l): l is WeeklyOrderLine & { barQty: number } => l.barQty != null && l.barQty !== (l.suggested ?? 0)),
)

function settle(next: WeeklyOrder) {
  orders.value = replaceOrder(orders.value, next)
  open(orders.value.find((x) => x.status === 'directora') ?? null)
}

/** Recepciones que el mismo bartender compró y recibió: confirma también la directora. */
const toConfirm = computed(() => orders.value.flatMap((o) => awaitingDirector(o).map((d) => ({ order: o, delivery: d }))))
async function confirmArrival(o: WeeklyOrder, key: string) {
  try {
    const next = await apiDirectorConfirmArrival(o._id, key)
    orders.value = replaceOrder(orders.value, next)
    toast.success('Recepción confirmada: ya suma al stock')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

async function approve() {
  const o = order.value
  if (!o || busy.value) return
  const none = products.value === 0
  const ok = await confirmStore.ask({
    title: none ? '¿Cerrar sin pedido?' : `¿Aprobar el pedido ${o.code}?`,
    message: none
      ? 'Todo está en cero: esta semana el barco no necesita nada. Queda en el historial.'
      : `${products.value} producto(s). Le llega a Compras en tierra.${o.status === 'bar' ? ' El bartender todavía no lo había enviado.' : ''}`,
    confirmLabel: none ? 'Cerrar sin pedido' : 'Aprobar',
    icon: none ? 'fa-circle-check' : 'fa-stamp',
  })
  if (!ok) return
  busy.value = true
  try {
    settle(await apiApproveWeeklyOrder(o._id, o.version, none))
    play('success')
    toast.success(none ? 'Cerrado sin pedido' : 'Pedido aprobado: le llega a Compras en tierra')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

async function giveBack() {
  const o = order.value
  if (!o || busy.value) return
  const reason = await confirmStore.askReason({
    title: 'Devolver al bartender',
    message: 'El bartender lo corrige y te lo vuelve a enviar.',
    confirmLabel: 'Devolver',
    icon: 'fa-rotate-left',
    reason: { label: '¿Qué debe corregir?', placeholder: 'Ej.: sube el Bacardi, viene grupo grande' },
  })
  if (reason === null) return
  busy.value = true
  try {
    settle(await apiReturnWeeklyOrder(o._id, o.version, reason))
    toast.success('Devuelto al bartender')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

/** Avance de un pedido aprobado: aprobado, enviado y recibido (envases). */
function progress(o: WeeklyOrder) {
  const sum = (f: (l: WeeklyOrderLine) => number) => o.lines.reduce((s, l) => s + f(l), 0)
  return { approved: sum((l) => l.qty), sent: sum((l) => l.inTransit), received: sum((l) => l.delivered) }
}
</script>

<template>
  <div class="director">
    <SkeletonList v-if="loading" :rows="5" />
    <template v-else>
      <nav v-if="pending.length > 1" class="segs" aria-label="Pedidos pendientes">
        <button
          v-for="o in pending"
          :key="o._id"
          type="button"
          class="segs-item"
          :class="{ 'segs-item--on': order?._id === o._id }"
          @click="open(o)"
        >
          {{ o.code }}
        </button>
      </nav>

      <section v-for="r in toConfirm" :key="r.delivery.key" class="card confirm-card">
        <p>
          <strong>Recepción por confirmar · {{ r.order.code }}</strong><br />
          {{ r.delivery.arrivedByName }} compró y recibió: confirma tú también para que suba el stock.
          <template v-if="r.delivery.different"> Llegó diferente.</template>
        </p>
        <ul>
          <li v-for="i in r.delivery.items" :key="i.product">{{ i.name }}: {{ i.received ?? i.qty }} de {{ i.qty }}</li>
        </ul>
        <button type="button" class="btn btn-primary" @click="confirmArrival(r.order, r.delivery.key)">Confirmar recepción</button>
      </section>

      <section v-if="!order" class="card vacio-card">
        <i class="fa-solid fa-circle-check" aria-hidden="true" />
        <p>No hay pedidos por aprobar.</p>
      </section>

      <template v-else>
        <header class="intro">
          <small class="eyebrow">Pedido · semana {{ weekText }}</small>
          <h2>Aprobar pedido · {{ order.code }}</h2>
          <p>
            Apruebas hasta las {{ order.approveDeadline ? formatHour(order.approveDeadline).replace(':', 'h') : '18h00' }}. Si no, se aprueba solo con la propuesta.
          </p>
          <p v-if="order.status === 'bar'" class="warn">El bartender todavía lo está ajustando.</p>
        </header>

        <section class="box">
          <strong>{{ products }} productos</strong>
          <span>Ajustes del bartender: {{ adjustments.length }}</span>
        </section>

        <section v-for="l in adjustments" :key="l.product" class="box">
          <span><strong>{{ l.name }}</strong> {{ l.suggested ?? 0 }} → {{ l.barQty }}</span>
          <small v-if="l.observation">"{{ l.observation }}"</small>
        </section>

        <div class="actions">
          <button type="button" class="btn btn-primary btn-lg" :disabled="busy" @click="approve">
            {{ products ? 'Aprobar' : 'Cerrar sin pedido' }}
          </button>
          <button v-if="order.status === 'directora'" type="button" class="btn btn-secondary btn-lg" :disabled="busy" @click="giveBack">
            Devolver al bartender
          </button>
          <small>Aprobado → le llega a Compras en tierra.</small>
        </div>
      </template>

      <section v-if="approved.length" class="card sent" aria-label="Pedidos aprobados">
        <h3>Pedidos aprobados</h3>
        <ul>
          <li v-for="o in approved" :key="o._id">
            <strong>{{ o.code }}</strong>
            <span class="estado" :class="{ 'estado--ok': o.phase === 'completo' }">{{ o.phaseLabel }}</span>
            <small>
              Aprobado {{ progress(o).approved }} · en camino {{ progress(o).sent }} · recibido {{ progress(o).received }}
              <template v-if="o.history.length"> · {{ o.history.at(-1)!.action }} {{ formatDateTime(o.history.at(-1)!.at) }}</template>
            </small>
          </li>
        </ul>
      </section>
    </template>

  </div>
</template>

<style scoped lang="scss">
.confirm-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border-color: var(--pill-warn-bg);

  p,
  ul {
    margin: 0;
  }
}

.director {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.intro {
  h2 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.3rem;
    font-size: 1.35rem;
  }

  p {
    margin: 0;
    color: var(--ink-600);
  }
}

.vacio-card {
  display: flex;
  align-items: center;
  gap: 0.7rem;

  i {
    color: var(--success-ink);
    font-size: 1.3rem;
  }

  p {
    margin: 0;
  }
}

.eyebrow {
  display: block;
  margin-bottom: 0.15rem;
  color: var(--ink-600);
}

.warn {
  margin-top: 0.4rem !important;
  color: var(--warning-ink) !important;
  font-weight: 600;
}

.box {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);

  small {
    color: var(--ink-600);
  }
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;

  .btn {
    width: 100%;
  }

  small {
    color: var(--ink-600);
  }
}

.sent {
  h3 {
    margin: 0 0 0.6rem;
    font-size: 1.1rem;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem 0.6rem;
  }

  small {
    flex-basis: 100%;
    color: var(--ink-600);
  }
}
</style>
