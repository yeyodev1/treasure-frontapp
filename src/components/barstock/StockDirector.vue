<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import QtyStepper from '@/components/supply/QtyStepper.vue'
import ProductPicker from '@/components/supply/ProductPicker.vue'
import { loadOpenOrders, replaceOrder } from '@/components/barstock/orders'
import { useCatalogStore } from '@/stores/catalog'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { SYNC_TEXT, useOrderSync } from '@/composables/useOrderSync'
import { apiApproveWeeklyOrder } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { containerText, plural } from '@/components/supply/units'
import { formatDateTime } from '@/utils/format'
import type { Product, WeeklyOrder, WeeklyOrderLine } from '@/types'

/**
 * BAR - STOCK, pantalla de la directora (pedido del cliente, 19-nov-2026):
 * los pedidos pendientes con lo que pidió el bar y lo que contó; sube, baja o
 * borra cualquier producto y aprueba con un solo botón. No se devuelve al bar.
 * Al aprobar pasa solo a Tierra. Debajo, cómo van los pedidos aprobados.
 */
const catalog = useCatalogStore()
const confirmStore = useConfirmStore()
const toast = useToastStore()
const { play } = useSound()

const orders = shallowRef<WeeklyOrder[]>([])
const order = shallowRef<WeeklyOrder | null>(null)
/** Cantidad por producto (envases enteros); lo que no está, se quitó. */
const qty = ref<Record<string, number>>({})
const loading = shallowRef(true)
const busy = shallowRef(false)
const picking = shallowRef(false)

const { sync, message, touch, flush, save } = useOrderSync(order, payload)

const pending = computed(() => orders.value.filter((o) => o.status === 'bar' || o.status === 'directora'))
const approved = computed(() => orders.value.filter((o) => o.status === 'aprobado' && !o.noNeeds))

function payload() {
  return (order.value?.lines ?? [])
    .filter((l) => l.product in qty.value)
    .map((l) => ({ productId: l.product, qty: qty.value[l.product] ?? 0, observation: l.observation, counted: l.counted ?? null }))
    .concat(
      Object.keys(qty.value)
        .filter((id) => !order.value?.lines.some((l) => l.product === id))
        .map((id) => ({ productId: id, qty: qty.value[id] ?? 0, observation: '', counted: null })),
    )
}

function open(o: WeeklyOrder | null) {
  order.value = o
  qty.value = Object.fromEntries((o?.lines ?? []).map((l) => [l.product, l.qty]))
}

async function load() {
  loading.value = true
  try {
    const [{ orders: list }] = await Promise.all([loadOpenOrders(), catalog.load(true)])
    orders.value = list
    open(list.find((o) => o.status === 'bar' || o.status === 'directora') ?? null)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** Primero lo que se pide; lo que quedó en cero va al final. */
const lines = computed(() =>
  (order.value?.lines ?? [])
    .filter((l) => l.product in qty.value)
    .sort((a, b) => Number((qty.value[b.product] ?? 0) > 0) - Number((qty.value[a.product] ?? 0) > 0) || a.name.localeCompare(b.name, 'es')),
)
const addedProducts = computed(() =>
  Object.keys(qty.value)
    .filter((id) => !order.value?.lines.some((l) => l.product === id))
    .map((id) => catalog.physical.find((p) => p._id === id))
    .filter((p): p is Product => Boolean(p)),
)
const withQty = computed(() => Object.values(qty.value).filter((n) => n > 0).length)

function setQty(id: string, n: number) {
  qty.value[id] = n
  touch()
}

function remove(id: string) {
  const next = { ...qty.value }
  delete next[id]
  qty.value = next
  play('tap')
  touch()
}

function add(p: Product) {
  if (!(p._id in qty.value)) qty.value = { ...qty.value, [p._id]: 1 }
  touch()
}

const iconOf = (id: string) => catalog.physical.find((p) => p._id === id)?.icon ?? 'bottle'
const has = (l: WeeklyOrderLine) =>
  l.counted != null
    ? `Contó ${containerText(l.counted, l)}`
    : `Sistema: ${containerText(Math.max(0, Math.round((l.atCut.abordo / (l.containerSize || 1)) * 4) / 4), l)}`

async function approve() {
  const o = order.value
  if (!o || busy.value) return
  if (!(await flush())) {
    toast.error(message.value || 'No se pudo guardar: vuelve a intentar')
    return
  }
  const none = withQty.value === 0
  const ok = await confirmStore.ask(
    none
      ? {
          title: '¿Cerrar sin pedido?',
          message: 'Todo está en cero: esta semana el barco no necesita nada. Queda en el historial.',
          confirmLabel: 'Cerrar sin pedido',
          icon: 'fa-circle-check',
        }
      : {
          title: `¿Aprobar el pedido ${o.code}?`,
          message: `${withQty.value} producto(s). Pasa a Tierra para comprar y enviar.${o.status === 'bar' ? ' El bar todavía no lo había enviado.' : ''}`,
          confirmLabel: 'Aprobar pedido',
          icon: 'fa-stamp',
        },
  )
  if (!ok) return
  busy.value = true
  try {
    const done = await apiApproveWeeklyOrder(o._id, order.value!.version, none)
    orders.value = replaceOrder(orders.value, done)
    open(orders.value.find((x) => x.status === 'bar' || x.status === 'directora') ?? null)
    play('success')
    toast.success(none ? 'Cerrado sin pedido' : 'Pedido aprobado: ya lo ve Tierra')
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

      <section v-if="!order" class="card vacio-card">
        <i class="fa-solid fa-circle-check" aria-hidden="true" />
        <p>No hay pedidos por aprobar.</p>
      </section>

      <template v-else>
        <header class="intro">
          <h2>
            Pedido {{ order.code }}
            <span class="estado estado--warn">{{ order.status === 'bar' ? 'El bar aún no lo envía' : 'Por aprobar' }}</span>
          </h2>
          <p>Sube, baja o borra lo que quieras y toca <b>APROBAR PEDIDO</b>. Pasa directo a Tierra.</p>
        </header>

        <section class="lines" aria-label="Productos del pedido">
          <article v-for="l in lines" :key="l.product" class="row" :class="{ 'row--zero': (qty[l.product] ?? 0) === 0 }">
            <div class="row-name">
              <ProductIcon :icon="iconOf(l.product)" :size="22" />
              <span>
                <strong>{{ l.name }}</strong>
                <small>{{ has(l) }}<template v-if="l.barQty !== null"> · el bar pidió {{ l.barQty }}</template></small>
              </span>
            </div>
            <QtyStepper
              :model-value="qty[l.product] ?? 0"
              :min="0"
              allow-zero
              :unit="plural(l.containerLabel || 'unidad', qty[l.product] ?? 0)"
              :label="`Cantidad de ${l.name}`"
              @update:model-value="setQty(l.product, $event)"
            />
            <button type="button" class="icon-btn danger" :aria-label="`Quitar ${l.name}`" @click="remove(l.product)">
              <i class="fa-solid fa-trash" aria-hidden="true" />
            </button>
          </article>
          <article v-for="p in addedProducts" :key="p._id" class="row">
            <div class="row-name">
              <ProductIcon :icon="p.icon || 'bottle'" :size="22" />
              <span><strong>{{ p.name }}</strong><small>Agregado por ti</small></span>
            </div>
            <QtyStepper
              :model-value="qty[p._id] ?? 0"
              :min="0"
              allow-zero
              :unit="plural(p.containerLabel || 'unidad', qty[p._id] ?? 0)"
              :label="`Cantidad de ${p.name}`"
              @update:model-value="setQty(p._id, $event)"
            />
            <button type="button" class="icon-btn danger" :aria-label="`Quitar ${p.name}`" @click="remove(p._id)">
              <i class="fa-solid fa-trash" aria-hidden="true" />
            </button>
          </article>
          <p v-if="!lines.length && !addedProducts.length" class="muted">El pedido está vacío.</p>
        </section>

        <div class="actions">
          <button type="button" class="btn btn-secondary" @click="picking = true">
            <i class="fa-solid fa-plus" aria-hidden="true" /> Agregar producto
          </button>
          <span v-if="sync !== 'idle'" class="sync" :class="`sync--${sync}`" role="status">
            {{ sync === 'error' ? message : SYNC_TEXT[sync] }}
            <button v-if="sync === 'error'" type="button" class="btn btn-text" @click="save">Reintentar</button>
          </span>
          <button type="button" class="btn btn-primary btn-lg approve" :disabled="busy" @click="approve">
            <i class="fa-solid fa-stamp" aria-hidden="true" /> {{ withQty ? 'APROBAR PEDIDO' : 'CERRAR SIN PEDIDO' }}
          </button>
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

    <ProductPicker
      v-if="picking"
      :products="catalog.physical"
      title="Agregar al pedido"
      show="abordo"
      :taken="Object.keys(qty)"
      @pick="add"
      @close="picking = false"
    />
  </div>
</template>

<style scoped lang="scss">
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

.lines {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 1.2rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);

  &--zero {
    opacity: 0.6;
  }
}

.row-name {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 1 1 240px;
  min-width: 0;

  span {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  small {
    color: var(--ink-600);
    font-size: 0.85rem;
  }
}

.icon-btn.danger {
  min-width: 44px;
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: transparent;
  color: var(--danger-ink);
  cursor: pointer;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 1rem;
}

.approve {
  margin-left: auto;
}

.sync--error {
  color: var(--danger-ink);
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
