<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import QtyStepper from '@/components/supply/QtyStepper.vue'
import StockReceive from '@/components/barstock/StockReceive.vue'
import CountList from '@/components/barstock/CountList.vue'
import { awaitingBar, dayText, loadOpenOrders, replaceOrder } from '@/components/barstock/orders'
import { useCatalogStore } from '@/stores/catalog'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { SYNC_TEXT, useOrderSync } from '@/composables/useOrderSync'
import { apiSendWeeklyOrder } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { plural } from '@/components/supply/units'
import type { Product, WeeklyOrder, WeeklyOrderCurrent, WeeklyOrderLine } from '@/types'

/**
 * BAR - STOCK, pantalla del bar (pedido del cliente, 19-nov-2026): todas las
 * bebidas por categoría con buscador y solo dos campos, TENGO y PEDIR. Pedir
 * se sugiere con lo que tengo y el stock objetivo; el bar lo puede cambiar.
 * Los licores se cuentan en botellas cerradas más la abierta. Un solo botón:
 * ENVIAR PEDIDO, que también guarda el conteo. Arriba, lo que hay que recibir.
 */
const catalog = useCatalogStore()
const confirmStore = useConfirmStore()
const toast = useToastStore()
const { play } = useSound()

interface Entry {
  /** Lo que el bar contó (envases; los licores admiten ¼, ½, ¾); null = no contó. */
  counted: number | null
  qty: number
  /** El bar cambió Pedir a mano: ya no se recalcula al contar. */
  qtyTouched: boolean
}

const current = shallowRef<WeeklyOrderCurrent | null>(null)
const orders = shallowRef<WeeklyOrder[]>([])
const order = shallowRef<WeeklyOrder | null>(null)
const entries = ref<Record<string, Entry>>({})
const loading = shallowRef(true)
const busy = shallowRef(false)

const { sync, message, touch, flush, save, draft } = useOrderSync(order, payload)

const counting = computed(() => order.value?.status === 'bar')
const toReceive = computed(() => orders.value.flatMap((o) => awaitingBar(o).map((d) => ({ order: o, delivery: d }))))

function lineOf(id: string): WeeklyOrderLine | undefined {
  return order.value?.lines.find((l) => l.product === id)
}

/** Cuánto pedir con lo que tengo: hasta el objetivo, o lo consumido la semana; null = sin referencia. */
function suggest(p: Product, counted: number): number | null {
  const size = p.containerSize || 1
  const l = lineOf(p._id)
  const up = (n: number) => Math.max(0, Math.ceil(Math.round(n * 100) / 100 - 1e-9))
  if (l?.basis === 'objetivo') return up(l.target - counted - l.incoming / size)
  if (l?.basis === 'consumo') return up((l.consumption - l.incoming) / size - counted)
  if ((p.stockTarget ?? 0) > 0) return up(p.stockTarget! - counted - (l?.incoming ?? 0) / size)
  return null
}

function entry(p: Product): Entry {
  return entries.value[p._id] ?? { counted: null, qty: lineOf(p._id)?.qty ?? 0, qtyTouched: false }
}

function setCount(p: Product, counted: number) {
  const e = entry(p)
  const s = e.qtyTouched ? null : suggest(p, counted)
  entries.value[p._id] = { ...e, counted, qty: s ?? e.qty }
  touch()
}

function setQty(p: Product, qty: number) {
  entries.value[p._id] = { ...entry(p), qty, qtyTouched: true }
  touch()
}

const counts = computed(() => Object.fromEntries(Object.entries(entries.value).map(([id, e]) => [id, e.counted])))
const toBuy = (p: Product) => entry(p).qty > 0

/** Lo que va al servidor: las líneas del pedido y todo lo que el bar contó o pidió. */
function payload() {
  const ids = new Set([...(order.value?.lines.map((l) => l.product) ?? []), ...Object.keys(entries.value)])
  return [...ids]
    .map((id) => {
      const e = entries.value[id]
      const l = lineOf(id)
      return { productId: id, qty: e?.qty ?? l?.qty ?? 0, observation: l?.observation ?? '', counted: e?.counted ?? l?.counted ?? null }
    })
    .filter((x) => lineOf(x.productId) || x.counted !== null || x.qty > 0)
}

function fromOrder(o: WeeklyOrder) {
  entries.value = Object.fromEntries(
    o.lines.map((l) => [l.product, { counted: l.counted ?? null, qty: l.qty, qtyTouched: l.counted !== null && l.qty !== l.suggested }]),
  )
  for (const d of draft() ?? []) {
    entries.value[d.productId] = { counted: d.counted, qty: d.qty, qtyTouched: true }
  }
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

const countedTotal = computed(() => catalog.physical.filter((p) => entries.value[p._id]?.counted != null).length)
const toOrder = computed(() => payload().filter((x) => x.qty > 0).length)

const unitOf = (p: Product, n: number) => plural(p.containerLabel || 'unidad', n)

async function send() {
  const o = order.value
  if (!o || busy.value) return
  if (!(await flush())) {
    toast.error(message.value || 'No se pudo guardar: revisa la señal y vuelve a intentar')
    return
  }
  const missing = catalog.physical.length - countedTotal.value
  const ok = await confirmStore.ask({
    title: '¿Enviar el pedido?',
    message: `${toOrder.value} producto(s) para pedir y ${countedTotal.value} contado(s).${
      missing > 0 ? ` ${missing} producto(s) sin contar se quedan con lo que dice el sistema.` : ''
    } La directora lo revisa y lo aprueba.`,
    confirmLabel: 'Enviar pedido',
    icon: 'fa-paper-plane',
  })
  if (!ok) return
  busy.value = true
  try {
    order.value = await apiSendWeeklyOrder(o._id, order.value!.version)
    orders.value = replaceOrder(orders.value, order.value)
    play('success')
    toast.success('Pedido enviado: ahora lo revisa la directora')
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

      <section v-if="!order || !counting" class="card status" role="status">
        <i class="fa-solid" :class="order?.status === 'directora' ? 'fa-hourglass-half' : 'fa-circle-check'" aria-hidden="true" />
        <div>
          <h2 v-if="!order">Todavía no hay pedido esta semana</h2>
          <h2 v-else-if="order.status === 'directora'">Pedido enviado</h2>
          <h2 v-else-if="order.status === 'aprobado'">Pedido aprobado</h2>
          <h2 v-else>Pedido cerrado</h2>
          <p v-if="order?.status === 'directora'">La directora lo está revisando.</p>
          <p v-else-if="order?.status === 'aprobado' && !order.noNeeds">Tierra lo compra y lo envía. Cuando llegue, te aparece aquí para recibirlo.</p>
          <p v-if="current">El próximo conteo y pedido se abre el {{ dayText(current.nextCut) }}.</p>
        </div>
      </section>

      <template v-else>
        <header class="intro">
          <h2>Inventario y pedido · {{ order.code }}</h2>
          <p>
            En <b>TENGO</b> pon lo que hay en el bar. En <b>PEDIR</b> el sistema sugiere cuánto pedir; cámbialo si hace falta.
            Al terminar toca <b>ENVIAR PEDIDO</b>.
          </p>
        </header>

        <CountList :products="catalog.physical" :counts="counts" :highlight="toBuy" @set="setCount">
          <template #extra="{ product: p }">
            <div class="field">
              <span class="field-label">PEDIR</span>
              <QtyStepper
                :model-value="entry(p).qty"
                :min="0"
                allow-zero
                :unit="unitOf(p, entry(p).qty)"
                :label="`Cuántos pedir de ${p.name}`"
                @update:model-value="setQty(p, $event)"
              />
            </div>
          </template>
        </CountList>

        <footer class="send-bar">
          <p class="send-info">
            <span><b>{{ countedTotal }}</b> de {{ catalog.physical.length }} contados · <b>{{ toOrder }}</b> para pedir</span>
            <span v-if="sync !== 'idle'" class="sync" :class="`sync--${sync}`" role="status">
              {{ sync === 'error' ? message : SYNC_TEXT[sync] }}
              <button v-if="sync === 'error'" type="button" class="btn btn-text" @click="save">Reintentar</button>
            </span>
          </p>
          <button type="button" class="btn btn-primary btn-lg send" :disabled="busy" @click="send">
            <i class="fa-solid fa-paper-plane" aria-hidden="true" /> ENVIAR PEDIDO
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

.field {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
}

.field-label {
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--navy-700);
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
