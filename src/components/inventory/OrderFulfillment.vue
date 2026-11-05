<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import QtyStepper from '@/components/supply/QtyStepper.vue'
import { useCatalogStore } from '@/stores/catalog'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { useSound } from '@/composables/useSound'
import { apiArriveWeeklyOrder, apiFulfillWeeklyOrder } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime } from '@/utils/format'
import { containerText, stockText } from '@/components/supply/units'
import type { DeliverySource, WeeklyOrder, WeeklyOrderLine } from '@/types'

/**
 * Entrega compartida del pedido aprobado (guía 4 perfiles, 4-nov-2026). En la
 * misma lista cada responsable dice cuánto atiende y de dónde sale:
 * administradora (Bodega de puerto · Compra nueva) → "Confirmar mi entrega";
 * dueña (Bodega de Quito · Compra nueva) → "Confirmar mi envío". El envío de
 * Quito suma al barco al confirmar su llegada, sin descontar Quito otra vez.
 */
const props = defineProps<{ order: WeeklyOrder }>()
const emit = defineEmits<{ updated: [order: WeeklyOrder] }>()

const catalog = useCatalogStore()
const confirmStore = useConfirmStore()
const toast = useToastStore()
const userStore = useUserStore()
const { play } = useSound()

/** La dueña envía desde Quito; la administradora entrega desde puerto. */
const mine = computed<'entrega' | 'envio' | null>(() => {
  if (userStore.isOwner) return 'envio'
  if (userStore.role === 'admin') return 'entrega'
  return null
})
const canArrive = computed(() => userStore.isDirector || userStore.role === 'admin')
const store = computed<DeliverySource>(() => (mine.value === 'envio' ? 'quito' : 'puerto'))
const STORE_LABEL: Record<'puerto' | 'quito', string> = { puerto: 'Bodega de puerto', quito: 'Bodega de Quito' }

interface Row {
  fromStore: number
  bought: number
}
const rows = ref<Record<string, Row>>({})
const documentRef = shallowRef('')
const busy = shallowRef(false)
/** Clave de esta entrega: si se corta la señal y se reintenta, no se duplica. */
let key = crypto.randomUUID()

const open = computed(() => props.order.lines.filter((l) => l.pending > 0))
const inTransit = computed(() => props.order.deliveries.filter((d) => d.kind === 'envio' && !d.arrivedAt))

watch(
  () => props.order._id,
  () => {
    rows.value = {}
    documentRef.value = ''
    key = crypto.randomUUID()
  },
)

// Una fila editable por producto pendiente (se crea fuera del render).
watch(
  open,
  (lines) => {
    for (const l of lines) rows.value[l.product] ??= { fromStore: 0, bought: 0 }
  },
  { immediate: true },
)

function row(l: WeeklyOrderLine): Row {
  return rows.value[l.product] ?? { fromStore: 0, bought: 0 }
}

/** Existencia actual en mi bodega (no la del corte). */
function inStore(l: WeeklyOrderLine): number {
  const p = catalog.physical.find((x) => x._id === l.product)
  return (store.value === 'quito' ? p?.quitoStock : p?.puertoStock) ?? 0
}

function over(l: WeeklyOrderLine): boolean {
  const r = rows.value[l.product]
  return Boolean(r && r.fromStore + r.bought > l.pending)
}

const items = computed(() =>
  open.value.flatMap((l) => {
    const r = rows.value[l.product]
    if (!r) return []
    const list: Array<{ productId: string; source: DeliverySource; qty: number }> = []
    if (r.fromStore > 0) list.push({ productId: l.product, source: store.value, qty: r.fromStore })
    if (r.bought > 0) list.push({ productId: l.product, source: 'compra', qty: r.bought })
    return list
  }),
)
const total = computed(() => items.value.reduce((s, i) => s + i.qty, 0))
const invalid = computed(() => open.value.find(over))

async function confirmMine() {
  if (!mine.value || busy.value || !items.value.length) return
  if (invalid.value) {
    toast.error(`${invalid.value.name}: faltan ${containerText(invalid.value.pending, invalid.value)}; no atiendas más.`)
    return
  }
  const isEnvio = mine.value === 'envio'
  const ok = await confirmStore.ask({
    title: isEnvio ? '¿Confirmar tu envío desde Quito?' : '¿Confirmar tu entrega al barco?',
    message: isEnvio
      ? `${total.value} envase(s). Se descuenta de la Bodega de Quito una sola vez. El barco los suma cuando se confirme la llegada.`
      : `${total.value} envase(s). Se descuenta de la Bodega de puerto lo que tomas y se suma al barco todo lo entregado.`,
    confirmLabel: isEnvio ? 'Confirmar mi envío' : 'Confirmar mi entrega',
    icon: isEnvio ? 'fa-truck-fast' : 'fa-ship',
  })
  if (!ok) return
  busy.value = true
  try {
    const order = await apiFulfillWeeklyOrder(props.order._id, isEnvio ? 'ship' : 'deliver', {
      key,
      document: documentRef.value.trim(),
      items: items.value,
    })
    key = crypto.randomUUID()
    rows.value = {}
    documentRef.value = ''
    emit('updated', order)
    void catalog.load(true)
    play('success')
    toast.success(isEnvio ? 'Envío confirmado: queda en camino al barco' : 'Entrega confirmada: ya está en el barco')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

async function arrive(deliveryKey: string) {
  if (busy.value) return
  const ok = await confirmStore.ask({
    title: '¿Llegó el envío de Quito?',
    message: 'Se suma al barco lo enviado. Quito no se descuenta otra vez.',
    confirmLabel: 'Confirmar llegada',
    icon: 'fa-box-open',
  })
  if (!ok) return
  busy.value = true
  try {
    const order = await apiArriveWeeklyOrder(props.order._id, deliveryKey)
    void catalog.load(true)
    play('success')
    toast.success('Llegada confirmada: ya está en el barco')
    emit('updated', order)
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

const SOURCE: Record<DeliverySource, string> = { puerto: 'puerto', quito: 'Quito', compra: 'compra nueva' }
</script>

<template>
  <section class="card fulfil" aria-labelledby="fulfil-title">
    <h2 id="fulfil-title" class="fulfil-title">Entrega del pedido</h2>
    <p class="muted">
      Cada responsable confirma solo su parte. Administración entrega desde la Bodega de puerto o con compra nueva; la
      dueña envía desde la Bodega de Quito. Todos ven lo que aportó cada uno.
    </p>

    <!-- Envíos de Quito en camino: se confirma la llegada en el mismo pedido -->
    <div v-for="d in inTransit" :key="d.key" class="transit">
      <i class="fa-solid fa-truck-fast" aria-hidden="true" />
      <span>
        <strong>En camino desde Quito</strong> · envió {{ d.byName }} el {{ formatDateTime(d.at) }}
        <small>{{ d.items.map((i) => `${i.name} ${i.qty} (${SOURCE[i.source]})`).join(' · ') }}</small>
      </span>
      <button v-if="canArrive" type="button" class="btn btn-primary" :disabled="busy" @click="arrive(d.key)">
        <i class="fa-solid fa-box-open" aria-hidden="true" /> Confirmar llegada
      </button>
    </div>

    <p v-if="!open.length && !inTransit.length" class="done">
      <i class="fa-solid fa-circle-check" aria-hidden="true" /> Todo el pedido ya está en el barco.
    </p>

    <!-- Mi parte -->
    <template v-if="mine && open.length">
      <h3 class="mine-title">
        {{ mine === 'envio' ? 'Lo que envío' : 'Lo que entrego' }}
        <small>Pon cuánto atiendes y de dónde sale. Lo que no atiendas queda pendiente.</small>
      </h3>
      <div class="mine-list">
        <div v-for="l in open" :key="l.product" class="mine-row" :class="{ 'mine-row--bad': over(l) }">
          <div class="mine-name">
            <strong>{{ l.name }}</strong>
            <small>Falta {{ containerText(l.pending, l) }} · hay {{ stockText(inStore(l), l) }} en {{ STORE_LABEL[store as 'puerto' | 'quito'] }}</small>
          </div>
          <label class="mine-field">
            <span>{{ STORE_LABEL[store as 'puerto' | 'quito'] }}</span>
            <QtyStepper v-model="row(l).fromStore" :min="0" :step="1" allow-zero :label="`${l.name} desde ${STORE_LABEL[store as 'puerto' | 'quito']}`" />
          </label>
          <label class="mine-field">
            <span>Compra nueva</span>
            <QtyStepper v-model="row(l).bought" :min="0" :step="1" allow-zero :label="`${l.name} de compra nueva`" />
          </label>
        </div>
      </div>
      <label class="doc">
        <span>Factura o documento de la compra (opcional)</span>
        <input v-model="documentRef" type="text" maxlength="120" placeholder="Ej.: Fact. 001-002-000123" />
      </label>
      <button type="button" class="btn btn-gold btn-lg" :disabled="busy || !total || !!invalid" @click="confirmMine">
        <i class="fa-solid" :class="mine === 'envio' ? 'fa-truck-fast' : 'fa-ship'" aria-hidden="true" />
        {{ mine === 'envio' ? 'Confirmar mi envío' : 'Confirmar mi entrega' }}
        <template v-if="total"> ({{ total }})</template>
      </button>
    </template>
    <p v-else-if="!mine && open.length" class="muted">
      Lo atienden Administración (puerto o compra nueva) y la dueña (Quito). Aquí ves su avance.
    </p>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.fulfil {
  display: grid;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.fulfil-title {
  margin: 0;
  font-size: 1.15rem;
}

.muted {
  margin: 0;
  color: var(--ink-600);
}

.transit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem;
  border: 1px solid var(--warning);
  border-radius: var(--radius);
  background: var(--surface);

  > span {
    flex: 1 1 240px;
    display: grid;
    gap: 0.15rem;
  }

  small {
    color: var(--ink-600);
  }
}

.done {
  margin: 0;
  font-weight: 600;
  color: var(--success, #2f7d4f);
}

.mine-title {
  display: grid;
  gap: 0.15rem;
  margin: 0.25rem 0 0;
  font-size: 1rem;

  small {
    font-weight: 400;
    color: var(--ink-600);
  }
}

.mine-list {
  display: grid;
  gap: 0.5rem;
}

.mine-row {
  display: grid;
  gap: 0.5rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);

  @include tablet {
    grid-template-columns: minmax(160px, 1.4fr) repeat(auto-fit, minmax(150px, 1fr));
    align-items: end;
  }

  &--bad {
    border-color: var(--danger);
  }
}

.mine-name {
  display: grid;
  gap: 0.1rem;

  small {
    color: var(--ink-600);
  }
}

.mine-field,
.doc {
  display: grid;
  gap: 0.25rem;
  font-size: 0.9rem;
  font-weight: 600;

  input {
    min-height: 44px;
    padding: 0 0.7rem;
    border: 1.5px solid var(--line-strong);
    border-radius: 10px;
    font: inherit;
    font-weight: 400;
  }
}
</style>
