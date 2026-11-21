<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import QtyStepper from '@/components/supply/QtyStepper.vue'
import { awaitingBar, loadOpenOrders, replaceOrder } from '@/components/barstock/orders'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { useSound } from '@/composables/useSound'
import { apiFulfillWeeklyOrder } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { plural } from '@/components/supply/units'
import { formatDateTime } from '@/utils/format'
import type { DeliverySource, WeeklyOrder, WeeklyOrderLine } from '@/types'

/**
 * BAR - STOCK, pantalla de Tierra (pedido del cliente, 19-nov-2026): solo los
 * pedidos aprobados por la directora. Pone cuánto compró o tiene para
 * entregar (puede ser distinto de lo aprobado), el precio si lo compró, y
 * toca ENVIADO. El barco no suma nada hasta que el bar confirma la recepción.
 */
const confirmStore = useConfirmStore()
const toast = useToastStore()
const userStore = useUserStore()
const { play } = useSound()

interface Row {
  qty: number
  source: DeliverySource
  /** Precio por envase de lo comprado; vacío = sin precio. */
  cost: string
}

const orders = shallowRef<WeeklyOrder[]>([])
const rows = ref<Record<string, Row>>({})
const loading = shallowRef(true)
const busy = shallowRef(false)

/** La dueña envía desde Quito; Administración entrega desde la bodega de puerto. */
const kind = computed<'deliver' | 'ship'>(() => (userStore.role === 'duena' ? 'ship' : 'deliver'))
const STORE: Record<'deliver' | 'ship', { source: DeliverySource; label: string }> = {
  deliver: { source: 'puerto', label: 'Bodega de puerto' },
  ship: { source: 'quito', label: 'Bodega de Quito' },
}

const toSend = computed(() => orders.value.filter((o) => o.status === 'aprobado' && !o.noNeeds && o.lines.some((l) => l.pending > 0)))
const waiting = computed(() => orders.value.flatMap((o) => awaitingBar(o).map((d) => ({ order: o, delivery: d }))))

const rk = (o: WeeklyOrder, l: WeeklyOrderLine) => `${o._id}:${l.product}`
function reset(list: WeeklyOrder[]) {
  rows.value = Object.fromEntries(
    list.flatMap((o) => o.lines.filter((l) => l.pending > 0).map((l) => [rk(o, l), { qty: l.pending, source: 'compra' as DeliverySource, cost: '' }])),
  )
}

async function load() {
  loading.value = true
  try {
    orders.value = (await loadOpenOrders()).orders
    reset(orders.value)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}
onMounted(load)

const pendingLines = (o: WeeklyOrder) => o.lines.filter((l) => l.pending > 0)
const sending = (o: WeeklyOrder) => pendingLines(o).filter((l) => (rows.value[rk(o, l)]?.qty ?? 0) > 0)
const money = (s: string) => Number(String(s).replace(',', '.'))

async function send(o: WeeklyOrder) {
  if (busy.value) return
  const lines = sending(o)
  if (!lines.length) {
    toast.error('Pon cuánto envías de al menos un producto')
    return
  }
  const bad = lines.find((l) => {
    const c = rows.value[rk(o, l)]!.cost.trim()
    return c !== '' && !(money(c) >= 0)
  })
  if (bad) {
    toast.error(`${bad.name}: el precio debe ser un número`)
    return
  }
  const total = lines.reduce((s, l) => s + rows.value[rk(o, l)]!.qty, 0)
  const ok = await confirmStore.ask({
    title: `¿Marcar como ENVIADO el pedido ${o.code}?`,
    message: `${total} envase(s) de ${lines.length} producto(s). El inventario del barco sube cuando el bar confirme que lo recibió.`,
    confirmLabel: 'Enviado',
    icon: 'fa-truck-fast',
  })
  if (!ok) return
  busy.value = true
  try {
    const done = await apiFulfillWeeklyOrder(o._id, kind.value, {
      key: `${o._id}-${Date.now()}`,
      document: '',
      items: lines.map((l) => {
        const r = rows.value[rk(o, l)]!
        return { productId: l.product, source: r.source, qty: r.qty, cost: r.source === 'compra' && r.cost.trim() ? money(r.cost) : 0 }
      }),
    })
    orders.value = replaceOrder(orders.value, done)
    reset(orders.value)
    play('success')
    toast.success('Enviado: el bar lo confirma cuando llegue')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="land">
    <SkeletonList v-if="loading" :rows="5" />
    <template v-else>
      <section v-if="!toSend.length" class="card vacio-card">
        <i class="fa-solid fa-circle-check" aria-hidden="true" />
        <p>No hay pedidos aprobados por enviar.</p>
      </section>

      <section v-for="o in toSend" :key="o._id" class="card order" :aria-label="`Pedido ${o.code}`">
        <header>
          <h2>Pedido {{ o.code }} <span class="estado estado--warn">{{ o.phaseLabel }}</span></h2>
          <p class="muted">Pon cuánto envías de cada producto. Si lo compraste, pon el precio por envase (sirve para el costo del bar).</p>
        </header>

        <article v-for="l in pendingLines(o)" :key="l.product" class="row">
          <div class="row-name">
            <strong>{{ l.name }}</strong>
            <small>Aprobado {{ l.qty }} · falta enviar {{ l.pending }}</small>
          </div>
          <div class="field">
            <span class="field-label">ENVÍO</span>
            <QtyStepper
              v-model="rows[rk(o, l)]!.qty"
              :min="0"
              :max="l.pending"
              allow-zero
              :unit="plural(l.containerLabel || 'unidad', rows[rk(o, l)]!.qty)"
              :label="`Cuántos envías de ${l.name}`"
            />
          </div>
          <div class="field">
            <label class="src">
              <span class="field-label">SALE DE</span>
              <select v-model="rows[rk(o, l)]!.source" :aria-label="`De dónde sale ${l.name}`">
                <option value="compra">Compra nueva</option>
                <option :value="STORE[kind].source">{{ STORE[kind].label }}</option>
              </select>
            </label>
            <label v-if="rows[rk(o, l)]!.source === 'compra'" class="price">
              <span class="field-label">PRECIO</span>
              <span class="money">
                $
                <input
                  v-model="rows[rk(o, l)]!.cost"
                  type="text"
                  inputmode="decimal"
                  placeholder="por envase"
                  :aria-label="`Precio por envase de ${l.name}`"
                />
              </span>
            </label>
          </div>
        </article>

        <div class="actions">
          <button type="button" class="btn btn-primary btn-lg" :disabled="busy" @click="send(o)">
            <i class="fa-solid fa-truck-fast" aria-hidden="true" /> ENVIADO
          </button>
        </div>
      </section>

      <section v-if="waiting.length" class="card waiting" aria-label="Entregas por confirmar">
        <h3>Esperando que el bar confirme</h3>
        <ul>
          <li v-for="w in waiting" :key="w.delivery.key">
            <strong>{{ w.order.code }}</strong> · enviado por {{ w.delivery.byName }} el {{ formatDateTime(w.delivery.at) }}
            <small>{{ w.delivery.items.map((i) => `${i.name} ${i.qty}`).join(' · ') }}</small>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped lang="scss">
.land {
  display: flex;
  flex-direction: column;
  gap: 1rem;
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

.order {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;

  h2 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.2rem;
    font-size: 1.3rem;
  }

  p {
    margin: 0;
  }
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 1.2rem;
  padding: 0.75rem 0;
  border-top: 1px solid var(--line);
}

.row-name {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1 1 200px;

  small {
    color: var(--ink-600);
  }
}

.field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.8rem;
}

.field-label {
  white-space: nowrap;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--navy-700);
}

.src,
.price {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

select,
.money input {
  min-height: 44px;
  padding: 0 0.6rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-900);
  font-size: 1rem;
}

.money {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--ink-600);

  input {
    width: 7.5rem;
  }
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.waiting {
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

  small {
    display: block;
    color: var(--ink-600);
  }
}
</style>
