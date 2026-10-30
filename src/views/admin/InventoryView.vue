<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useCatalogStore } from '@/stores/catalog'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { useConfirmStore } from '@/stores/confirm'
import { useInfiniteScroll } from '@/composables/useInfiniteScroll'
import { useSound } from '@/composables/useSound'
import {
  apiAdjustStock,
  apiCounts,
  apiCreateCount,
  apiMovements,
  apiStock,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime, formatMoney, formatNumber, formatStock, unitShort } from '@/utils/format'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import CountEditor from '@/components/inventory/CountEditor.vue'
import { costText, stockText } from '@/components/supply/units'
import type { Product, StockCount, StockItem, StockLocation, StockMovement } from '@/types'

type Tab = 'abordo' | 'bodega' | 'conteos' | 'bitacora'
type ModalKind = 'ajuste' | null

const catalogStore = useCatalogStore()
const toast = useToastStore()
const userStore = useUserStore()
const confirmStore = useConfirmStore()
const { play } = useSound()

// Las alertas del resumen abren una pestaña directa (?tab=conteos).
const route = useRoute()
const TABS: Tab[] = ['abordo', 'bodega', 'conteos', 'bitacora']
const initialTab = TABS.find((t) => t === route.query.tab)
const tab = shallowRef<Tab>(initialTab ?? 'abordo')
const stock = shallowRef<StockItem[]>([])
const counts = shallowRef<StockCount[]>([])
const movements = ref<StockMovement[]>([])
const movementsHasMore = shallowRef(false)
const loading = shallowRef(true)
const loadingMore = shallowRef(false)
const query = shallowRef('')
const showOnlyAlerts = shallowRef(false)
const sentinel = shallowRef<HTMLElement | null>(null)
const openCountId = shallowRef<string | null>(null)
const showNewCount = shallowRef(false)

const modal = shallowRef<ModalKind>(null)
const saving = shallowRef(false)
const form = reactive({
  productId: '',
  qty: 1,
  mode: 'envases' as 'envases' | 'base',
  reason: '',
  location: 'abordo' as StockLocation,
})

/** Compras, recepciones, cargas y mermas se hacen en la pantalla de Bodega. */
const canPurchase = computed(() => userStore.isWarehouse)
const canTransfer = computed(() => userStore.isWarehouse || userStore.isDirector)

const MOVEMENT_LABELS: Record<StockMovement['type'], string> = {
  carga: 'Carga',
  venta: 'Consumo',
  merma: 'Merma',
  ajuste: 'Ajuste',
  compra: 'Compra',
  devolucion: 'Devolución',
  migracion: 'Saldo inicial',
}

const MODAL_TITLES: Record<Exclude<ModalKind, null>, string> = {
  ajuste: 'Ajuste manual de inventario',
}

const physicalOptions = computed(() =>
  catalogStore.physical.map((p) => ({ value: p._id, label: p.name, hint: unitShort(p.stockUnit) })),
)

const selectedProduct = computed<Product | null>(
  () => catalogStore.physical.find((p) => p._id === form.productId) ?? null,
)

/** Cantidad en unidad base según el modo elegido (envases o ml). */
const baseQty = computed(() => {
  const p = selectedProduct.value
  if (!p) return 0
  return form.mode === 'envases' ? form.qty * (p.containerSize || 1) : form.qty
})

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const visibleStock = computed(() => {
  const q = normalize(query.value.trim())
  return stock.value.filter(
    (s) =>
      (!q || normalize(s.product.name).includes(q)) &&
      (!showOnlyAlerts.value || s.negative || s.low),
  )
})

const alerts = computed(() => stock.value.filter((s) => s.negative || s.low).length)
const negatives = computed(() =>
  tab.value === 'abordo' || tab.value === 'bodega' ? stock.value.filter((s) => s.negative).length : 0,
)

async function loadStock(location: StockLocation) {
  loading.value = true
  try {
    stock.value = await apiStock(location)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

async function loadCounts() {
  loading.value = true
  try {
    counts.value = await apiCounts()
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

async function loadMovements() {
  loading.value = true
  try {
    const data = await apiMovements()
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
    const data = await apiMovements({ before: last.createdAt })
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
  if (tab.value === 'abordo' || tab.value === 'bodega') return loadStock(tab.value)
  if (tab.value === 'conteos') return loadCounts()
  return loadMovements()
}

watch(tab, refreshTab)

onMounted(async () => {
  await catalogStore.load(true)
  await refreshTab()
})

function openModal(kind: Exclude<ModalKind, null>) {
  Object.assign(form, {
    productId: '',
    qty: 1,
    mode: 'envases',
    reason: '',
    location: tab.value === 'bodega' ? 'bodega' : 'abordo',
  })
  modal.value = kind
}

async function submitModal() {
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
    message: `${p.name} (${form.location === 'bodega' ? 'bodega' : 'a bordo'}): ${baseQty.value < 0 ? '−' : '+'}${amount}. Motivo: ${form.reason.trim()}.`,
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
    modal.value = null
    await refreshTab()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}

async function createCount(location: StockLocation) {
  showNewCount.value = false
  try {
    const count = await apiCreateCount(location)
    play('success')
    toast.success(`Conteo ${count.code} abierto: el corte quedó registrado`)
    openCountId.value = count._id
    await loadCounts()
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

const TAB_META: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'abordo', label: 'A bordo', icon: 'fa-ship' },
  { id: 'bodega', label: 'Bodega', icon: 'fa-warehouse' },
  { id: 'conteos', label: 'Conteos', icon: 'fa-clipboard-list' },
  { id: 'bitacora', label: 'Bitácora', icon: 'fa-clock-rotate-left' },
]

const COUNT_STATUS: Record<string, string> = {
  borrador: 'Borrador',
  enviado: 'Por aprobar',
  aprobado: 'Aprobado',
  rechazado: 'Devuelto',
}
</script>

<template>
  <div class="page inv">
    <header class="page-head">
      <div class="page-head-text">
        <h1 class="page-title">Inventario</h1>
        <p class="page-lead">Saldos de a bordo y bodega. Los licores se miden en ml: cada trago descuenta su medida.</p>
      </div>
      <div class="page-actions">
        <button v-if="userStore.isOwner" type="button" class="btn btn-secondary" @click="openModal('ajuste')">
          <i class="fa-solid fa-sliders" aria-hidden="true" /> Ajuste manual
        </button>
        <button type="button" class="btn btn-primary" @click="showNewCount = true">
          <i class="fa-solid fa-clipboard-check" aria-hidden="true" /> Conteo físico
        </button>
      </div>
    </header>

    <div class="segs inv-tabs" role="tablist" aria-label="Vista del inventario">
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

    <!-- Atajos a los movimientos, que se hacen en la pantalla de Bodega -->
    <nav class="shortcuts" aria-label="Movimientos en Bodega">
      <span class="shortcuts-label">En Bodega:</span>
      <RouterLink v-if="canPurchase" class="shortcut" :to="{ path: '/bodega', query: { flujo: 'compra' } }">
        <i class="fa-solid fa-file-invoice-dollar" aria-hidden="true" /> Registrar compra
      </RouterLink>
      <RouterLink v-if="canPurchase" class="shortcut" :to="{ path: '/bodega', query: { flujo: 'recibir' } }">
        <i class="fa-solid fa-box-open" aria-hidden="true" /> Recibir mercadería
      </RouterLink>
      <RouterLink v-if="canTransfer" class="shortcut" :to="{ path: '/bodega', query: { flujo: 'carga' } }">
        <i class="fa-solid fa-dolly" aria-hidden="true" /> Cargar al barco
      </RouterLink>
      <RouterLink class="shortcut" :to="{ path: '/bodega', query: { flujo: 'merma' } }">
        <i class="fa-solid fa-wine-glass-empty" aria-hidden="true" /> Merma
      </RouterLink>
    </nav>

    <p v-if="negatives" class="needs-count">
      <i class="fa-solid fa-clipboard-question" aria-hidden="true" />
      <span>
        <strong>{{ negatives === 1 ? '1 producto tiene' : `${negatives} productos tienen` }} saldo bajo cero:
          requiere conteo físico.</strong>
        No se corrige solo; el ajuste se aplica cuando se aprueba el conteo.
      </span>
    </p>

    <!-- Stock por ubicación -->
    <section v-if="tab === 'abordo' || tab === 'bodega'" class="card table-card">
      <div class="tools">
        <label class="search">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input v-model="query" type="search" placeholder="Buscar insumo" aria-label="Buscar insumo" />
        </label>
        <button
          type="button"
          class="toggle"
          :class="{ on: showOnlyAlerts }"
          :aria-pressed="showOnlyAlerts"
          @click="showOnlyAlerts = !showOnlyAlerts"
        >
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true" /> Solo alertas
          <span v-if="alerts" class="badge num">{{ alerts }}</span>
        </button>
      </div>

      <SkeletonList v-if="loading" variant="row" :rows="8" />
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Insumo</th>
              <th class="num">Stock</th>
              <th class="col-cost">Costo</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in visibleStock"
              :key="item.product._id"
              :class="{ negative: item.negative, low: item.low && !item.negative }"
            >
              <td>
                <span class="prod">
                  <ProductIcon :icon="item.product.icon" :size="20" />
                  <span class="prod-text">
                    <span class="prod-name">{{ item.product.name }}</span>
                    <small class="prod-cost">
                      {{ costText(item.product.costPerUnit, item.product) || 'Sin costo' }}
                    </small>
                  </span>
                </span>
              </td>
              <td class="num">
                <template v-if="item.negative">
                  <span class="pill pill--neg">Requiere conteo</span>
                  <small class="sys">Sistema: {{ formatNumber(item.qty) }} {{ unitShort(item.product.stockUnit) }}</small>
                </template>
                <template v-else>
                  <strong :class="{ zero: item.qty === 0 }">{{ stockText(item.qty, item.product) }}</strong>
                  <span v-if="item.low" class="pill pill--low">Stock bajo</span>
                  <span v-else-if="item.qty === 0" class="pill">Sin stock</span>
                </template>
              </td>
              <td class="muted col-cost">
                {{ costText(item.product.costPerUnit, item.product) || 'Sin costo' }}
              </td>
            </tr>
            <tr v-if="!visibleStock.length">
              <td colspan="3" class="empty">
                {{ showOnlyAlerts ? 'Sin alertas: todo con stock suficiente.' : 'Ningún insumo con ese nombre.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Conteos físicos -->
    <section v-else-if="tab === 'conteos'" class="card table-card">
      <SkeletonList v-if="loading" variant="row" :rows="5" />
      <div v-else-if="!counts.length" class="vacio">
        <i class="fa-solid fa-clipboard-list" aria-hidden="true" />
        <p>Aún no hay conteos. Usa «Conteo físico» para registrar lo que hay realmente.</p>
      </div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Ubicación</th>
              <th>Corte</th>
              <th>Contó</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in counts" :key="c._id">
              <td><strong>{{ c.code }}</strong></td>
              <td>{{ c.location === 'abordo' ? 'A bordo' : 'Bodega' }}<span v-if="c.cruise" class="muted"> · {{ c.cruise.code }}</span></td>
              <td>{{ formatDateTime(c.cutAt) }}</td>
              <td>{{ c.createdBy?.name }}</td>
              <td><span class="pill" :class="`pill--${c.status}`">{{ COUNT_STATUS[c.status] }}</span></td>
              <td>
                <button type="button" class="btn btn-secondary link-btn" @click="openCountId = c._id">
                  {{ c.status === 'enviado' && userStore.isOwner ? 'Revisar' : 'Abrir' }}
                  <i class="fa-solid fa-chevron-right" aria-hidden="true" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Bitácora -->
    <section v-else class="card table-card">
      <SkeletonList v-if="loading" variant="row" :rows="8" />
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Insumo</th>
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
              <td>{{ m.location === 'bodega' ? 'Bodega' : 'A bordo' }}</td>
              <td class="num" :class="{ neg: m.qty < 0 }">
                {{ m.qty > 0 ? '+' : '' }}{{ formatNumber(m.qty) }} {{ m.legacy ? 'u (antiguo)' : unitShort(m.product?.stockUnit ?? '') }}
              </td>
              <td>{{ m.user?.name }}</td>
              <td class="muted">
                {{ m.reason }}
                <template v-if="m.supplier"> · {{ m.supplier }} · Doc. {{ m.document }}</template>
                <template v-if="m.unitCost"> · {{ formatMoney(m.unitCost) }} c/u</template>
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

    <!-- Movimiento -->
    <BaseModal v-if="modal && userStore.isOwner" :title="MODAL_TITLES[modal]" @close="modal = null">
      <div class="modal-form">
        <div class="field">
          <label>Insumo</label>
          <BaseSelect v-model="form.productId" :options="physicalOptions" placeholder="Buscar insumo…" searchable />
        </div>

        <p class="count-intro">
          Solo Gerencia registra ajustes manuales. Para diferencias de un conteo, usa Conteo físico: el ajuste queda con su corte.
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
            :options="[{ value: 'abordo', label: 'A bordo' }, { value: 'bodega', label: 'Bodega' }]"
          />
        </div>

        <div class="field">
          <label for="mv-reason">Motivo (obligatorio)</label>
          <input id="mv-reason" v-model="form.reason" type="text" placeholder="Ej. corrección autorizada tras revisión" />
        </div>

        <button type="button" class="btn btn-primary btn-lg" :disabled="saving" @click="submitModal">
          <i class="fa-solid fa-check" aria-hidden="true" /> {{ saving ? 'Guardando…' : 'Registrar ajuste' }}
        </button>
      </div>
    </BaseModal>

    <!-- Nuevo conteo -->
    <BaseModal v-if="showNewCount" title="Nuevo conteo físico" @close="showNewCount = false">
      <p class="count-intro">
        Se toma una foto del stock digital en este instante (el corte). Cuenta lo que hay, guarda
        las veces que quieras y envíalo para revisión. Guardar o enviar no cambia el stock: el ajuste se aplica solo cuando se aprueba.
      </p>
      <div class="count-choice">
        <button type="button" class="choice" @click="createCount('abordo')">
          <i class="fa-solid fa-ship" aria-hidden="true" />
          <strong>A bordo</strong>
          <span>Bar del barco, crucero en curso</span>
        </button>
        <button type="button" class="choice" @click="createCount('bodega')">
          <i class="fa-solid fa-warehouse" aria-hidden="true" />
          <strong>Bodega</strong>
          <span>Inventario en tierra</span>
        </button>
      </div>
    </BaseModal>

    <CountEditor
      v-if="openCountId"
      :count-id="openCountId"
      @close="openCountId = null"
      @changed="loadCounts"
    />
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

// Atajos discretos: los movimientos viven en Bodega.
.shortcuts {
  display: flex;
  align-items: center;
  gap: 0 1.1rem;
  margin-bottom: 1rem;
  font-size: 0.95rem;
  white-space: nowrap;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }

  @include tablet {
    flex-wrap: wrap;
    overflow: visible;
  }
}

.shortcuts-label {
  color: var(--ink-400);
}

.shortcut {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 44px;
  font-weight: 600;
  color: var(--navy-700);
  transition: color 0.15s ease;

  i {
    color: var(--gold-500);
  }

  &:hover {
    color: var(--navy-900);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
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

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 48px;
  padding: 0 1rem;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--ink-600);
  white-space: nowrap;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;

  i {
    color: var(--warning);
  }

  &.on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;

    i {
      color: var(--powder-300);
    }
  }
}

.badge {
  min-width: 24px;
  height: 24px;
  padding: 0 0.4rem;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--danger);
  color: #fff;
  font-size: 0.82rem;
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

.count-choice {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.3rem;
  min-height: 112px;
  padding: 1rem 1.1rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  text-align: left;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    transform 0.12s var(--ease-out);

  i {
    font-size: 1.4rem;
    color: var(--navy-700);
    margin-bottom: 0.2rem;
  }

  strong {
    font-size: 1.1rem;
    font-weight: 600;
  }

  span {
    font-size: 0.92rem;
    color: var(--ink-600);
  }

  &:hover {
    border-color: var(--navy-600);
    background: var(--powder-100);
  }

  &:active {
    transform: scale(0.98);
  }
}
</style>
