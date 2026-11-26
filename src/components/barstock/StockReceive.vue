<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import QtyStepper from '@/components/supply/QtyStepper.vue'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { apiArriveWeeklyOrder } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { plural } from '@/components/supply/units'
import { formatDateTime } from '@/utils/format'
import { hoursWaiting } from '@/components/barstock/orders'
import type { WeeklyOrder, WeeklyOrderDelivery } from '@/types'

/**
 * «Pedido por recibir» (BAR - STOCK, 19-nov-2026). El bar ve lo que mandó
 * Tierra; si llegó todo toca RECIBIDO. Si hay diferencias cambia solo esos
 * productos y confirma. El barco suma únicamente lo recibido.
 */
const props = defineProps<{ order: WeeklyOrder; delivery: WeeklyOrderDelivery }>()
const emit = defineEmits<{ updated: [order: WeeklyOrder] }>()
const toast = useToastStore()
const { play } = useSound()

const rowKey = (i: WeeklyOrderDelivery['items'][number]) => `${i.product}:${i.source}`
const got = ref<Record<string, number>>(Object.fromEntries(props.delivery.items.map((i) => [rowKey(i), i.qty])))
const differences = shallowRef(false)
const busy = shallowRef(false)

const labelOf = (product: string) => props.order.lines.find((l) => l.product === product)
const unit = (product: string, n: number) => {
  return plural(labelOf(product)?.containerLabel || 'unidad', n)
}
const short = computed(() => props.delivery.items.filter((i) => (got.value[rowKey(i)] ?? i.qty) < i.qty))

async function confirm() {
  if (busy.value) return
  busy.value = true
  try {
    const order = await apiArriveWeeklyOrder(
      props.order._id,
      props.delivery.key,
      props.delivery.items.map((i) => ({ productId: i.product, source: i.source, received: got.value[rowKey(i)] ?? i.qty })),
      '',
      differences.value,
    )
    play('success')
    const late = order.deliveries.find((d) => d.key === props.delivery.key)
    toast.success(
      late?.needsDirector && !late.arrivedAt
        ? 'Recibido: como también compraste tú, confirma además la directora'
        : differences.value
          ? 'Llegó diferente: queda en tu nombre y se avisó a Gerencia'
          : 'Recibido completo: ya suma al stock del barco',
    )
    emit('updated', order)
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="card receive" :aria-label="`Pedido por recibir ${order.code}`">
    <header class="receive-head">
      <i class="fa-solid fa-truck-ramp-box" aria-hidden="true" />
      <div>
        <h2>Pedido por recibir</h2>
        <p class="muted">
          {{ order.code }} · lo envió {{ delivery.byName }} el {{ formatDateTime(delivery.at) }}
          <span v-if="hoursWaiting(delivery) >= 24" class="late"> · {{ hoursWaiting(delivery) }} h sin confirmar</span>
        </p>
        <p class="muted">Guarda cada cosa en su categoría antes de confirmar: la recepción queda a tu nombre.</p>
      </div>
    </header>

    <ul class="receive-list">
      <li v-for="i in delivery.items" :key="rowKey(i)" class="receive-row">
        <span class="receive-name">{{ i.name }}</span>
        <span v-if="!differences" class="receive-qty">
          <strong>{{ i.qty }}</strong> {{ unit(i.product, i.qty) }}
        </span>
        <span v-else class="receive-edit">
          <small>Enviaron {{ i.qty }} · llegaron</small>
          <QtyStepper
            v-model="got[rowKey(i)]"
            :min="0"
            :max="i.qty"
            allow-zero
            :label="`Cuántos llegaron de ${i.name}`"
          />
        </span>
      </li>
    </ul>

    <div class="receive-actions">
      <button v-if="!differences" type="button" class="btn btn-primary btn-lg" :disabled="busy" @click="confirm">
        <i class="fa-solid fa-circle-check" aria-hidden="true" /> Recibido completo
      </button>
      <button v-if="!differences" type="button" class="btn btn-secondary" :disabled="busy" @click="differences = true">
        Llegó diferente
      </button>
      <template v-else>
        <button type="button" class="btn btn-primary btn-lg" :disabled="busy" @click="confirm">
          <i class="fa-solid fa-circle-check" aria-hidden="true" /> Confirmar lo recibido
        </button>
        <button type="button" class="btn btn-text" :disabled="busy" @click="differences = false">Cancelar</button>
      </template>
    </div>
    <p v-if="differences && short.length" class="muted">
      Lo que no llegó queda pendiente en el pedido para que Tierra lo vuelva a enviar.
    </p>
  </section>
</template>

<style scoped lang="scss">
.late {
  font-weight: 700;
  color: var(--danger-ink);
}

.receive {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  border-color: var(--gold-500);
  border-width: 2px;
}

.receive-head {
  display: flex;
  align-items: center;
  gap: 0.8rem;

  > i {
    font-size: 1.6rem;
    color: var(--gold-600);
  }

  h2 {
    margin: 0;
    font-size: 1.3rem;
  }

  p {
    margin: 0.15rem 0 0;
  }
}

.receive-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.receive-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  padding: 0.65rem 0;
  border-bottom: 1px solid var(--line);

  &:last-child {
    border-bottom: 0;
  }
}

.receive-name {
  font-weight: 600;
  color: var(--ink-900);
}

.receive-qty {
  font-variant-numeric: tabular-nums;
  color: var(--ink-600);

  strong {
    font-size: 1.15rem;
    color: var(--ink-900);
  }
}

.receive-edit {
  display: flex;
  align-items: center;
  gap: 0.6rem;

  small {
    color: var(--ink-600);
  }
}

.receive-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
</style>
