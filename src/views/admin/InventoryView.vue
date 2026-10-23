<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue'
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
  apiPurchase,
  apiRegisterWaste,
  apiStock,
  apiTransfer,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime, formatMoney, formatNumber, formatStock, unitShort } from '@/utils/format'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import CountEditor from '@/components/inventory/CountEditor.vue'
import type { Product, StockCount, StockItem, StockLocation, StockMovement } from '@/types'

type Tab = 'abordo' | 'bodega' | 'conteos' | 'bitacora'
type ModalKind = 'carga' | 'merma' | 'compra' | 'ajuste' | null

const catalogStore = useCatalogStore()
const toast = useToastStore()
const userStore = useUserStore()
const confirmStore = useConfirmStore()
const { play } = useSound()

const tab = shallowRef<Tab>('abordo')
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
  supplier: '',
  document: '',
  unitCost: 0,
})

const canPurchase = computed(() => userStore.role === 'admin' || userStore.role === 'bodega')
const canTransfer = computed(() => userStore.role !== 'bartender')

const MOVEMENT_LABELS: Record<StockMovement['type'], string> = {
  carga: 'Carga',
  venta: 'Venta',
  merma: 'Merma',
  ajuste: 'Ajuste',
  compra: 'Compra',
  devolucion: 'Devolución',
  migracion: 'Saldo inicial',
}

const MODAL_TITLES: Record<Exclude<ModalKind, null>, string> = {
  carga: 'Cargar al barco (desde bodega)',
  merma: 'Registrar merma',
  compra: 'Ingreso de compra a bodega',
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
    supplier: '',
    document: '',
    unitCost: 0,
  })
  modal.value = kind
}

async function submitModal() {
  const p = selectedProduct.value
  if (!p || !form.qty) {
    toast.error('Elige el producto y la cantidad')
    return
  }
  const kind = modal.value
  const amount = `${formatStock(baseQty.value, p.stockUnit, p.containerSize, p.containerLabel)}`
  const ok = await confirmStore.ask({
    title: `¿Registrar ${MODAL_TITLES[kind!].toLowerCase()}?`,
    message: `${p.name}: ${kind === 'merma' ? '−' : kind === 'ajuste' && baseQty.value < 0 ? '' : '+'}${amount}`,
    confirmLabel: 'Registrar',
    danger: kind === 'merma',
    icon: 'fa-boxes-stacked',
  })
  if (!ok) return

  saving.value = true
  try {
    if (kind === 'carga') {
      await apiTransfer([{ productId: p._id, qty: baseQty.value }])
    } else if (kind === 'merma') {
      await apiRegisterWaste({ productId: p._id, qty: baseQty.value, reason: form.reason, location: form.location })
    } else if (kind === 'compra') {
      await apiPurchase({
        supplier: form.supplier,
        document: form.document,
        items: [{ productId: p._id, containers: form.mode === 'envases' ? form.qty : form.qty / (p.containerSize || 1), unitCost: form.unitCost }],
      })
    } else if (kind === 'ajuste') {
      await apiAdjustStock({ productId: p._id, qty: baseQty.value, reason: form.reason, location: form.location })
    }
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

const COUNT_STATUS: Record<string, string> = {
  borrador: 'Borrador',
  enviado: 'Por aprobar',
  aprobado: 'Aprobado',
  rechazado: 'Devuelto',
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1 class="page-title">Inventario</h1>
      <p class="hint">Todo se mide en su unidad: los licores en ml, así cada trago descuenta su medida.</p>
    </header>

    <div class="tabs" role="tablist">
      <button type="button" class="tab" :class="{ 'tab--on': tab === 'abordo' }" @click="tab = 'abordo'">
        <i class="fa-solid fa-ship" aria-hidden="true" /> A bordo
      </button>
      <button type="button" class="tab" :class="{ 'tab--on': tab === 'bodega' }" @click="tab = 'bodega'">
        <i class="fa-solid fa-warehouse" aria-hidden="true" /> Bodega
      </button>
      <button type="button" class="tab" :class="{ 'tab--on': tab === 'conteos' }" @click="tab = 'conteos'">
        <i class="fa-solid fa-clipboard-list" aria-hidden="true" /> Conteos
      </button>
      <button type="button" class="tab" :class="{ 'tab--on': tab === 'bitacora' }" @click="tab = 'bitacora'">
        <i class="fa-solid fa-clock-rotate-left" aria-hidden="true" /> Bitácora
      </button>
    </div>

    <div class="actions">
      <button v-if="canTransfer" type="button" class="btn btn-ghost" @click="openModal('carga')">
        <i class="fa-solid fa-dolly" aria-hidden="true" /> Cargar al barco
      </button>
      <button type="button" class="btn btn-ghost" @click="openModal('merma')">
        <i class="fa-solid fa-wine-glass-empty" aria-hidden="true" /> Merma
      </button>
      <button v-if="canPurchase" type="button" class="btn btn-ghost" @click="openModal('compra')">
        <i class="fa-solid fa-cart-plus" aria-hidden="true" /> Compra a bodega
      </button>
      <button type="button" class="btn btn-ghost" @click="showNewCount = true">
        <i class="fa-solid fa-clipboard-check" aria-hidden="true" /> Conteo físico
      </button>
      <button v-if="userStore.isAdmin" type="button" class="btn btn-ghost" @click="openModal('ajuste')">
        <i class="fa-solid fa-sliders" aria-hidden="true" /> Ajuste manual
      </button>
    </div>

    <!-- Stock por ubicación -->
    <section v-if="tab === 'abordo' || tab === 'bodega'" class="card table-card">
      <div class="tools">
        <label class="search">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input v-model="query" type="search" placeholder="Buscar insumo" aria-label="Buscar insumo" />
        </label>
        <button type="button" class="toggle" :class="{ on: showOnlyAlerts }" @click="showOnlyAlerts = !showOnlyAlerts">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true" /> Alertas
          <span v-if="alerts" class="badge">{{ alerts }}</span>
        </button>
      </div>

      <SkeletonList v-if="loading" variant="row" :rows="8" />
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Insumo</th>
              <th class="num">Stock</th>
              <th>Envase</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in visibleStock" :key="item.product._id" :class="{ negative: item.negative }">
              <td class="prod">
                <ProductIcon :icon="item.product.icon" :size="20" />
                <span>{{ item.product.name }}</span>
              </td>
              <td class="num">
                <strong :class="{ neg: item.negative }">
                  {{ formatStock(item.qty, item.product.stockUnit, item.product.containerSize, item.product.containerLabel) }}
                </strong>
              </td>
              <td class="muted">
                {{ item.product.containerSize > 1 ? `${formatNumber(item.product.containerSize)} ${unitShort(item.product.stockUnit)} por ${item.product.containerLabel}` : item.product.containerLabel }}
              </td>
              <td>
                <span v-if="item.negative" class="pill pill--neg">Revisar en conteo</span>
                <span v-else-if="item.low" class="pill pill--low">Stock bajo</span>
                <span v-else-if="item.qty === 0" class="pill">Sin stock</span>
                <span v-else class="pill pill--ok">OK</span>
              </td>
            </tr>
            <tr v-if="!visibleStock.length">
              <td colspan="4" class="empty">Sin resultados.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Conteos físicos -->
    <section v-else-if="tab === 'conteos'" class="card table-card">
      <SkeletonList v-if="loading" variant="row" :rows="5" />
      <p v-else-if="!counts.length" class="empty">
        Aún no hay conteos. Usa "Conteo físico" para registrar lo que hay realmente.
      </p>
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
                <button type="button" class="link-btn" @click="openCountId = c._id">
                  {{ c.status === 'enviado' && userStore.isAdmin ? 'Revisar' : 'Abrir' }}
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
    <BaseModal v-if="modal" :title="MODAL_TITLES[modal]" @close="modal = null">
      <div class="modal-form">
        <div class="field">
          <label>Insumo</label>
          <BaseSelect v-model="form.productId" :options="physicalOptions" placeholder="Buscar insumo…" searchable />
        </div>

        <div v-if="modal === 'compra'" class="row">
          <div class="field">
            <label for="mv-supplier">Proveedor</label>
            <input id="mv-supplier" v-model="form.supplier" type="text" />
          </div>
          <div class="field">
            <label for="mv-doc">Documento (factura / guía)</label>
            <input id="mv-doc" v-model="form.document" type="text" />
          </div>
        </div>

        <div class="field">
          <label for="mv-qty">
            Cantidad {{ modal === 'ajuste' ? '(positiva suma, negativa resta)' : '' }}
          </label>
          <div class="qty-row">
            <input id="mv-qty" v-model.number="form.qty" type="number" step="any" />
            <div v-if="selectedProduct && selectedProduct.containerSize > 1" class="seg">
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

        <div v-if="modal === 'compra'" class="field">
          <label for="mv-cost">Costo por {{ selectedProduct?.containerLabel ?? 'envase' }} (USD)</label>
          <input id="mv-cost" v-model.number="form.unitCost" type="number" min="0" step="0.01" />
        </div>

        <div v-if="modal === 'merma' || modal === 'ajuste'" class="field">
          <label>Ubicación</label>
          <BaseSelect
            v-model="form.location"
            :options="[{ value: 'abordo', label: 'A bordo' }, { value: 'bodega', label: 'Bodega' }]"
          />
        </div>

        <div v-if="modal === 'merma' || modal === 'ajuste'" class="field">
          <label for="mv-reason">Motivo</label>
          <input id="mv-reason" v-model="form.reason" type="text" placeholder="Ej. se cayó una botella" />
        </div>

        <button type="button" class="btn btn-gold" :disabled="saving" @click="submitModal">
          <i class="fa-solid fa-check" aria-hidden="true" /> {{ saving ? 'Guardando…' : 'Registrar' }}
        </button>
      </div>
    </BaseModal>

    <!-- Nuevo conteo -->
    <BaseModal v-if="showNewCount" title="Nuevo conteo físico" @close="showNewCount = false">
      <p class="count-intro">
        Se toma una foto del stock digital en este instante (el corte). Cuenta lo que hay, guarda
        las veces que quieras y envíalo a Paula. Guardar no cambia el stock.
      </p>
      <div class="count-choice">
        <button type="button" class="choice" @click="createCount('abordo')">
          <i class="fa-solid fa-ship" aria-hidden="true" />
          <strong>A bordo</strong>
          <span>Bar del barco, salida activa</span>
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

.head {
  margin-bottom: 1rem;

  .page-title {
    margin-bottom: 0.15rem;
  }
}

.hint {
  margin: 0;
  color: var(--ink-400);
  font-size: 0.88rem;
}

.tabs {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
  overflow-x: auto;
  scrollbar-width: none;
}

.tab {
  flex-shrink: 0;
  min-height: 42px;
  padding: 0.45rem 1rem;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.86rem;
  background: var(--surface);
  border: 1.5px solid var(--cream-200);
  color: var(--ink-600);
  transition: all 0.15s ease;

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.table-card {
  padding: 0.75rem;
}

.tools {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 44px;
  padding: 0 0.85rem;
  border: 1.5px solid var(--cream-200);
  border-radius: 999px;
  color: var(--ink-400);

  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
  }
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0 0.9rem;
  border-radius: 999px;
  border: 1.5px solid var(--cream-200);
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--ink-600);

  &.on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }
}

.badge {
  min-width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--danger);
  color: #fff;
  font-size: 0.7rem;
}

.table-wrap {
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.86rem;

  th {
    text-align: left;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-400);
    padding: 0.5rem 0.6rem;
    border-bottom: 2px solid var(--cream-200);
    white-space: nowrap;
  }

  td {
    padding: 0.55rem 0.6rem;
    border-bottom: 1px solid var(--cream-200);
  }

  tr.negative td {
    background: rgba(180, 72, 59, 0.06);
  }
}

.num {
  text-align: right !important;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.nowrap {
  white-space: nowrap;
}

.prod {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  min-width: 180px;

  svg {
    color: var(--navy-700);
    flex-shrink: 0;
  }
}

.muted {
  color: var(--ink-400);
  font-size: 0.82rem;
}

.neg {
  color: var(--danger);
  font-weight: 700;
}

.pill {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: var(--cream-100);
  color: var(--ink-600);
  white-space: nowrap;

  &--neg,
  &--merma,
  &--rechazado {
    background: rgba(180, 72, 59, 0.12);
    color: var(--danger);
  }

  &--low,
  &--enviado {
    background: rgba(185, 128, 47, 0.15);
    color: #8a5d1d;
  }

  &--ok,
  &--compra,
  &--carga,
  &--aprobado,
  &--devolucion {
    background: rgba(63, 122, 87, 0.13);
    color: var(--success);
  }

  &--venta {
    background: var(--powder-100);
    color: var(--navy-700);
  }
}

.link-btn {
  font-weight: 700;
  color: var(--gold-500);
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.empty {
  color: var(--ink-400);
  text-align: center;
  padding: 1rem;
}

.sentinel {
  min-height: 12px;
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;

  @include tablet {
    grid-template-columns: 1fr 1fr;
  }
}

.qty-row {
  display: flex;
  gap: 0.5rem;

  input {
    flex: 1;
    min-width: 0;
  }
}

.seg {
  display: flex;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  overflow: hidden;

  button {
    padding: 0 0.85rem;
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--ink-600);

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
  color: var(--ink-400);
}

.count-intro {
  margin: 0 0 1rem;
  color: var(--ink-600);
  font-size: 0.9rem;
}

.count-choice {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.choice {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  padding: 1.2rem 0.8rem;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius);
  transition: border-color 0.15s ease, transform 0.15s ease;

  i {
    font-size: 1.5rem;
    color: var(--gold-500);
  }

  span {
    font-size: 0.8rem;
    color: var(--ink-400);
  }

  &:hover {
    border-color: var(--gold-500);
    transform: translateY(-2px);
  }
}
</style>
