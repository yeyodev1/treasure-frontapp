<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import QtyStepper from '@/components/supply/QtyStepper.vue'
import StockReceive from '@/components/barstock/StockReceive.vue'
import { awaitingBar, dayText, groupByCategory, loadOpenOrders, orderGroupOf, replaceOrder } from '@/components/barstock/orders'
import { useCatalogStore } from '@/stores/catalog'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { SYNC_TEXT, useOrderSync } from '@/composables/useOrderSync'
import { apiSendWeeklyOrder } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { plural } from '@/components/supply/units'
import { formatHour } from '@/utils/format'
import type { WeeklyOrder, WeeklyOrderCurrent, WeeklyOrderLine } from '@/types'

/**
 * Pedido del miércoles, pantalla del bartender (Bar-stock, 24-nov-2026). A
 * las 12h00 la app propone con el consumo por pasajero de los últimos 4
 * cruceros; el bartender ajusta hasta las 15h00 (si cambia más de 20 %, con
 * motivo) y lo envía a la directora. Aquí ya no se cuenta: el conteo es solo
 * al cierre del crucero. Arriba, lo que hay que recibir.
 */
const catalog = useCatalogStore()
const confirmStore = useConfirmStore()
const toast = useToastStore()
const { play } = useSound()

interface Entry {
  qty: number
  observation: string
}

const current = shallowRef<WeeklyOrderCurrent | null>(null)
const orders = shallowRef<WeeklyOrder[]>([])
const order = shallowRef<WeeklyOrder | null>(null)
const entries = ref<Record<string, Entry>>({})
const added = ref<string[]>([])
const loading = shallowRef(true)
const busy = shallowRef(false)

const { sync, message, touch, flush, save, draft } = useOrderSync(order, payload)

const adjusting = computed(() => order.value?.status === 'bar')
/** Motivo con el que la directora lo devolvió (el último, si sigue en el bar). */
const returnedBy = computed(() => (adjusting.value ? [...(order.value?.history ?? [])].reverse().find((h) => h.action === 'Devuelto al bartender') : undefined))
const toReceive = computed(() => orders.value.flatMap((o) => awaitingBar(o).map((d) => ({ order: o, delivery: d }))))
const OUTLIER_PCT = 20

function lineOf(id: string): WeeklyOrderLine | undefined {
  return order.value?.lines.find((l) => l.product === id)
}
const entry = (id: string): Entry => entries.value[id] ?? { qty: lineOf(id)?.qty ?? 0, observation: lineOf(id)?.observation ?? '' }

/** Cambió más del 20 % lo propuesto (o pidió algo que no se propuso): necesita motivo. */
function needsReason(id: string) {
  const base = lineOf(id)?.suggested ?? 0
  const qty = entry(id).qty
  return base > 0 ? Math.abs(qty - base) > (base * OUTLIER_PCT) / 100 : qty > 0
}

function setQty(id: string, qty: number) {
  entries.value[id] = { ...entry(id), qty }
  touch()
}
function setReason(id: string, observation: string) {
  entries.value[id] = { ...entry(id), observation }
  touch()
}

/** Lo que va al servidor: las líneas propuestas y lo agregado a mano. */
function payload() {
  const ids = new Set([...(order.value?.lines.map((l) => l.product) ?? []), ...added.value, ...Object.keys(entries.value)])
  return [...ids]
    .map((id) => ({ productId: id, qty: entry(id).qty, observation: entry(id).observation, counted: null }))
    .filter((x) => lineOf(x.productId) || x.qty > 0)
}

function fromOrder(o: WeeklyOrder) {
  entries.value = Object.fromEntries(o.lines.map((l) => [l.product, { qty: l.qty, observation: l.observation }]))
  added.value = []
  for (const d of draft() ?? []) entries.value[d.productId] = { qty: d.qty, observation: d.observation }
  if (draft()) touch()
}

async function load() {
  loading.value = true
  try {
    const [{ current: c, orders: list }] = await Promise.all([loadOpenOrders(), catalog.load(true)])
    current.value = c
    orders.value = list
    order.value = c.order
    if (c.order) fromOrder(c.order)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** Productos del pedido: los propuestos y los agregados. */
const rows = computed(() => {
  const ids = [...new Set([...(order.value?.lines.map((l) => l.product) ?? []), ...added.value])]
  return ids.map((id) => {
    const l = lineOf(id)
    const p = catalog.physical.find((x) => x._id === id)
    const name = l?.name ?? p?.name ?? ''
    return { id, name, label: l?.containerLabel ?? p?.containerLabel ?? 'unidad', line: l, group: orderGroupOf(p?.category, l?.stockUnit ?? p?.stockUnit ?? '', name), shelf: p?.countOrder }
  })
})
/** Por categoría, en el orden del bar (licores, vinos, cervezas, gaseosas, insumos, frescos). */
const grouped = computed(() => groupByCategory(rows.value))
const weekText = computed(() => (order.value ? new Date(`${order.value.week}T12:00:00-06:00`).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', timeZone: 'Pacific/Galapagos' }).replace('.', '') : ''))
const addOptions = computed(() =>
  catalog.physical
    .filter((p) => !rows.value.some((r) => r.id === p._id))
    .map((p) => ({ value: p._id, label: p.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es')),
)
const toAdd = shallowRef('')
function addProduct(id: string) {
  if (!id) return
  added.value = [...added.value, id]
  entries.value[id] = { qty: 1, observation: '' }
  toAdd.value = ''
  touch()
}

const toOrder = computed(() => payload().filter((x) => x.qty > 0).length)
const changed = computed(() => rows.value.filter((r) => entry(r.id).qty !== (r.line?.suggested ?? 0)).length)
const missingReason = computed(() => rows.value.find((r) => needsReason(r.id) && !entry(r.id).observation.trim()))

async function send() {
  const o = order.value
  if (!o || busy.value) return
  if (missingReason.value) {
    toast.error(`${missingReason.value.name}: cambió más de ${OUTLIER_PCT} % lo propuesto, escribe el motivo`)
    return
  }
  if (!(await flush())) {
    toast.error(message.value || 'No se pudo guardar: revisa la señal y vuelve a intentar')
    return
  }
  const ok = await confirmStore.ask({
    title: '¿Enviar el pedido a la directora?',
    message: `${toOrder.value} producto(s) para pedir · ${changed.value} ajuste(s) tuyos. La directora lo aprueba hasta las 18h00.`,
    confirmLabel: 'Enviar a la directora',
    icon: 'fa-paper-plane',
  })
  if (!ok) return
  busy.value = true
  try {
    order.value = await apiSendWeeklyOrder(o._id, order.value!.version)
    orders.value = replaceOrder(orders.value, order.value)
    play('success')
    toast.success('Pedido enviado: ahora lo aprueba la directora')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

function received(o: WeeklyOrder) {
  orders.value = replaceOrder(orders.value, o)
  if (order.value?._id === o._id) order.value = o
  void catalog.load(true)
}

const unitOf = (label: string, n: number) => plural(label || 'unidad', n)
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(Math.round(n * 100) / 100).replace('.', ','))
</script>

<template>
  <div class="bar-stock">
    <SkeletonList v-if="loading" :rows="6" />
    <template v-else>
      <StockReceive
        v-for="r in toReceive"
        :key="r.delivery.key"
        :order="r.order"
        :delivery="r.delivery"
        @updated="received"
      />

      <section v-if="!order || !adjusting" class="card status" role="status">
        <i class="fa-solid" :class="order?.status === 'directora' ? 'fa-hourglass-half' : 'fa-circle-check'" aria-hidden="true" />
        <div>
          <h2 v-if="!order">Todavía no hay pedido esta semana</h2>
          <h2 v-else-if="order.status === 'directora'">Pedido enviado</h2>
          <h2 v-else-if="order.status === 'aprobado'">Pedido aprobado{{ order.autoApproved ? ' solo a las 18h00' : '' }}</h2>
          <h2 v-else>Pedido cerrado</h2>
          <p v-if="order?.status === 'directora'">La directora lo aprueba hasta las 18h00.</p>
          <p v-else-if="order?.status === 'aprobado' && !order.noNeeds">El jueves se compra en tierra; el viernes te aparece aquí para recibirlo.</p>
          <p v-if="current">El próximo pedido se propone el {{ dayText(current.nextCut) }} a las 12h00.</p>
        </div>
      </section>

      <template v-else>
        <header class="intro">
          <small class="eyebrow">Pedido · semana {{ weekText }}</small>
          <h2>Ajustar pedido · {{ order.code }}</h2>
          <p v-if="returnedBy" class="returned" role="status">
            <b>{{ returnedBy.byName }} te lo devolvió:</b> "{{ returnedBy.detail }}". Corrige y vuelve a enviarlo.
          </p>
          <p>
            La app propuso con el consumo por pasajero de los últimos 4 cruceros. Ajusta <b>PEDIR</b> hasta las
            {{ order.barDeadline ? formatHour(order.barDeadline).replace(':', 'h') : '15h00' }}: si cambias más de {{ OUTLIER_PCT }} %, escribe el motivo.
          </p>
        </header>

        <p v-if="!rows.length" class="card muted">Sin cruceros la semana siguiente (para o dique): la propuesta es 0. Agrega lo que haga falta.</p>

        <section v-for="g in grouped" :key="g.key" class="group" :aria-label="g.label">
          <h3>{{ g.label }} <small>{{ g.items.length }}</small></h3>
        <ul class="lines">
          <li v-for="r in g.items" :key="r.id" class="line" :class="{ 'line--ask': entry(r.id).qty > 0 }">
            <p class="line-head">
              <strong>{{ r.name }}</strong>
              <small v-if="r.line?.fridayStock !== null && r.line?.fridayStock !== undefined"> · stock vie {{ fmt(r.line.fridayStock) }}</small>
              <small v-else-if="r.group === 'fresco'"> (fresco)</small>
              <small v-else-if="!r.line"> · agregado</small>
            </p>
            <div class="line-ask">
              <span>Pedir</span>
              <QtyStepper
                :model-value="entry(r.id).qty"
                :min="0"
                allow-zero
                :unit="unitOf(r.label, entry(r.id).qty)"
                :label="`Pedir de ${r.name}`"
                @update:model-value="setQty(r.id, $event)"
              />
            </div>
            <small class="muted">Propuesto {{ r.line?.suggested ?? 0 }}</small>
            <div v-if="needsReason(r.id)" class="reason">
              <label :for="`reason-${r.id}`">Motivo (cambia más de {{ OUTLIER_PCT }} %)</label>
              <input
                :id="`reason-${r.id}`"
                :value="entry(r.id).observation"
                type="text"
                maxlength="200"
                placeholder="Viene grupo que pidió mojitos"
                @input="setReason(r.id, ($event.target as HTMLInputElement).value)"
              />
            </div>
          </li>
        </ul>
        </section>

        <div class="add">
          <BaseSelect :model-value="toAdd" :options="addOptions" searchable placeholder="Agregar un producto…" @update:model-value="addProduct" />
        </div>

        <footer class="send-bar">
          <p class="send-info">
            <span><b>{{ toOrder }}</b> para pedir · {{ changed }} ajuste(s)</span>
            <span v-if="sync !== 'idle'" class="sync" :class="`sync--${sync}`" role="status">
              {{ sync === 'error' ? message : SYNC_TEXT[sync] }}
              <button v-if="sync === 'error'" type="button" class="btn btn-text" @click="save">Reintentar</button>
            </span>
          </p>
          <button type="button" class="btn btn-primary btn-lg send" :disabled="busy" @click="send">
            <i class="fa-solid fa-paper-plane" aria-hidden="true" /> Enviar a la directora
          </button>
        </footer>
      </template>
    </template>
  </div>
</template>

<style scoped lang="scss">
.bar-stock {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-bottom: 6rem;
}

.status {
  display: flex;
  align-items: flex-start;
  gap: 0.9rem;

  > i {
    font-size: 1.6rem;
    color: var(--navy-600);
    margin-top: 0.2rem;
  }

  h2 {
    margin: 0 0 0.25rem;
    font-size: 1.3rem;
  }

  p {
    margin: 0.2rem 0 0;
    color: var(--ink-600);
  }
}

.intro {
  h2 {
    margin: 0 0 0.3rem;
    font-size: 1.35rem;
  }

  p {
    margin: 0;
    max-width: 62ch;
    color: var(--ink-600);
    line-height: 1.45;
  }
}

.muted {
  color: var(--ink-600);
}

.lines {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.line {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.8rem 0.9rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);

  &--ask {
    border-color: var(--navy-600);
  }
}

.returned {
  margin: 0.3rem 0 0.4rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius);
  background: var(--pill-warn-bg);
  color: var(--pill-warn-ink);
}

.eyebrow {
  display: block;
  margin-bottom: 0.15rem;
  color: var(--ink-600);
}

.group h3 {
  margin: 0.4rem 0 0.5rem;
  font-size: 1.05rem;
  color: var(--navy-900);

  small {
    font-weight: 500;
    color: var(--ink-600);
  }
}

.line-head {
  margin: 0;

  small {
    color: var(--ink-600);
  }
}

.line-ask {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  max-width: 420px;
}

.reason {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--warning-ink);
  }

  input {
    min-height: 44px;
    padding: 0 0.75rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    font-size: 1rem;
  }
}

.add {
  max-width: 420px;
}

.send-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
  border-top: 1px solid var(--line);
  background: var(--surface);
  box-shadow: 0 -6px 18px rgb(0 0 0 / 8%);
}

.send-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin: 0;
  color: var(--ink-600);
  font-size: 0.92rem;
}

.sync--error {
  color: var(--danger-ink);
}

.send {
  flex: 0 1 auto;
}
</style>
