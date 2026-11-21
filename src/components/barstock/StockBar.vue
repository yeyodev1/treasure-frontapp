<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import QtyStepper from '@/components/supply/QtyStepper.vue'
import StockReceive from '@/components/barstock/StockReceive.vue'
import { awaitingBar, dayText, loadOpenOrders, replaceOrder } from '@/components/barstock/orders'
import { CATEGORY_LABELS, useCatalogStore } from '@/stores/catalog'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { SYNC_TEXT, useOrderSync } from '@/composables/useOrderSync'
import { apiSendWeeklyOrder } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { normalize, plural } from '@/components/supply/units'
import type { Product, ProductCategory, WeeklyOrder, WeeklyOrderCurrent, WeeklyOrderLine } from '@/types'

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
const search = shallowRef('')

const { sync, message, touch, flush, save, draft } = useOrderSync(order, payload)

const counting = computed(() => order.value?.status === 'bar')
const toReceive = computed(() => orders.value.flatMap((o) => awaitingBar(o).map((d) => ({ order: o, delivery: d }))))

const ORDER_OF: ProductCategory[] = ['licor', 'vino', 'cerveza', 'gaseosa', 'agua', 'jugo', 'insumo', 'snack', 'otro']
/** Licores (y toda botella en ml: Baileys, Campari, vinos) se cuentan en cerradas + abierta (pedido del cliente). */
const isLiquor = (p: Product) => p.category === 'licor' || (p.stockUnit === 'ml' && /^botella/i.test(p.containerLabel || ''))
const OPEN_PARTS = [
  { value: 0, label: 'No hay' },
  { value: 0.25, label: '¼' },
  { value: 0.5, label: '½' },
  { value: 0.75, label: '¾' },
]

function lineOf(id: string): WeeklyOrderLine | undefined {
  return order.value?.lines.find((l) => l.product === id)
}

/** Lo que dice el sistema que hay a bordo, en envases (licores al ¼ más cercano). */
function systemCount(p: Product): number {
  const n = Math.max(0, (p.onboardStock ?? 0) / (p.containerSize || 1))
  return isLiquor(p) ? Math.round(n * 4) / 4 : Math.round(n)
}

const shown = (p: Product) => entries.value[p._id]?.counted ?? systemCount(p)
const closed = (p: Product) => Math.floor(shown(p) + 1e-9)
const openPart = (p: Product) => Math.round((shown(p) - closed(p)) * 4) / 4

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

const setClosed = (p: Product, n: number) => setCount(p, n + openPart(p))
const setOpen = (p: Product, part: number) => setCount(p, closed(p) + part)

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

const products = computed(() => {
  const q = normalize(search.value.trim())
  return catalog.physical.filter((p) => !q || normalize(p.name).includes(q))
})

const groups = computed(() => {
  const byCat = new Map<ProductCategory, Product[]>()
  for (const p of products.value) {
    const cat = ORDER_OF.includes(p.category) ? p.category : 'otro'
    byCat.set(cat, [...(byCat.get(cat) ?? []), p])
  }
  return ORDER_OF.filter((c) => byCat.has(c)).map((c) => ({
    category: c,
    label: CATEGORY_LABELS[c],
    items: byCat.get(c)!.sort((a, b) => a.name.localeCompare(b.name, 'es')),
  }))
})

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

        <label class="search">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input v-model="search" type="search" placeholder="Buscar bebida" aria-label="Buscar bebida" />
        </label>

        <p v-if="!groups.length" class="muted">Ninguna bebida coincide con «{{ search }}».</p>

        <section v-for="g in groups" :key="g.category" class="group" :aria-label="g.label">
          <h3 class="group-title">{{ g.label }} <small>{{ g.items.length }}</small></h3>
          <article
            v-for="p in g.items"
            :key="p._id"
            class="row"
            :class="{ 'row--counted': entries[p._id]?.counted != null, 'row--order': entry(p).qty > 0 }"
          >
            <div class="row-name">
              <ProductIcon :icon="p.icon || 'bottle'" :size="22" />
              <span>
                <strong>{{ p.name }}</strong>
                <small v-if="entries[p._id]?.counted == null" class="pending">
                  Sin contar · el sistema dice {{ systemCount(p) }}
                  <button type="button" class="ok" @click="setCount(p, systemCount(p))">
                    <i class="fa-solid fa-check" aria-hidden="true" /> Está bien
                  </button>
                </small>
                <small v-else class="done"><i class="fa-solid fa-circle-check" aria-hidden="true" /> Contado</small>
              </span>
            </div>

            <div class="field">
              <span class="field-label">TENGO</span>
              <template v-if="isLiquor(p)">
                <QtyStepper
                  :model-value="closed(p)"
                  :min="0"
                  allow-zero
                  unit="cerradas"
                  :label="`Botellas cerradas de ${p.name}`"
                  @update:model-value="setClosed(p, $event)"
                />
                <div class="open" role="radiogroup" :aria-label="`Botella abierta de ${p.name}`">
                  <span class="open-label">Abierta</span>
                  <button
                    v-for="o in OPEN_PARTS"
                    :key="o.value"
                    type="button"
                    role="radio"
                    :aria-checked="entries[p._id]?.counted != null && openPart(p) === o.value"
                    :class="{ on: entries[p._id]?.counted != null && openPart(p) === o.value }"
                    @click="setOpen(p, o.value)"
                  >
                    {{ o.label }}
                  </button>
                </div>
              </template>
              <QtyStepper
                v-else
                :model-value="shown(p)"
                :min="0"
                allow-zero
                :unit="unitOf(p, shown(p))"
                :label="`Cuántos tengo de ${p.name}`"
                @update:model-value="setCount(p, $event)"
              />
            </div>

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
          </article>
        </section>

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

.search {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0 0.9rem;
  min-height: 48px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-600);

  input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font-size: 1rem;
    color: var(--ink-900);
    outline: none;
  }

  &:focus-within {
    border-color: var(--navy-600);
    box-shadow: 0 0 0 3px var(--powder-200);
  }
}

.group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.group-title {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0.5rem 0 0;
  padding: 0.45rem 0;
  font-size: 1.05rem;
  background: var(--bg);

  small {
    font-weight: 400;
    color: var(--ink-400);
  }
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.5rem;
  padding: 0.8rem 1rem;
  border: 1px solid var(--line);
  border-left: 4px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);

  &--counted {
    border-left-color: var(--success-ink);
  }
}

.row-name {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 1 1 220px;
  min-width: 0;

  span {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  strong {
    color: var(--ink-900);
  }

  small {
    font-size: 0.82rem;
  }

  .pending {
    color: var(--ink-400);
  }

  .done {
    color: var(--success-ink);
    font-weight: 600;
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

.open {
  display: flex;
  align-items: center;
  gap: 0.3rem;

  button {
    min-width: 44px;
    min-height: 44px;
    padding: 0 0.6rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink-900);
    font-size: 0.95rem;
    cursor: pointer;

    &.on {
      background: var(--navy-700);
      border-color: var(--navy-700);
      color: #fff;
    }
  }
}

.open-label {
  font-size: 0.82rem;
  color: var(--ink-600);
}

.pending {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.6rem;
}

.ok {
  min-height: 40px;
  padding: 0 0.8rem;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-600);
  font-size: 0.9rem;
  cursor: pointer;

  &:hover {
    border-color: var(--success-ink);
    color: var(--ink-900);
  }
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
