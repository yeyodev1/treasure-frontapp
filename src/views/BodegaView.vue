<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'
import PurchaseFlow from '@/components/supply/PurchaseFlow.vue'
import PurchaseReceive from '@/components/supply/PurchaseReceive.vue'
import TransferFlow from '@/components/supply/TransferFlow.vue'
import WasteFlow from '@/components/supply/WasteFlow.vue'
import RequisitionReceive from '@/components/supply/RequisitionReceive.vue'
import CountFlow from '@/components/inventory/CountFlow.vue'
import { useUserStore } from '@/stores/user'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { apiPurchases, apiRequisitions, apiStock } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime } from '@/utils/format'
import type { Requisition, StockItem, StockLocation } from '@/types'
import { personName, requisitionUnit, stockText } from '@/components/supply/units'

type Flow = 'compra' | 'recibir' | 'carga' | 'requerimiento' | 'conteo' | 'merma'
const FLOWS: Flow[] = ['compra', 'recibir', 'carga', 'requerimiento', 'conteo', 'merma']

const userStore = useUserStore()
const toast = useToastStore()
const route = useRoute()
const router = useRouter()
const { play } = useSound()

const stock = shallowRef<Record<StockLocation, StockItem[]>>({ bodega: [], abordo: [] })
const loadingStock = shallowRef(true)
const pendingPurchases = shallowRef(0)
const toReceive = shallowRef<Requisition[]>([])
const revisions = shallowRef<Requisition[]>([])
const receiving = shallowRef<Requisition | null>(null)

const canBuy = computed(() => userStore.isWarehouse)
const canTransfer = computed(() => userStore.isWarehouse || userStore.isDirector)

const flow = computed<Flow | null>(() => {
  const value = route.query.flujo as Flow | undefined
  if (!value || !FLOWS.includes(value)) return null
  if ((value === 'compra' || value === 'recibir' || value === 'requerimiento') && !canBuy.value) return null
  if (value === 'carga' && !canTransfer.value) return null
  if (value === 'requerimiento' && !receiving.value) return null
  return value
})
const purchaseId = computed(() => (route.query.compra as string | undefined) ?? null)

function go(next: Flow | null, extra: Record<string, string> = {}) {
  play('tap')
  router.push({ query: next ? { flujo: next, ...extra } : {} })
}

function summary(items: StockItem[]) {
  return {
    total: items.length,
    withStock: items.filter((i) => i.qty > 0).length,
    low: items.filter((i) => i.low && !i.negative).length,
    empty: items.filter((i) => i.qty === 0).length,
    negative: items.filter((i) => i.negative).length,
  }
}

const bodega = computed(() => summary(stock.value.bodega))
const abordo = computed(() => summary(stock.value.abordo))

const LOCATIONS = [
  { key: 'bodega' as const, label: 'Bodega', icon: 'fa-warehouse' },
  { key: 'abordo' as const, label: 'A bordo', icon: 'fa-ship' },
]

function sumFor(loc: StockLocation) {
  return loc === 'bodega' ? bodega.value : abordo.value
}

/** Cuántas cosas esperan a bodega: lo primero que se ve al entrar. */
const pendingCount = computed(
  () => toReceive.value.length + revisions.value.length + (canBuy.value ? pendingPurchases.value : 0),
)

/** Lo más bajo de cada almacén, para tenerlo a la vista. */
function lowest(items: StockItem[]) {
  return items
    .filter((i) => i.negative || i.low || i.qty === 0)
    .sort((a, b) => Number(b.negative) - Number(a.negative) || a.containers - b.containers)
    .slice(0, 3)
}

async function loadStock() {
  loadingStock.value = true
  try {
    const [b, a] = await Promise.all([apiStock('bodega'), apiStock('abordo')])
    stock.value = { bodega: b, abordo: a }
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loadingStock.value = false
  }
}

async function loadPending() {
  if (!canBuy.value && !userStore.isDirector) return
  try {
    const tasks: Array<Promise<unknown>> = [
      apiPurchases({ status: ['registrada', 'recibida_parcial'] }).then((d) => {
        pendingPurchases.value = d.purchases.length
      }),
    ]
    if (canBuy.value) {
      tasks.push(
        apiRequisitions({ status: ['aprobado', 'recibido_parcial'], kind: 'abastecimiento' }).then((d) => {
          toReceive.value = d.requisitions
        }),
        apiRequisitions({ status: ['solicitado'], kind: 'revision' }).then((d) => {
          revisions.value = d.requisitions
        }),
      )
    }
    await Promise.all(tasks)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

function refresh() {
  void loadStock()
  void loadPending()
}

onMounted(refresh)

// Al volver al tablero se refrescan saldos y pendientes.
watch(flow, (next, prev) => {
  if (!next && prev) refresh()
})

function openRequisition(r: Requisition) {
  receiving.value = r
  go('requerimiento')
}

function onRequisitionSaved() {
  receiving.value = null
  go(null)
}

function receiveNow(id: string) {
  router.replace({ query: { flujo: 'recibir', compra: id } })
}

function linesShort(r: Requisition): string {
  return r.lines
    .map((l) => (r.kind === 'revision' ? l.name : `${l.name} ${stockText(Math.max(0, l.qty - l.receivedQty), requisitionUnit(l))}`))
    .join(', ')
}
</script>

<template>
  <div class="page">
    <Transition name="view" mode="out-in">
      <PurchaseFlow v-if="flow === 'compra'" key="compra" @back="go(null)" @receive="receiveNow" />
      <PurchaseReceive
        v-else-if="flow === 'recibir'"
        :key="`recibir-${purchaseId ?? ''}`"
        :initial-id="purchaseId"
        @back="go(null)"
        @changed="loadStock"
      />
      <TransferFlow v-else-if="flow === 'carga'" key="carga" @back="go(null)" @changed="loadStock" />
      <RequisitionReceive
        v-else-if="flow === 'requerimiento' && receiving"
        key="requerimiento"
        :requisition="receiving"
        back-label="Bodega"
        @back="go(null)"
        @saved="onRequisitionSaved"
      />
      <CountFlow v-else-if="flow === 'conteo'" key="conteo" @back="go(null)" />
      <WasteFlow v-else-if="flow === 'merma'" key="merma" @back="go(null)" @changed="loadStock" />

      <!-- Tablero -->
      <div v-else key="hub" class="hub">
        <header class="page-head">
          <div class="page-head-text">
            <h1 class="page-title">Bodega</h1>
            <p class="page-lead">Elige qué vas a hacer. Nada se guarda sin que confirmes.</p>
          </div>
        </header>

        <!-- Lo que espera a bodega: primero, porque es lo que hay que hacer hoy -->
        <section v-if="canBuy" class="todo" aria-labelledby="todo-title">
          <header class="block-head">
            <h2 id="todo-title" class="section-title">
              Por atender
              <span v-if="pendingCount" class="estado estado--warn num">{{ pendingCount }}</span>
            </h2>
            <RouterLink to="/abastecimiento?tab=recibir" class="link-action">
              Todas las solicitudes <i class="fa-solid fa-arrow-right" aria-hidden="true" />
            </RouterLink>
          </header>

          <div v-if="!pendingCount" class="vacio">
            <i class="fa-solid fa-circle-check" aria-hidden="true" />
            <p>Nada pendiente: no hay compras por recibir, solicitudes aprobadas ni revisiones.</p>
          </div>

          <TransitionGroup v-else tag="ul" name="list" class="todo-list">
            <li v-if="pendingPurchases" key="compras">
              <button type="button" class="todo-row" @click="go('recibir')">
                <i class="fa-solid fa-box-open todo-icon" aria-hidden="true" />
                <span class="todo-text">
                  <strong>
                    {{ pendingPurchases }}
                    {{ pendingPurchases === 1 ? 'compra por recibir' : 'compras por recibir' }}
                  </strong>
                  <small>Marca lo que llegó del proveedor para sumarlo al stock.</small>
                </span>
                <span class="todo-go">Recibir <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
              </button>
            </li>
            <li v-for="r in toReceive.slice(0, 4)" :key="r._id">
              <button type="button" class="todo-row" @click="openRequisition(r)">
                <i class="fa-solid fa-truck-ramp-box todo-icon" aria-hidden="true" />
                <span class="todo-text">
                  <strong>Solicitud {{ r.code }} aprobada</strong>
                  <small>{{ linesShort(r) }}</small>
                  <small class="todo-meta">{{ personName(r.requestedBy) }} · {{ formatDateTime(r.createdAt) }}</small>
                </span>
                <span class="todo-go">Entregar <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
              </button>
            </li>
            <li v-for="r in revisions.slice(0, 3)" :key="r._id">
              <RouterLink to="/abastecimiento?tab=revisiones" class="todo-row">
                <i class="fa-solid fa-magnifying-glass todo-icon" aria-hidden="true" />
                <span class="todo-text">
                  <strong>Revisión {{ r.code }}: {{ linesShort(r) }}</strong>
                  <small v-if="r.note">{{ r.note }}</small>
                </span>
                <span class="todo-go">Atender <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
              </RouterLink>
            </li>
          </TransitionGroup>
        </section>

        <!-- Acciones agrupadas por lo que pasa con la mercadería -->
        <section class="tasks" aria-label="Acciones de bodega">
          <div v-if="canBuy" class="task-group">
            <h2 class="group-title">Entra mercadería</h2>
            <p class="group-note">El stock sube recién al recibir.</p>
            <button type="button" class="task" @click="go('compra')">
              <i class="fa-solid fa-file-invoice-dollar task-icon" aria-hidden="true" />
              <span class="task-text">
                <strong>Registrar compra</strong>
                <small>Factura del proveedor. Aún no suma stock.</small>
              </span>
              <i class="fa-solid fa-chevron-right task-chev" aria-hidden="true" />
            </button>
            <button type="button" class="task" @click="go('recibir')">
              <i class="fa-solid fa-box-open task-icon" aria-hidden="true" />
              <span class="task-text">
                <strong>Recibir mercadería</strong>
                <small>Marca lo que llegó. Suma al almacén destino.</small>
              </span>
              <span v-if="pendingPurchases" class="estado estado--warn num">{{ pendingPurchases }} por recibir</span>
              <i class="fa-solid fa-chevron-right task-chev" aria-hidden="true" />
            </button>
          </div>

          <div class="task-group">
            <h2 class="group-title">Mueve y controla</h2>
            <p class="group-note">Queda registrado quién y cuándo.</p>
            <button v-if="canTransfer" type="button" class="task" @click="go('carga')">
              <i class="fa-solid fa-dolly task-icon" aria-hidden="true" />
              <span class="task-text">
                <strong>Cargar al barco</strong>
                <small>De bodega a bordo, con el saldo a la vista.</small>
              </span>
              <i class="fa-solid fa-chevron-right task-chev" aria-hidden="true" />
            </button>
            <button type="button" class="task" @click="go('conteo')">
              <i class="fa-solid fa-clipboard-list task-icon" aria-hidden="true" />
              <span class="task-text">
                <strong>Conteo físico</strong>
                <small>Cuenta lo que hay. Si hay diferencia, se revisa antes de ajustar.</small>
              </span>
              <i class="fa-solid fa-chevron-right task-chev" aria-hidden="true" />
            </button>
            <button type="button" class="task" @click="go('merma')">
              <i class="fa-solid fa-wine-glass-empty task-icon task-icon--danger" aria-hidden="true" />
              <span class="task-text">
                <strong>Merma o rotura</strong>
                <small>Algo se rompió o se perdió. Con motivo.</small>
              </span>
              <i class="fa-solid fa-chevron-right task-chev" aria-hidden="true" />
            </button>
            <RouterLink v-if="!canBuy && userStore.isDirector" to="/abastecimiento?tab=aprobar" class="task">
              <i class="fa-solid fa-stamp task-icon" aria-hidden="true" />
              <span class="task-text">
                <strong>Solicitudes por aprobar</strong>
                <small>Lo que pidió el bar.</small>
              </span>
              <i class="fa-solid fa-chevron-right task-chev" aria-hidden="true" />
            </RouterLink>
          </div>
        </section>

        <!-- Saldos resumidos de los dos almacenes -->
        <section class="stock" aria-labelledby="stock-title">
          <header class="block-head">
            <h2 id="stock-title" class="section-title">Saldos</h2>
            <RouterLink to="/admin/inventario" class="link-action">
              Ver todos los saldos <i class="fa-solid fa-arrow-right" aria-hidden="true" />
            </RouterLink>
          </header>

          <div class="stock-grid">
            <template v-if="loadingStock">
              <SkeletonBlock height="148px" />
              <SkeletonBlock height="148px" />
            </template>
            <template v-else>
              <article v-for="loc in LOCATIONS" :key="loc.key" class="card stock-card">
                <header class="stock-head">
                  <h3><i class="fa-solid" :class="loc.icon" aria-hidden="true" /> {{ loc.label }}</h3>
                  <span v-if="sumFor(loc.key).negative" class="estado estado--danger">
                    {{ sumFor(loc.key).negative }}
                    {{ sumFor(loc.key).negative === 1 ? 'requiere conteo' : 'requieren conteo' }}
                  </span>
                  <span v-else-if="!sumFor(loc.key).low && !sumFor(loc.key).empty" class="estado estado--ok">
                    <i class="fa-solid fa-circle-check" aria-hidden="true" /> Sin alertas
                  </span>
                </header>
                <p class="stock-big num">
                  {{ sumFor(loc.key).withStock }}
                  <small>de {{ sumFor(loc.key).total }} productos con stock</small>
                </p>
                <p v-if="sumFor(loc.key).low || sumFor(loc.key).empty" class="stock-flags">
                  <span v-if="sumFor(loc.key).low" class="estado estado--warn">
                    {{ sumFor(loc.key).low }} con stock bajo
                  </span>
                  <span v-if="sumFor(loc.key).empty" class="estado">
                    {{ sumFor(loc.key).empty }} sin stock
                  </span>
                </p>
                <ul v-if="lowest(stock[loc.key]).length" class="stock-low">
                  <li v-for="item in lowest(stock[loc.key])" :key="item.product._id">
                    <span>{{ item.product.name }}</span>
                    <strong class="num" :class="{ neg: item.negative }">
                      {{ item.negative ? 'Requiere conteo' : stockText(item.qty, item.product) }}
                    </strong>
                  </li>
                </ul>
              </article>
            </template>
          </div>
        </section>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.hub {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  max-width: 1100px;
}

.hub > .page-head {
  margin-bottom: -0.75rem;
}

.block-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.25rem 1rem;
  margin-bottom: 0.5rem;

  .section-title {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
}

// ── Por atender ──
.todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.todo-row {
  width: 100%;
  min-height: 72px;
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--line);
  border-left: 4px solid var(--gold-500);
  border-radius: var(--radius-sm);
  background: var(--surface);
  text-align: left;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    transform 0.12s var(--ease-out);

  &:hover {
    border-color: var(--navy-600);
    border-left-color: var(--gold-500);
  }

  &:active {
    transform: scale(0.99);
    background: var(--powder-100);
  }
}

.todo-icon {
  flex: none;
  width: 1.6rem;
  text-align: center;
  font-size: 1.25rem;
  color: var(--navy-700);
}

.todo-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  flex: 1;
  min-width: 0;

  strong {
    font-size: 1.05rem;
    font-weight: 600;
  }

  small {
    font-size: 0.95rem;
    color: var(--ink-600);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.todo-meta {
  color: var(--ink-400) !important;
  font-size: 0.88rem !important;
}

.todo-go {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 44px;
  padding: 0 0.9rem;
  border-radius: var(--radius-sm);
  background: var(--navy-800);
  color: #fff;
  font-weight: 600;
  font-size: 0.95rem;
}

// ── Acciones ──
.tasks {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;

  @include tablet {
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
  }
}

.task-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.group-title {
  font-size: 1.3rem;
}

.group-note {
  margin: -0.25rem 0 0.25rem;
  color: var(--ink-600);
  font-size: 0.95rem;
}

.task {
  position: relative;
  width: 100%;
  min-height: 84px;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.9rem 1rem 0.9rem 1.1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  text-align: left;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    transform 0.12s var(--ease-out);

  &:hover {
    border-color: var(--navy-600);

    .task-chev {
      transform: translateX(3px);
      color: var(--navy-800);
    }
  }

  &:active {
    transform: scale(0.985);
    background: var(--powder-100);
  }
}

.task-icon {
  flex: none;
  width: 2rem;
  text-align: center;
  font-size: 1.5rem;
  color: var(--navy-800);

  &--danger {
    color: var(--danger);
  }
}

.task-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1;
  min-width: 0;

  strong {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--ink-900);
  }

  small {
    font-size: 0.95rem;
    line-height: 1.35;
    color: var(--ink-600);
  }
}

.task-chev {
  flex: none;
  color: var(--ink-300);
  transition:
    transform 0.16s var(--ease-out),
    color 0.16s ease;
}

// ── Saldos ──
.stock-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
  align-items: start;

  @include tablet {
    grid-template-columns: 1fr 1fr;
  }
}

.stock-card {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.stock-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;

  h3 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.25rem;

    i {
      color: var(--gold-500);
      font-size: 1rem;
    }
  }
}

.stock-big {
  margin: 0;
  font-size: 2rem;
  font-weight: 600;
  color: var(--navy-800);
  line-height: 1.1;

  small {
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--ink-600);
  }
}

.stock-flags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0;
}

.stock-low {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  font-size: 0.97rem;

  li {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem 0;
    border-top: 1px solid var(--rule);
    color: var(--ink-900);
  }

  strong {
    text-align: right;
    flex-shrink: 0;
    font-weight: 600;
  }
}

.neg {
  color: var(--danger-ink);
}

@include tablet {
  .todo-text small {
    white-space: normal;
  }
}
</style>
