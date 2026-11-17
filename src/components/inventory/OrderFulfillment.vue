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
 * dueña (Bodega de Quito · Compra nueva) → "Confirmar mi envío".
 * Flujo simple (Gabriel, 16-nov-2026): nada sube al barco hasta que el bar
 * confirma lo recibido; el inventario suma lo que llegó de verdad.
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
const canReceive = computed(() => userStore.isDirector || userStore.role === 'bartender')
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
const inTransit = computed(() => props.order.deliveries.filter((d) => !d.arrivedAt && (d.kind === 'envio' || d.awaitsBar)))

/** Lo que el bar dice que llegó, por entrega y producto; empieza con lo enviado. */
const got = ref<Record<string, Record<string, number>>>({})
const itemKey = (i: { product: string; source: DeliverySource }) => `${i.product}:${i.source}`
watch(
  inTransit,
  (list) => {
    for (const d of list) got.value[d.key] ??= Object.fromEntries(d.items.map((i) => [itemKey(i), i.qty]))
  },
  { immediate: true },
)

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
      : `${total.value} envase(s). Se descuenta de la Bodega de puerto lo que tomas. El barco lo suma cuando el bar confirme lo recibido.`,
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
    toast.success(isEnvio ? 'Envío confirmado: queda en camino al barco' : 'Entrega confirmada: el bar confirma lo recibido')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

async function receive(d: (typeof inTransit.value)[number]) {
  if (busy.value) return
  const counts = got.value[d.key] ?? {}
  const items = d.items.map((i) => ({ productId: i.product, source: i.source, received: counts[itemKey(i)] ?? i.qty }))
  const short = d.items.filter((i) => (counts[itemKey(i)] ?? i.qty) < i.qty)
  const ok = await confirmStore.ask({
    title: '¿Confirmar lo recibido?',
    message: short.length
      ? `Llegó menos de ${short.map((i) => i.name).join(', ')}. El barco suma solo lo que llegó y lo que falta vuelve a quedar pendiente en el pedido.`
      : 'Llegó todo lo enviado. Se suma al inventario del barco.',
    confirmLabel: 'Confirmar lo recibido',
    icon: 'fa-box-open',
  })
  if (!ok) return
  busy.value = true
  try {
    const order = await apiArriveWeeklyOrder(props.order._id, d.key, items)
    void catalog.load(true)
    play('success')
    toast.success(short.length ? 'Recibido: lo que faltó quedó pendiente' : 'Recibido: ya está en el inventario del barco')
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
      Administración entrega desde la Bodega de puerto o con compra nueva; la dueña envía desde la Bodega de Quito. Nada
      sube al inventario del barco hasta que el bar confirma lo que recibió.
    </p>

    <!-- Por recibir: el bar cuenta lo que llegó y lo confirma -->
    <div v-for="d in inTransit" :key="d.key" class="transit">
      <p class="transit-head">
        <i class="fa-solid" :class="d.kind === 'envio' ? 'fa-truck-fast' : 'fa-ship'" aria-hidden="true" />
        <span>
          <strong>Por recibir en el barco</strong> · {{ d.kind === 'envio' ? 'envió' : 'entregó' }} {{ d.byName }} el
          {{ formatDateTime(d.at) }}
        </span>
      </p>
      <template v-if="canReceive">
        <p class="muted">Cuenta lo que llegó. Si llegó menos, baja la cantidad: el barco suma solo lo recibido.</p>
        <div class="mine-list">
          <div v-for="i in d.items" :key="itemKey(i)" class="mine-row receive-row">
            <div class="mine-name">
              <strong>{{ i.name }}</strong>
              <small>Enviaron {{ i.qty }} ({{ SOURCE[i.source] }})</small>
            </div>
            <label class="mine-field">
              <span>Llegó</span>
              <QtyStepper v-model="got[d.key]![itemKey(i)]" :min="0" :max="i.qty" :step="1" allow-zero :label="`${i.name}: cuánto llegó`" />
            </label>
          </div>
        </div>
        <button type="button" class="btn btn-gold btn-lg" :disabled="busy" @click="receive(d)">
          <i class="fa-solid fa-box-open" aria-hidden="true" /> Confirmar lo recibido
        </button>
      </template>
      <small v-else>
        {{ d.items.map((i) => `${i.name} ${i.qty} (${SOURCE[i.source]})`).join(' · ') }} · espera que el bar confirme lo recibido
      </small>
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
      Lo atienden Administración (puerto o compra nueva) y la dueña (Quito). Cuando llegue, aquí confirmas lo recibido.
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
  display: grid;
  gap: 0.6rem;
  padding: 0.75rem;
  border: 1px solid var(--warning);
  border-radius: var(--radius);
  background: var(--surface);

  small {
    color: var(--ink-600);
  }
}

.transit-head {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  margin: 0;
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
