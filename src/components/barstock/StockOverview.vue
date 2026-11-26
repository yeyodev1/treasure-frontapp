<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import StockControl from '@/components/barstock/StockControl.vue'
import { CATEGORY_LABELS, useCatalogStore } from '@/stores/catalog'
import { useToastStore } from '@/stores/toast'
import { apiCount, apiCounts, apiMovements, apiWeeklyOrderCurrent } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { baseText, normalize } from '@/components/supply/units'
import { formatDate, formatDateTime, formatNumber } from '@/utils/format'
import type { Product, StockCount, StockMovement, WeeklyOrderCurrent } from '@/types'

/**
 * BAR - STOCK, consulta de Gerencia (pedido del cliente, 19-nov-2026): cuánto
 * hay a bordo separando lo CONTADO (verificado) de lo CALCULADO con entradas y
 * consumos, la fecha del último conteo, lo que se está agotando, cómo van los
 * pedidos y los movimientos. El descuento automático aún no es del todo
 * confiable, por eso se muestran las dos cifras.
 */
const catalog = useCatalogStore()
const toast = useToastStore()

const counts = shallowRef<StockCount[]>([])
/** Último conteo de cada producto: lo contado (base) y cuándo. */
const lastCounted = shallowRef<Map<string, { physical: number; at: string }>>(new Map())
const current = shallowRef<WeeklyOrderCurrent | null>(null)
const movements = shallowRef<StockMovement[]>([])
const loading = shallowRef(true)
const search = shallowRef('')
const onlyLow = shallowRef(false)

async function load() {
  loading.value = true
  try {
    const [list, cur, mov] = await Promise.all([apiCounts(), apiWeeklyOrderCurrent(), apiMovements({ location: 'abordo', limit: 40 }), catalog.load(true)])
    counts.value = list.filter((c) => c.location === 'abordo' && c.status === 'aprobado')
    current.value = cur
    movements.value = mov.movements.filter((m) => m.type !== 'venta')
    // Los últimos conteos bastan para tener la fecha de cada producto contado.
    const full = await Promise.all(counts.value.slice(0, 6).map((c) => apiCount(c._id)))
    const map = new Map<string, { physical: number; at: string }>()
    for (const c of full) {
      for (const l of c.lines ?? []) {
        if (l.physical !== null && !map.has(l.product)) map.set(l.product, { physical: l.physical, at: c.reviewedAt ?? c.createdAt })
      }
    }
    lastCounted.value = map
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}
onMounted(load)

const size = (p: Product) => p.containerSize || 1
const env = (p: Product, base: number) => Math.round((base / size(p)) * 100) / 100
/** Se está agotando: bajo su alerta, o con menos de un cuarto de su objetivo. */
const isLow = (p: Product) =>
  (p.lowStockThreshold > 0 && p.onboardStock <= p.lowStockThreshold) ||
  ((p.stockTarget ?? 0) > 0 && p.onboardStock / size(p) <= (p.stockTarget ?? 0) / 4)
const isOut = (p: Product) => p.onboardStock <= 0
/** Nunca negativo (Bar-stock, 24-nov-2026): bajo cero se muestra 0 con su alerta. */
const isNegative = (p: Product) => p.onboardStock < -1e-9
const STATE = (p: Product) =>
  isNegative(p)
    ? { label: 'Falta registrar una recepción o un conteo', cls: 'estado--danger' }
    : isOut(p)
      ? { label: 'Sin stock', cls: 'estado--danger' }
      : isLow(p)
        ? { label: 'Se agota', cls: 'estado--warn' }
        : { label: 'Bien', cls: 'estado--ok' }
/** Frescos (menta, limón, azúcar…): se piden pero no llevan stock. */
const FRESH_UNITS = new Set(['ramita', 'rodaja', 'cucharadita', 'cucharada', 'gota', 'golpe', 'porción'])
const stocked = computed(() => catalog.physical.filter((p) => !p.fresh && !FRESH_UNITS.has(p.stockUnit) && !/clara de huevo|\(fruta\)/i.test(p.name)))

const products = computed(() => {
  const q = normalize(search.value.trim())
  return stocked.value
    .filter((p) => !q || normalize(p.name).includes(q))
    .filter((p) => !onlyLow.value || isLow(p) || isOut(p))
    .sort((a, b) => Number(isLow(b) || isOut(b)) - Number(isLow(a) || isOut(a)) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'es'))
})
const lowCount = computed(() => stocked.value.filter((p) => isLow(p) || isOut(p)).length)
const lastCount = computed(() => counts.value[0] ?? null)

/** Pedidos de las últimas semanas por estado. */
const byPhase = computed(() => {
  const all = [...(current.value?.order ? [current.value.order] : []), ...(current.value?.others ?? [])]
  const count = (f: (p: string) => boolean) => all.filter((o) => f(o.phase)).length
  return [
    { label: 'Solicitados', n: count((p) => p === 'bar' || p === 'directora') },
    { label: 'Aprobados', n: count((p) => p === 'atender') },
    { label: 'Enviados', n: count((p) => p === 'en_curso') },
    { label: 'Recibidos', n: count((p) => p === 'completo') },
  ]
})

const MOVE: Record<StockMovement['type'], string> = {
  carga: 'Llegó al barco',
  compra: 'Compra recibida',
  ajuste: 'Ajuste por conteo',
  merma: 'Merma',
  devolucion: 'Devolución',
  venta: 'Venta',
  migracion: 'Saldo inicial',
}
const n = (v: number) => formatNumber(v)
</script>

<template>
  <div class="overview">
    <SkeletonList v-if="loading" :rows="6" />
    <template v-else>
      <dl class="figures">
        <div>
          <dt>Último conteo físico</dt>
          <dd>{{ lastCount ? formatDate(lastCount.reviewedAt ?? lastCount.createdAt) : 'Sin conteo' }}</dd>
          <small v-if="lastCount">{{ lastCount.submittedBy?.name ?? lastCount.createdBy?.name }} · {{ lastCount.differences ?? 0 }} diferencia(s)</small>
        </div>
        <div>
          <dt>Se agotan o sin stock</dt>
          <dd :class="{ warn: lowCount > 0 }">{{ lowCount }}</dd>
          <small>producto(s)</small>
        </div>
        <div v-for="f in byPhase" :key="f.label">
          <dt>Pedidos {{ f.label.toLowerCase() }}</dt>
          <dd>{{ f.n }}</dd>
        </div>
      </dl>

      <section class="card" aria-label="Existencias a bordo">
        <header class="head">
          <h3>A bordo</h3>
          <label class="search">
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
            <input v-model="search" type="search" placeholder="Buscar" aria-label="Buscar bebida" />
          </label>
          <label class="toggle"><input v-model="onlyLow" type="checkbox" /> Solo lo que se agota</label>
        </header>
        <p class="muted">
          <b>Contado</b> es lo verificado en el último conteo del bar. <b>Calculado hoy</b> es ese conteo más lo que llegó menos lo
          que se consumió según el sistema: es una estimación.
        </p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col">Contado</th>
                <th scope="col">Calculado hoy</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in products" :key="p._id">
                <th scope="row">
                  {{ p.name }}
                  <small>{{ CATEGORY_LABELS[p.category] }}</small>
                </th>
                <td>
                  <template v-if="lastCounted.get(p._id)">
                    {{ n(env(p, lastCounted.get(p._id)!.physical)) }}
                    <small>{{ formatDate(lastCounted.get(p._id)!.at) }}</small>
                  </template>
                  <span v-else class="muted">Sin contar</span>
                </td>
                <td>{{ n(Math.max(0, env(p, p.onboardStock))) }} <small>{{ p.containerLabel }}</small></td>
                <td>
                  <span class="estado" :class="STATE(p).cls">{{ STATE(p).label }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card" aria-label="Movimientos y ajustes">
        <h3>Movimientos y ajustes a bordo</h3>
        <p v-if="!movements.length" class="muted">Sin movimientos recientes.</p>
        <ol v-else class="events">
          <li v-for="m in movements" :key="m._id">
            <span class="when">{{ formatDateTime(m.createdAt) }} · {{ m.user?.name }}</span>
            <span>
              <b>{{ MOVE[m.type] }}</b> · {{ m.product?.name }} {{ m.qty > 0 ? '+' : '' }}{{ baseText(m.qty, m.product?.stockUnit ?? 'unidad') }}
            </span>
            <small v-if="m.reason">{{ m.reason }}</small>
          </li>
        </ol>
      </section>

      <StockControl />
    </template>
  </div>
</template>

<style scoped lang="scss">
.overview {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

h3 {
  margin: 0;
  font-size: 1.1rem;
}

.figures {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 0;

  > div {
    flex: 1 1 150px;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.8rem 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  dt {
    font-size: 0.82rem;
    color: var(--ink-600);
  }

  dd {
    margin: 0;
    font-size: 1.4rem;
    font-weight: 700;
    color: var(--ink-900);
    font-variant-numeric: tabular-nums;

    &.warn {
      color: var(--warning-ink, var(--gold-600));
    }
  }

  small {
    color: var(--ink-400);
  }
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
  margin-bottom: 0.5rem;

  h3 {
    margin-right: auto;
  }
}

.search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 44px;
  padding: 0 0.7rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  color: var(--ink-600);

  input {
    border: 0;
    background: transparent;
    color: var(--ink-900);
    font-size: 1rem;
    outline: none;
    width: 10rem;
  }
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--ink-600);
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;

  th,
  td {
    padding: 0.55rem 0.6rem;
    border-bottom: 1px solid var(--line);
    text-align: right;
    vertical-align: top;
  }

  th:first-child {
    text-align: left;
  }

  thead th {
    font-size: 0.82rem;
    color: var(--ink-600);
  }

  small {
    display: block;
    font-weight: 400;
    font-size: 0.78rem;
    color: var(--ink-400);
  }

}

.events {
  list-style: none;
  margin: 0.6rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;

  li {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .when {
    font-size: 0.8rem;
    color: var(--ink-400);
  }

  small {
    color: var(--ink-600);
  }
}
</style>
