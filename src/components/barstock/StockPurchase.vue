<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from 'vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import QtyStepper from '@/components/supply/QtyStepper.vue'
import { loadOpenOrders } from '@/components/barstock/orders'
import { apiBarStockSettings, apiPurchaseWeeklyOrder, type BarStockSettings } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { useCatalogStore } from '@/stores/catalog'
import { useUserStore } from '@/stores/user'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'
import { plural } from '@/components/supply/units'
import { formatDateTime } from '@/utils/format'
import type { WeeklyOrder } from '@/types'

/**
 * Compra del jueves (Bar-stock, 24-nov-2026): el responsable de compras (por
 * defecto Administración; lo asigna Gerencia) registra solo cantidades, o «no
 * conseguido» / «reemplazado por…». Sin stock ni costos: los costos viven en
 * el Catálogo. Al terminar, «Enviar al barco»; el stock sube cuando el
 * bartender lo confirma el viernes. Se usa en el celular como lista de chequeo.
 */
const catalog = useCatalogStore()
const userStore = useUserStore()
const toast = useToastStore()
const confirmStore = useConfirmStore()
const { play } = useSound()

const orders = shallowRef<WeeklyOrder[]>([])
const settings = shallowRef<BarStockSettings | null>(null)
const loading = shallowRef(true)
const busy = shallowRef(false)

interface Row {
  qty: number
  status: 'comprado' | 'no_conseguido' | 'reemplazado'
  replacement: string
}
const rows = reactive<Record<string, Row>>({})

/** El pedido aprobado que falta comprar (lo pendiente de cada línea). */
const order = computed(() => orders.value.find((o) => o.status === 'aprobado' && !o.noNeeds && o.lines.some((l) => l.pending > 0)) ?? null)
const lines = computed(() => (order.value?.lines ?? []).filter((l) => l.pending > 0))
const isResponsible = computed(() => userStore.isOwner || settings.value?.purchaseResponsible?.id === userStore.user?.id)

const FRESH_UNITS = new Set(['ramita', 'rodaja', 'cucharadita', 'cucharada', 'gota', 'golpe', 'porción'])
const GROUPS = [
  { key: 'licor', label: 'Licores' },
  { key: 'vino', label: 'Vinos' },
  { key: 'cerveza', label: 'Cervezas' },
  { key: 'gaseosa', label: 'Gaseosas y agua' },
  { key: 'insumo', label: 'Insumos' },
  { key: 'fresco', label: 'Frescos' },
] as const
function groupOf(productId: string, stockUnit: string, name: string) {
  if (FRESH_UNITS.has(stockUnit) || /clara de huevo|\(fruta\)/i.test(name)) return 'fresco'
  const cat = catalog.physical.find((p) => p._id === productId)?.category ?? 'insumo'
  if (cat === 'licor' || /\(botella\)/i.test(name) && cat === 'insumo') return 'licor'
  if (cat === 'agua') return 'gaseosa'
  return (['vino', 'cerveza', 'gaseosa'] as const).includes(cat as 'vino') ? cat : 'insumo'
}
const grouped = computed(() =>
  GROUPS.map((g) => ({ ...g, items: lines.value.filter((l) => groupOf(l.product, l.stockUnit, l.name) === g.key) })).filter((g) => g.items.length),
)

async function load() {
  loading.value = true
  try {
    const [{ orders: list }, s] = await Promise.all([loadOpenOrders(), apiBarStockSettings(), catalog.load()])
    orders.value = list
    settings.value = s
    for (const l of lines.value) rows[l.product] = rows[l.product] ?? { qty: l.pending, status: 'comprado', replacement: '' }
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}
onMounted(load)

function setStatus(id: string, status: Row['status']) {
  rows[id] = { ...rows[id]!, status, qty: status === 'no_conseguido' ? 0 : rows[id]!.qty }
}

let key = crypto.randomUUID()
async function send() {
  const o = order.value
  if (!o || busy.value) return
  const missing = lines.value.find((l) => rows[l.product]?.status === 'reemplazado' && !rows[l.product]!.replacement.trim())
  if (missing) {
    toast.error(`${missing.name}: ¿reemplazado por qué?`)
    return
  }
  const items = lines.value.map((l) => ({ productId: l.product, qty: rows[l.product]?.qty ?? 0, status: rows[l.product]?.status ?? 'comprado', replacement: rows[l.product]?.replacement ?? '' }))
  const bought = items.filter((i) => i.qty > 0).length
  const ok = await confirmStore.ask({
    title: '¿Enviar al barco?',
    message: `${bought} producto(s) comprado(s)${items.length - bought ? ` · ${items.length - bought} no conseguido(s)` : ''}. El stock sube cuando el bartender lo confirma.`,
    confirmLabel: 'Enviar al barco',
    icon: 'fa-ship',
  })
  if (!ok) return
  busy.value = true
  try {
    await apiPurchaseWeeklyOrder(o._id, key, items)
    key = crypto.randomUUID()
    play('success')
    toast.success('Enviado al barco')
    await load()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

const printList = () => window.print()
const unit = (label: string, n: number) => plural(label || 'unidad', n)
</script>

<template>
  <section class="purchase">
    <SkeletonList v-if="loading" :rows="6" />
    <template v-else>
      <p v-if="!isResponsible" class="card muted">
        Esta semana compra <strong>{{ settings?.purchaseResponsible?.name ?? 'el responsable de compras' }}</strong>.
      </p>
      <p v-else-if="!order" class="card muted">
        No hay pedido aprobado por comprar. Llega al aprobarse el miércoles (a más tardar a las 18h00).
      </p>
      <template v-else>
        <header class="head">
          <div>
            <h2>Registrar compra · {{ order.code }}</h2>
            <p class="muted">
              Aprobado{{ order.autoApproved ? ' solo a las 18h00' : '' }}. Solo cantidades: no se piden costos.
              <template v-if="order.sentAt"> Ya se envió una parte el {{ formatDateTime(order.sentAt) }}.</template>
            </p>
          </div>
          <button type="button" class="btn btn-secondary no-print" @click="printList">
            <i class="fa-solid fa-file-pdf" aria-hidden="true" /> Descargar PDF
          </button>
        </header>

        <section v-for="g in grouped" :key="g.key" class="group">
          <h3>{{ g.label }}</h3>
          <ul class="items">
            <li v-for="l in g.items" :key="l.product" class="item" :class="{ 'item--off': rows[l.product]?.status === 'no_conseguido' }">
              <p class="item-name">
                <strong>{{ l.name }}</strong> <small>pedido {{ l.pending }} {{ unit(l.containerLabel, l.pending) }}</small>
              </p>
              <QtyStepper
                v-if="rows[l.product] && rows[l.product]!.status !== 'no_conseguido'"
                v-model="rows[l.product]!.qty"
                :min="0"
                :max="l.pending"
                allow-zero
                :label="`Comprado de ${l.name}`"
                class="no-print"
              />
              <div class="seg no-print" role="radiogroup" :aria-label="`Estado de ${l.name}`">
                <button type="button" role="radio" :aria-checked="rows[l.product]?.status === 'no_conseguido'" :class="{ on: rows[l.product]?.status === 'no_conseguido' }" @click="setStatus(l.product, rows[l.product]?.status === 'no_conseguido' ? 'comprado' : 'no_conseguido')">
                  No conseguido
                </button>
                <button type="button" role="radio" :aria-checked="rows[l.product]?.status === 'reemplazado'" :class="{ on: rows[l.product]?.status === 'reemplazado' }" @click="setStatus(l.product, rows[l.product]?.status === 'reemplazado' ? 'comprado' : 'reemplazado')">
                  Reemplazado por…
                </button>
              </div>
              <input
                v-if="rows[l.product]?.status === 'reemplazado'"
                v-model="rows[l.product]!.replacement"
                type="text"
                maxlength="120"
                class="replace no-print"
                :aria-label="`Reemplazo de ${l.name}`"
                placeholder="Ej.: Bacardi Blanco por Havana 3"
              />
            </li>
          </ul>
        </section>

        <button type="button" class="btn btn-primary btn-lg send no-print" :disabled="busy" @click="send">
          <i class="fa-solid" :class="busy ? 'fa-spinner fa-spin' : 'fa-ship'" aria-hidden="true" /> Enviar al barco
        </button>
      </template>
    </template>
  </section>
</template>

<style scoped lang="scss">
.purchase {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.muted {
  margin: 0;
  color: var(--ink-600);
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.5rem 1rem;

  h2 {
    margin: 0 0 0.2rem;
    font-size: 1.3rem;
  }
}

.group h3 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
  color: var(--navy-900);
}

.items {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);

  &--off {
    opacity: 0.7;
  }
}

.item-name {
  margin: 0;

  small {
    color: var(--ink-600);
  }
}

.seg {
  display: flex;
  gap: 0.4rem;

  button {
    flex: 1 1 0;
    min-height: 44px;
    border: 1.5px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-weight: 600;
    color: var(--navy-800);

    &.on {
      border-color: var(--navy-800);
      background: var(--navy-800);
      color: #fff;
    }
  }
}

.replace {
  min-height: 44px;
  padding: 0 0.75rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  font-size: 1rem;
}

.send {
  align-self: flex-end;
}

@media print {
  .no-print {
    display: none !important;
  }
}
</style>
