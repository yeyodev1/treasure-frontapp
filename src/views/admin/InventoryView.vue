<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useCatalogStore } from '@/stores/catalog'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { useConfirmStore } from '@/stores/confirm'
import { useInfiniteScroll } from '@/composables/useInfiniteScroll'
import { useSound } from '@/composables/useSound'
import { apiAdjustStock, apiCloseUnsplit, apiMovements, apiStock } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime, formatMoney, formatNumber, formatStock, unitShort } from '@/utils/format'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import { ALL_LOCATIONS, ACTIVE_LOCATIONS, costText, LOCATION_LABEL, stockText } from '@/components/supply/units'
import type { Product, StockItem, StockLocation, StockMovement } from '@/types'

/**
 * Existencias (pestaña de Inventario y pedidos, 4-nov-2026): cada producto con
 * sus cantidades en Quito, Puerto y A bordo, búsqueda, filtros e historial por
 * producto. El costo solo lo ven Gerencia, Administración y Bodega.
 */
type Tab = 'existencias' | 'bitacora'
type Filter = 'todas' | 'alertas' | StockLocation

const catalogStore = useCatalogStore()
const toast = useToastStore()
const userStore = useUserStore()
const confirmStore = useConfirmStore()
const { play } = useSound()

const route = useRoute()
const tab = shallowRef<Tab>(route.query.tab === 'bitacora' ? 'bitacora' : 'existencias')
const stock = shallowRef<StockItem[]>([])
const movements = ref<StockMovement[]>([])
const movementsHasMore = shallowRef(false)
const loading = shallowRef(true)
const loadingMore = shallowRef(false)
const query = shallowRef('')
const filter = shallowRef<Filter>('todas')
// Pestañas «Bodega de puerto» / «Bodega de Quito» abren esta vista con ?ubicacion= (guía 4 perfiles).
watch(
  () => route.query.ubicacion,
  (loc) => {
    filter.value = loc === 'quito' || loc === 'puerto' || loc === 'abordo' ? loc : 'todas'
  },
  { immediate: true },
)
const sentinel = shallowRef<HTMLElement | null>(null)
/** Historial de un solo producto (se abre desde su fila). */
const historyOf = shallowRef<Product | null>(null)

const showAdjust = shallowRef(false)
const saving = shallowRef(false)
const form = reactive({
  productId: '',
  qty: 1,
  mode: 'envases' as 'envases' | 'base',
  reason: '',
  location: 'abordo' as StockLocation,
})

const canSeeCosts = computed(() => userStore.isWarehouse)

const MOVEMENT_LABELS: Record<StockMovement['type'], string> = {
  carga: 'Traslado',
  venta: 'Consumo',
  merma: 'Merma',
  ajuste: 'Ajuste',
  compra: 'Compra',
  devolucion: 'Devolución',
  migracion: 'Saldo inicial',
}

/** "Bodega sin separar" solo se muestra mientras tenga saldo. */
const hasUnsplit = computed(() => stock.value.some((s) => s.byLocation.bodega !== 0))
const columns = computed<StockLocation[]>(() => (hasUnsplit.value ? ALL_LOCATIONS : ACTIVE_LOCATIONS))

const locationOptions = computed(() => columns.value.map((l) => ({ value: l, label: LOCATION_LABEL[l] })))

/** Elegida una bodega, la tabla muestra solo esa columna (en tablet no caben todas, 4-nov-2026). */
const shownColumns = computed<StockLocation[]>(() =>
  (columns.value as string[]).includes(filter.value) ? [filter.value as StockLocation] : columns.value,
)
/** Tarjetas de arriba: cuántos productos tiene cada bodega. */
const places = computed(() =>
  columns.value.map((l) => ({ id: l, label: LOCATION_LABEL[l], count: stock.value.filter((s) => s.byLocation[l] > 0).length })),
)

const physicalOptions = computed(() =>
  catalogStore.physical.map((p) => ({ value: p._id, label: p.name, hint: unitShort(p.stockUnit) })),
)
const selectedProduct = computed<Product | null>(
  () => catalogStore.physical.find((p) => p._id === form.productId) ?? null,
)
const baseQty = computed(() => {
  const p = selectedProduct.value
  if (!p) return 0
  return form.mode === 'envases' ? form.qty * (p.containerSize || 1) : form.qty
})

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const negativeIn = (s: StockItem) => columns.value.some((l) => s.byLocation[l] < 0)
const totalOf = (s: StockItem) => columns.value.reduce((sum, l) => sum + s.byLocation[l], 0)

const visibleStock = computed(() => {
  const q = normalize(query.value.trim())
  return stock.value.filter((s) => {
    if (q && !normalize(s.product.name).includes(q)) return false
    if (filter.value === 'alertas') return negativeIn(s) || s.low
    if (filter.value !== 'todas') return s.byLocation[filter.value] !== 0
    return true
  })
})

const alerts = computed(() => stock.value.filter((s) => negativeIn(s) || s.low).length)
const negatives = computed(() => stock.value.filter(negativeIn).length)

async function loadStock() {
  loading.value = true
  try {
    // Cada ítem trae todas las ubicaciones; "low" se mide a bordo.
    stock.value = await apiStock('abordo')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

async function loadMovements() {
  loading.value = true
  try {
    const data = await apiMovements({ productId: historyOf.value?._id })
    movements.value = data.movements
    movementsHasMore.value = data.hasMore
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

async function loadMoreMovements() {
  if (loadingMore.value || !movementsHasMore.value) return
  const last = movements.value[movements.value.length - 1]
  if (!last) return
  loadingMore.value = true
  try {
    const data = await apiMovements({ before: last.createdAt, productId: historyOf.value?._id })
    movements.value = [...movements.value, ...data.movements]
    movementsHasMore.value = data.hasMore
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loadingMore.value = false
  }
}

useInfiniteScroll({ sentinel, onReach: loadMoreMovements })

function refreshTab() {
  return tab.value === 'existencias' ? loadStock() : loadMovements()
}

watch(tab, refreshTab)
watch(historyOf, () => {
  if (tab.value === 'bitacora') void loadMovements()
})

onMounted(async () => {
  await catalogStore.load(true)
  await refreshTab()
})

function openHistory(p: Product) {
  historyOf.value = p
  tab.value = 'bitacora'
  play('tap')
}

function openAdjust() {
  Object.assign(form, { productId: '', qty: 1, mode: 'envases', reason: '', location: 'abordo' })
  showAdjust.value = true
}

async function submitAdjust() {
  const p = selectedProduct.value
  if (!p || !form.qty) {
    toast.error('Elige el producto y la cantidad')
    return
  }
  if (!form.reason.trim()) {
    toast.error('El ajuste necesita un motivo')
    return
  }
  if (!userStore.isOwner) return
  const amount = `${formatStock(Math.abs(baseQty.value), p.stockUnit, p.containerSize, p.containerLabel)}`
  const ok = await confirmStore.ask({
    title: '¿Registrar ajuste manual?',
    message: `${p.name} (${LOCATION_LABEL[form.location]}): ${baseQty.value < 0 ? '−' : '+'}${amount}. Motivo: ${form.reason.trim()}.`,
    confirmLabel: 'Registrar ajuste',
    danger: baseQty.value < 0,
    icon: 'fa-sliders',
  })
  if (!ok) return

  saving.value = true
  try {
    await apiAdjustStock({ productId: p._id, qty: baseQty.value, reason: form.reason.trim(), location: form.location })
    play('success')
    toast.success('Movimiento registrado en la bitácora')
    showAdjust.value = false
    await refreshTab()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}

/** Gerencia cierra el saldo sin separar cuando Quito y Puerto ya se contaron. */
async function closeUnsplit() {
  const ok = await confirmStore.ask({
    title: '¿Cerrar el saldo de la bodega sin separar?',
    message:
      'Úsalo después de aprobar un conteo físico de Quito y otro de Puerto: lo que hay en cada lugar ya entró con esos conteos. El saldo anterior se lleva a cero con un ajuste por producto que queda en la bitácora.',
    confirmLabel: 'Cerrar saldo sin separar',
    danger: true,
    icon: 'fa-warehouse',
  })
  if (!ok) return
  try {
    const result = await apiCloseUnsplit()
    play('success')
    toast.success(`Saldo sin separar cerrado: ${result.closed} producto(s)`)
    await loadStock()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  }
}

const TAB_META: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'existencias', label: 'Existencias', icon: 'fa-boxes-stacked' },
  { id: 'bitacora', label: 'Historial', icon: 'fa-clock-rotate-left' },
]
const FILTERS = computed<Array<{ id: Filter; label: string }>>(() => [
  { id: 'todas', label: 'Todas' },
  ...columns.value.map((l) => ({ id: l as Filter, label: `Con saldo: ${LOCATION_LABEL[l]}` })),
  { id: 'alertas', label: `Alertas${alerts.value ? ` (${alerts.value})` : ''}` },
])
</script>

<template>
  <div class="page inv">
    <header class="page-head">
      <div class="page-head-text">
        <h1 class="page-title">Existencias</h1>
        <p class="page-lead">Cantidades por ubicación. Los licores se miden en ml: cada trago descuenta su medida.</p>
      </div>
      <div class="page-actions">
        <button v-if="userStore.isOwner" type="button" class="btn btn-secondary" @click="openAdjust">
          <i class="fa-solid fa-sliders" aria-hidden="true" /> Ajuste manual
        </button>
      </div>
    </header>

    <div class="segs inv-tabs" role="tablist" aria-label="Vista de existencias">
      <button
        v-for="t in TAB_META"
        :key="t.id"
        type="button"
        role="tab"
        class="segs-item"
        :class="{ 'segs-item--on': tab === t.id }"
        :aria-selected="tab === t.id"
        @click="tab = t.id"
      >
        <i class="fa-solid" :class="t.icon" aria-hidden="true" /> {{ t.label }}
      </button>
    </div>

    <!-- Saldo anterior sin separar: se reparte con conteos, no por suposición -->
    <p v-if="hasUnsplit && tab === 'existencias'" class="needs-count">
      <i class="fa-solid fa-warehouse" aria-hidden="true" />
      <span>
        <strong>Tu bodega todavía no está separada en Quito y Puerto.</strong>
        Lo que había en bodega está junto en «Bodega sin separar» (por eso Quito y Puerto salen en 0). Para separarlo:
        en <strong>Conteos</strong> cuenta la Bodega Quito y la Bodega Puerto; al aprobar cada conteo, esa bodega queda con lo
        contado. Cuando ambos estén aprobados, Gerencia cierra el saldo sin separar.
        <button v-if="userStore.isOwner" type="button" class="link-btn btn btn-secondary" @click="closeUnsplit">
          Cerrar saldo sin separar
        </button>
      </span>
    </p>

    <p v-if="negatives && tab === 'existencias'" class="needs-count">
      <i class="fa-solid fa-clipboard-question" aria-hidden="true" />
      <span>
        <strong>{{ negatives === 1 ? '1 producto tiene' : `${negatives} productos tienen` }} saldo bajo cero:
          requiere conteo físico.</strong>
        No se corrige solo; el ajuste se aplica cuando se aprueba el conteo.
      </span>
    </p>

    <!-- Bodegas: toca una para ver solo lo que tiene -->
    <div v-if="tab === 'existencias' && !loading" class="places" role="radiogroup" aria-label="Ver bodega">
      <button
        type="button"
        role="radio"
        class="place"
        :class="{ 'place--on': shownColumns.length > 1 }"
        :aria-checked="shownColumns.length > 1"
        @click="filter = 'todas'"
      >
        <strong>Todas</strong>
        <small>{{ stock.length }} productos</small>
      </button>
      <button
        v-for="p in places"
        :key="p.id"
        type="button"
        role="radio"
        class="place"
        :class="{ 'place--on': filter === p.id }"
        :aria-checked="filter === p.id"
        @click="filter = p.id"
      >
        <strong>{{ p.label }}</strong>
        <small>{{ p.count }} {{ p.count === 1 ? 'producto' : 'productos' }} con stock</small>
      </button>
    </div>

    <!-- Existencias por ubicación -->
    <section v-if="tab === 'existencias'" class="card table-card">
      <div class="tools">
        <label class="search">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input v-model="query" type="search" placeholder="Buscar producto" aria-label="Buscar producto" />
        </label>
        <BaseSelect
          :model-value="filter"
          :options="FILTERS.map((f) => ({ value: f.id, label: f.label }))"
          aria-label="Filtrar"
          @update:model-value="filter = $event as Filter"
        />
      </div>

      <SkeletonList v-if="loading" variant="row" :rows="8" />
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Producto</th>
              <th v-for="l in shownColumns" :key="l" class="num">{{ LOCATION_LABEL[l] }}</th>
              <th class="num">Total</th>
              <th v-if="canSeeCosts" class="col-cost">Costo</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in visibleStock"
              :key="item.product._id"
              :class="{ negative: negativeIn(item), low: item.low && !negativeIn(item) }"
            >
              <td>
                <button type="button" class="prod prod-btn" :aria-label="`Historial de ${item.product.name}`" @click="openHistory(item.product)">
                  <ProductIcon :icon="item.product.icon" :size="20" />
                  <span class="prod-text">
                    <span class="prod-name">{{ item.product.name }}</span>
                    <small v-if="canSeeCosts" class="prod-cost">
                      {{ costText(item.product.costPerUnit, item.product) || 'Falta registrar costo' }}
                    </small>
                    <small class="prod-cost prod-cost--always">
                      <i class="fa-solid fa-clock-rotate-left" aria-hidden="true" /> Historial
                    </small>
                  </span>
                </button>
              </td>
              <td v-for="l in shownColumns" :key="l" class="num" :data-label="LOCATION_LABEL[l]">
                <template v-if="item.byLocation[l] < 0">
                  <span class="pill pill--neg">Requiere conteo</span>
                  <small class="sys">Sistema: {{ formatNumber(item.byLocation[l]) }} {{ unitShort(item.product.stockUnit) }}</small>
                </template>
                <template v-else>
                  <strong :class="{ zero: item.byLocation[l] === 0 }">{{ stockText(item.byLocation[l], item.product) }}</strong>
                  <span v-if="l === 'abordo' && item.low" class="pill pill--low">Bajo</span>
                </template>
              </td>
              <td class="num"><strong>{{ stockText(totalOf(item), item.product) }}</strong></td>
              <td v-if="canSeeCosts" class="muted col-cost">
                {{ costText(item.product.costPerUnit, item.product) || 'Falta registrar costo' }}
              </td>
            </tr>
            <tr v-if="!visibleStock.length">
              <td :colspan="shownColumns.length + (canSeeCosts ? 3 : 2)" class="empty">
                {{ filter === 'alertas' ? 'Sin alertas: todo con stock suficiente.' : 'Ningún producto con ese filtro.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Historial (bitácora) -->
    <section v-else class="card table-card">
      <p v-if="historyOf" class="history-of">
        <span>Historial de <strong>{{ historyOf.name }}</strong></span>
        <button type="button" class="btn btn-secondary link-btn" @click="historyOf = null">
          <i class="fa-solid fa-xmark" aria-hidden="true" /> Ver todos los productos
        </button>
      </p>
      <SkeletonList v-if="loading" variant="row" :rows="8" />
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Producto</th>
              <th>Dónde</th>
              <th class="num">Cantidad</th>
              <th>Persona</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in movements" :key="m._id">
              <td class="nowrap">{{ formatDateTime(m.createdAt) }}</td>
              <td><span class="pill" :class="`pill--${m.type}`">{{ MOVEMENT_LABELS[m.type] }}</span></td>
              <td>{{ m.product?.name }}</td>
              <td>{{ LOCATION_LABEL[m.location] ?? m.location }}</td>
              <td class="num" :class="{ neg: m.qty < 0 }">
                {{ m.qty > 0 ? '+' : '' }}{{ formatNumber(m.qty) }} {{ m.legacy ? 'u (antiguo)' : unitShort(m.product?.stockUnit ?? '') }}
              </td>
              <td>{{ m.user?.name }}</td>
              <td class="muted">
                {{ m.reason }}
                <template v-if="m.supplier"> · {{ m.supplier }} · Doc. {{ m.document }}</template>
                <template v-if="m.unitCost && canSeeCosts"> · {{ formatMoney(m.unitCost) }} c/u</template>
              </td>
            </tr>
            <tr v-if="!movements.length">
              <td colspan="7" class="empty">Sin movimientos.</td>
            </tr>
          </tbody>
        </table>
        <div v-if="movementsHasMore" ref="sentinel" class="sentinel">
          <BaseSpinner v-if="loadingMore" label="Cargando más movimientos…" />
        </div>
      </div>
    </section>

    <!-- Ajuste manual (solo Gerencia) -->
    <BaseModal v-if="showAdjust && userStore.isOwner" title="Ajuste manual de inventario" @close="showAdjust = false">
      <div class="modal-form">
        <div class="field">
          <label>Producto</label>
          <BaseSelect v-model="form.productId" :options="physicalOptions" placeholder="Buscar producto…" searchable />
        </div>

        <p class="count-intro">
          Solo Gerencia registra ajustes manuales. Para diferencias de un conteo, usa Conteos: el ajuste queda con su corte.
        </p>

        <div class="field">
          <label for="mv-qty">
            Cantidad (positiva suma, negativa resta)
          </label>
          <div class="qty-row">
            <input id="mv-qty" v-model.number="form.qty" type="number" step="any" />
            <div v-if="selectedProduct && selectedProduct.containerSize > 1" class="unit-seg">
              <button type="button" :class="{ on: form.mode === 'envases' }" @click="form.mode = 'envases'">
                {{ selectedProduct.containerLabel }}s
              </button>
              <button type="button" :class="{ on: form.mode === 'base' }" @click="form.mode = 'base'">
                {{ unitShort(selectedProduct.stockUnit) }}
              </button>
            </div>
            <span v-else-if="selectedProduct" class="unit">{{ unitShort(selectedProduct.stockUnit) }}</span>
          </div>
          <small v-if="selectedProduct" class="equiv">
            = {{ formatStock(baseQty, selectedProduct.stockUnit, selectedProduct.containerSize, selectedProduct.containerLabel) }}
          </small>
        </div>

        <div class="field">
          <label>Ubicación</label>
          <BaseSelect
            v-model="form.location"
            :options="locationOptions"
          />
        </div>

        <div class="field">
          <label for="mv-reason">Motivo (obligatorio)</label>
          <input id="mv-reason" v-model="form.reason" type="text" placeholder="Ej. corrección autorizada tras revisión" />
        </div>

        <button type="button" class="btn btn-primary btn-lg" :disabled="saving" @click="submitAdjust">
          <i class="fa-solid fa-check" aria-hidden="true" /> {{ saving ? 'Guardando…' : 'Registrar ajuste' }}
        </button>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.inv {
  max-width: 1180px;
}

.inv-tabs {
  margin-bottom: 0.85rem;
}




.table-card {
  padding: 0.75rem;

  @include tablet {
    padding: 1rem 1.1rem;
  }
}

.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.search {
  flex: 1 1 240px;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-height: 48px;
  padding: 0 0.95rem;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  color: var(--ink-400);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &:focus-within {
    border-color: var(--navy-600);
    box-shadow: var(--focus-ring);
  }

  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 1rem;
    color: var(--ink-900);
  }
}



.table-wrap {
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 1rem;

  th {
    text-align: left;
    font-size: 0.88rem;
    font-weight: 500;
    color: var(--ink-400);
    padding: 0.65rem 0.6rem;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }

  td {
    padding: 0.7rem 0.6rem;
    border-bottom: 1px solid var(--rule);
    vertical-align: middle;
  }

  tbody tr {
    transition: background-color 0.15s ease;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tr.negative td {
    background: #fbf0ee;
  }

  tr.low td {
    background: #fbf6ee;
  }
}

.num {
  text-align: right !important;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;

  @media (max-width: 639px) {
    white-space: normal;
  }

  .pill {
    margin-left: 0.5rem;
  }
}

.nowrap {
  white-space: nowrap;
}

.prod-btn {
  width: 100%;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
  color: inherit;

  &:hover .prod-name {
    text-decoration: underline;
  }
}

.prod-cost--always {
  display: inline-flex !important;
  gap: 0.3rem;
  align-items: center;
  color: var(--navy-700);
}

.history-of {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0 0 0.75rem;
}

.prod {
  display: flex;
  align-items: center;
  gap: 0.6rem;

  @include tablet {
    min-width: 200px;
  }

  svg {
    color: var(--navy-700);
    flex-shrink: 0;
  }
}

.prod-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.prod-name {
  font-weight: 600;
}

// En celular el costo baja como segunda línea bajo el nombre.
.prod-cost {
  font-size: 0.88rem;
  color: var(--ink-400);

  @include tablet {
    display: none;
  }
}

.col-cost {
  display: none;

  @include tablet {
    display: table-cell;
  }
}

.muted {
  color: var(--ink-400);
  font-size: 0.92rem;
}

.zero {
  color: var(--ink-400);
}

.neg {
  color: var(--danger-ink);
  font-weight: 700;
}

.pill {
  display: inline-block;
  font-size: 0.84rem;
  font-weight: 600;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: var(--pill-neutral-bg);
  color: var(--pill-neutral-ink);
  white-space: nowrap;

  &--neg,
  &--merma,
  &--rechazado {
    background: var(--pill-danger-bg);
    color: var(--pill-danger-ink);
  }

  &--low,
  &--enviado {
    background: var(--pill-warn-bg);
    color: var(--pill-warn-ink);
  }

  &--ok,
  &--compra,
  &--carga,
  &--aprobado,
  &--devolucion {
    background: var(--pill-ok-bg);
    color: var(--pill-ok-ink);
  }

  &--venta {
    background: var(--pill-info-bg);
    color: var(--pill-info-ink);
  }
}

.places {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.5rem;
  margin: 0 0 1rem;
}

.place {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  min-height: 56px;
  padding: 0.6rem 0.85rem;
  border: 1.5px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  text-align: left;

  small {
    color: var(--ink-400);
    font-size: 0.8rem;
  }

  &--on {
    border-color: var(--navy-700);
    background: var(--navy-700);
    color: #fff;

    small {
      color: rgba(255, 255, 255, 0.8);
    }
  }
}

.needs-count {
  margin: 0 0 1rem;
  display: flex;
  gap: 0.65rem;
  align-items: flex-start;
  padding: 0.85rem 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid #ecc9c3;
  background: #fbf0ee;
  color: var(--ink-900);
  font-size: 1rem;
  line-height: 1.45;

  i {
    margin-top: 0.2rem;
    color: var(--danger);
  }

  strong {
    color: var(--danger-ink);
  }
}

.sys {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.86rem;
  color: var(--ink-400);
  font-weight: 500;
}

.link-btn {
  min-height: 44px;
  padding: 0.4rem 0.9rem;
  font-size: 0.95rem;
}

.empty {
  color: var(--ink-600);
  padding: 1.25rem 0.6rem;
}

.sentinel {
  min-height: 12px;
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.qty-row {
  display: flex;
  gap: 0.5rem;

  input {
    flex: 1;
    min-width: 0;
  }
}

.unit-seg {
  display: flex;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;

  button {
    min-width: 64px;
    padding: 0 0.9rem;
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--ink-600);
    transition:
      background-color 0.15s ease,
      color 0.15s ease;

    &.on {
      background: var(--navy-800);
      color: #fff;
    }
  }
}

.unit {
  align-self: center;
  color: var(--ink-400);
}

.equiv {
  color: var(--ink-600);
  font-size: 0.95rem;
}

.count-intro {
  margin: 0 0 1rem;
  color: var(--ink-600);
  font-size: 1rem;
  line-height: 1.5;
}


</style>
