<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import type { Order } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import { useUserStore } from '@/stores/user'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { apiCancelOrder, apiDeliverOrder, apiOrders, apiRequestAnnulment } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatTime, newKey } from '@/utils/format'

const props = defineProps<{ cruiseId: string }>()
const emit = defineEmits<{ close: []; changed: [] }>()

const userStore = useUserStore()
const confirmStore = useConfirmStore()
const toast = useToastStore()
const { play } = useSound()

const tab = shallowRef<'pendiente' | 'entregada'>('pendiente')
const orders = shallowRef<Order[]>([])
const loading = shallowRef(true)
const busy = shallowRef<string | null>(null)
/** Cuántas unidades entregar ahora, por pedido e ítem. */
const toDeliver = reactive<Record<string, number[]>>({})

const CANCEL_REASONS = [
  'Cabina equivocada',
  'El pasajero cambió de opinión',
  'Producto agotado',
  'Registro duplicado',
]

function pendingOf(order: Order, index: number): number {
  const item = order.items[index]!
  return Math.max(0, item.qty - item.deliveredQty - item.cancelledQty)
}

function authorName(order: Order): string {
  return typeof order.createdBy === 'object' ? order.createdBy.name : ''
}

function isMine(order: Order): boolean {
  return typeof order.createdBy === 'object' && order.createdBy._id === userStore.user?.id
}

function canCancel(order: Order): boolean {
  return userStore.isLead || isMine(order)
}

async function load() {
  loading.value = true
  try {
    const data = await apiOrders({ cruiseId: props.cruiseId, status: tab.value, limit: 60 })
    orders.value = data.orders.filter((o) => !o.payment)
    for (const order of orders.value) {
      toDeliver[order._id] = order.items.map((_, i) => pendingOf(order, i))
    }
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

watch(tab, load, { immediate: true })

const totalToDeliver = computed(() => (orderId: string) =>
  (toDeliver[orderId] ?? []).reduce((sum, n) => sum + n, 0),
)

function step(order: Order, index: number, delta: number) {
  const current = toDeliver[order._id]![index]!
  const next = Math.min(pendingOf(order, index), Math.max(0, current + delta))
  toDeliver[order._id]![index] = next
}

async function deliver(order: Order) {
  const items = (toDeliver[order._id] ?? [])
    .map((qty, index) => ({ index, qty }))
    .filter((i) => i.qty > 0)
  if (!items.length) return
  busy.value = order._id
  try {
    await apiDeliverOrder(order._id, newKey(), items)
    play('success')
    toast.success(`Entregado en cabina ${order.cabinNumber}`)
    emit('changed')
    await load()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = null
  }
}

async function cancelPending(order: Order) {
  const pending = order.items
    .map((item, index) => ({ name: item.name, qty: pendingOf(order, index) }))
    .filter((i) => i.qty > 0)
  const summary = pending.map((p) => `${p.qty} ${p.name}`).join(', ')
  const reason = await confirmStore.askReason({
    title: `¿Cancelar ${summary} de cabina ${order.cabinNumber}?`,
    message: 'Lo pendiente sale de la cuenta. No cambia el inventario porque aún no se entregó.',
    confirmLabel: 'Sí, cancelar',
    danger: true,
    icon: 'fa-triangle-exclamation',
    reason: { label: 'Motivo (obligatorio)', suggestions: CANCEL_REASONS },
  })
  if (!reason) return
  busy.value = order._id
  try {
    await apiCancelOrder(order._id, reason)
    play('tap')
    toast.success('Pendiente cancelado')
    emit('changed')
    await load()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = null
  }
}

async function requestAnnulment(order: Order, index: number) {
  const item = order.items[index]!
  const reason = await confirmStore.askReason({
    title: `¿Pedir anular 1 ${item.name}?`,
    message:
      'Ya fue entregado: Dirección revisa la solicitud. Devolver la bebida al inventario lo decide Paula.',
    confirmLabel: 'Enviar solicitud',
    icon: 'fa-rotate-left',
    reason: {
      label: 'Motivo (obligatorio)',
      suggestions: ['Se entregó a la cabina equivocada', 'Bebida devuelta cerrada', 'Error de registro'],
    },
  })
  if (!reason) return
  busy.value = order._id
  try {
    await apiRequestAnnulment(order._id, index, 1, reason)
    toast.success('Solicitud enviada a Dirección')
    await load()
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = null
  }
}

function annulmentPending(order: Order, index: number): number {
  return order.annulments
    .filter((a) => a.index === index && a.status === 'pendiente')
    .reduce((sum, a) => sum + a.qty, 0)
}
</script>

<template>
  <BaseModal title="Pedidos de la salida" @close="emit('close')">
    <div class="tabs" role="tablist">
      <button
        type="button"
        class="tab"
        :class="{ 'tab--on': tab === 'pendiente' }"
        @click="tab = 'pendiente'"
      >
        <i class="fa-solid fa-hourglass-half" aria-hidden="true" /> Por entregar
      </button>
      <button
        type="button"
        class="tab"
        :class="{ 'tab--on': tab === 'entregada' }"
        @click="tab = 'entregada'"
      >
        <i class="fa-solid fa-check-double" aria-hidden="true" /> Entregados
      </button>
    </div>

    <SkeletonList v-if="loading" variant="row" :rows="3" />

    <p v-else-if="!orders.length" class="empty">
      <i class="fa-regular fa-face-smile" aria-hidden="true" />
      {{ tab === 'pendiente' ? 'No hay bebidas por entregar.' : 'Aún no hay pedidos entregados sin cobrar.' }}
    </p>

    <TransitionGroup v-else name="list" tag="div" class="orders">
      <article v-for="order in orders" :key="order._id" class="order" :class="{ 'order--busy': busy === order._id }">
        <header class="order-head">
          <span class="order-cabin">Cabina {{ order.cabinNumber }}</span>
          <span class="order-meta">
            <i class="fa-regular fa-clock" aria-hidden="true" /> {{ formatTime(order.createdAt) }}
            · <i class="fa-regular fa-user" aria-hidden="true" /> {{ authorName(order) }}
          </span>
        </header>

        <ul class="items">
          <li v-for="(item, index) in order.items" :key="index" class="item">
            <div class="item-info">
              <span class="item-name">{{ item.name }}</span>
              <span class="item-status">
                Pedido {{ item.qty }} · Entregadas {{ item.deliveredQty }}
                <template v-if="item.cancelledQty"> · Canceladas {{ item.cancelledQty }}</template>
                <template v-if="item.annulledQty"> · Anuladas {{ item.annulledQty }}</template>
              </span>
            </div>

            <div v-if="tab === 'pendiente' && pendingOf(order, index) > 0" class="stepper">
              <span class="stepper-label">Entregar ahora</span>
              <button type="button" aria-label="Menos" @click="step(order, index, -1)">
                <i class="fa-solid fa-minus" aria-hidden="true" />
              </button>
              <strong>{{ toDeliver[order._id]?.[index] ?? 0 }}</strong>
              <button type="button" aria-label="Más" @click="step(order, index, 1)">
                <i class="fa-solid fa-plus" aria-hidden="true" />
              </button>
            </div>

            <button
              v-else-if="tab === 'entregada' && item.deliveredQty - item.annulledQty - annulmentPending(order, index) > 0"
              type="button"
              class="annul-btn"
              @click="requestAnnulment(order, index)"
            >
              <i class="fa-solid fa-rotate-left" aria-hidden="true" /> Pedir anulación
            </button>
            <span v-else-if="annulmentPending(order, index)" class="annul-pending">
              <i class="fa-solid fa-hourglass" aria-hidden="true" /> Anulación en revisión
            </span>
          </li>
        </ul>

        <footer v-if="tab === 'pendiente'" class="order-actions">
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!totalToDeliver(order._id) || busy === order._id"
            @click="deliver(order)"
          >
            <i class="fa-solid fa-check" aria-hidden="true" />
            Confirmar entrega de {{ totalToDeliver(order._id) }}
          </button>
          <button
            v-if="canCancel(order)"
            type="button"
            class="btn btn-ghost order-cancel"
            :disabled="busy === order._id"
            @click="cancelPending(order)"
          >
            <i class="fa-solid fa-ban" aria-hidden="true" /> Cancelar pendiente
          </button>
          <p v-else class="order-hint">Lo registró otra persona: pide a Dirección que lo cancele.</p>
        </footer>
      </article>
    </TransitionGroup>
  </BaseModal>
</template>

<style scoped lang="scss">
.tabs {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 1rem;
}

.tab {
  flex: 1;
  min-height: 44px;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--cream-200);
  font-weight: 600;
  font-size: 0.88rem;
  color: var(--ink-600);
  transition: all 0.15s ease;

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }
}

.empty {
  margin: 1rem 0;
  text-align: center;
  color: var(--ink-400);
}

.orders {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.order {
  border: 1px solid var(--cream-200);
  border-radius: var(--radius-sm);
  padding: 0.85rem;
  transition: opacity 0.15s ease;

  &--busy {
    opacity: 0.6;
    pointer-events: none;
  }
}

.order-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.order-cabin {
  font-weight: 700;
}

.order-meta {
  font-size: 0.76rem;
  color: var(--ink-400);
}

.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.item-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.item-name {
  font-weight: 600;
}

.item-status {
  font-size: 0.78rem;
  color: var(--ink-400);
}

.stepper {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.25rem 0.35rem 0.25rem 0.7rem;
  border-radius: 999px;
  background: var(--cream-100);
  border: 1px solid var(--cream-200);

  button {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--surface);
    color: var(--ink-600);
    font-size: 0.8rem;
  }

  strong {
    min-width: 1.2rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
}

.stepper-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-600);
}

.annul-btn {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--gold-500);
  padding: 0.4rem 0.6rem;
  border-radius: var(--radius-sm);

  &:hover {
    background: rgba(159, 107, 60, 0.1);
  }
}

.annul-pending {
  font-size: 0.78rem;
  color: var(--warning);
  font-weight: 600;
}

.order-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.5rem;
  margin-top: 0.8rem;

  @media (min-width: 520px) {
    grid-template-columns: 1.4fr 1fr;
  }
}

.order-cancel {
  color: var(--danger);
  border-color: rgba(180, 72, 59, 0.45);
}

.order-hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--ink-400);
  align-self: center;
}
</style>
