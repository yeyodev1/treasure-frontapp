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
        <header class="head">
          <h1 class="page-title">Bodega</h1>
          <p class="hint">Toca lo que vas a hacer. Cada paso te pide confirmar antes de guardar.</p>
        </header>

        <!-- Stock resumido -->
        <section class="stock" aria-label="Stock resumido">
          <template v-if="loadingStock">
            <SkeletonBlock height="150px" />
            <SkeletonBlock height="150px" />
          </template>
          <template v-else>
            <article
              v-for="loc in ['bodega', 'abordo'] as const"
              :key="loc"
              class="card stock-card"
            >
              <header class="stock-head">
                <i class="fa-solid" :class="loc === 'bodega' ? 'fa-warehouse' : 'fa-ship'" aria-hidden="true" />
                <h2>{{ loc === 'bodega' ? 'Bodega' : 'A bordo' }}</h2>
              </header>
              <p class="stock-big">
                {{ (loc === 'bodega' ? bodega : abordo).withStock }}
                <small>de {{ (loc === 'bodega' ? bodega : abordo).total }} productos con stock</small>
              </p>
              <div class="stock-flags">
                <span v-if="(loc === 'bodega' ? bodega : abordo).negative" class="flag flag--neg">
                  <i class="fa-solid fa-clipboard-question" aria-hidden="true" />
                  {{ (loc === 'bodega' ? bodega : abordo).negative }}
                  {{ (loc === 'bodega' ? bodega : abordo).negative === 1 ? 'requiere conteo' : 'requieren conteo' }}
                </span>
                <span v-if="(loc === 'bodega' ? bodega : abordo).low" class="flag flag--low">
                  <i class="fa-solid fa-arrow-trend-down" aria-hidden="true" />
                  {{ (loc === 'bodega' ? bodega : abordo).low }} con stock bajo
                </span>
                <span v-if="(loc === 'bodega' ? bodega : abordo).empty" class="flag">
                  <i class="fa-solid fa-circle-minus" aria-hidden="true" />
                  {{ (loc === 'bodega' ? bodega : abordo).empty }} sin stock
                </span>
                <span
                  v-if="!(loc === 'bodega' ? bodega : abordo).low && !(loc === 'bodega' ? bodega : abordo).empty && !(loc === 'bodega' ? bodega : abordo).negative"
                  class="flag flag--ok"
                >
                  <i class="fa-solid fa-circle-check" aria-hidden="true" /> Sin alertas
                </span>
              </div>
              <ul v-if="lowest(stock[loc]).length" class="stock-low">
                <li v-for="item in lowest(stock[loc])" :key="item.product._id">
                  <span>{{ item.product.name }}</span>
                  <strong :class="{ neg: item.negative }">
                    {{ item.negative ? 'Requiere conteo' : stockText(item.qty, item.product) }}
                  </strong>
                </li>
              </ul>
            </article>
          </template>
          <RouterLink to="/admin/inventario" class="stock-link">
            Ver todos los saldos <i class="fa-solid fa-arrow-right" aria-hidden="true" />
          </RouterLink>
        </section>

        <!-- Acciones -->
        <section class="actions" aria-label="Acciones de bodega">
          <button v-if="canBuy" type="button" class="action card" @click="go('compra')">
            <span class="action-icon"><i class="fa-solid fa-file-invoice-dollar" aria-hidden="true" /></span>
            <strong>Registrar compra</strong>
            <small>Factura del proveedor. Aún no suma stock.</small>
          </button>

          <button v-if="canBuy" type="button" class="action card" @click="go('recibir')">
            <span class="action-icon"><i class="fa-solid fa-box-open" aria-hidden="true" /></span>
            <strong>Recibir mercadería</strong>
            <small>Marca lo que llegó. Suma al almacén destino.</small>
            <span v-if="pendingPurchases" class="action-badge">{{ pendingPurchases }} por recibir</span>
          </button>

          <button v-if="canTransfer" type="button" class="action card" @click="go('carga')">
            <span class="action-icon"><i class="fa-solid fa-dolly" aria-hidden="true" /></span>
            <strong>Cargar al barco</strong>
            <small>De bodega a bordo, con el saldo a la vista.</small>
          </button>

          <button type="button" class="action card" @click="go('conteo')">
            <span class="action-icon"><i class="fa-solid fa-clipboard-list" aria-hidden="true" /></span>
            <strong>Conteo físico</strong>
            <small>Cuenta lo que hay. Si hay diferencia, se revisa antes de ajustar.</small>
          </button>

          <button type="button" class="action card" @click="go('merma')">
            <span class="action-icon action-icon--danger"><i class="fa-solid fa-wine-glass-empty" aria-hidden="true" /></span>
            <strong>Merma o rotura</strong>
            <small>Algo se rompió o se perdió. Con motivo.</small>
          </button>

          <RouterLink v-if="!canBuy && userStore.isDirector" to="/abastecimiento?tab=aprobar" class="action card">
            <span class="action-icon"><i class="fa-solid fa-stamp" aria-hidden="true" /></span>
            <strong>Solicitudes por aprobar</strong>
            <small>Lo que pidió el bar.</small>
          </RouterLink>
        </section>

        <!-- Solicitudes por atender -->
        <section v-if="canBuy" class="card pending">
          <header class="pending-head">
            <h2><i class="fa-solid fa-truck-ramp-box" aria-hidden="true" /> Solicitudes por atender</h2>
            <RouterLink to="/abastecimiento?tab=recibir" class="pending-link">
              Ver todos <i class="fa-solid fa-arrow-right" aria-hidden="true" />
            </RouterLink>
          </header>

          <p v-if="!toReceive.length && !revisions.length" class="muted">
            Nada pendiente: no hay solicitudes aprobadas ni revisiones de inventario.
          </p>

          <TransitionGroup tag="ul" name="list" class="pending-list">
            <li v-for="r in toReceive.slice(0, 4)" :key="r._id">
              <button type="button" class="pending-item" @click="openRequisition(r)">
                <span class="pending-tag">Aprobada</span>
                <span class="pending-text">
                  <strong>{{ r.code }} · {{ linesShort(r) }}</strong>
                  <small>{{ personName(r.requestedBy) }} · {{ formatDateTime(r.createdAt) }}</small>
                </span>
                <span class="pending-go">Recibir <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
              </button>
            </li>
            <li v-for="r in revisions.slice(0, 3)" :key="r._id">
              <RouterLink to="/abastecimiento?tab=revisiones" class="pending-item">
                <span class="pending-tag pending-tag--rev">Revisión</span>
                <span class="pending-text">
                  <strong>{{ r.code }} · {{ linesShort(r) }}</strong>
                  <small>{{ r.note }}</small>
                </span>
                <span class="pending-go">Atender <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
              </RouterLink>
            </li>
          </TransitionGroup>
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
  gap: 1.25rem;
  max-width: 1100px;
}

.head .page-title {
  margin-bottom: 0.2rem;
}

.hint {
  margin: 0;
  color: var(--ink-400);
  font-size: 0.95rem;
}

.stock {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;

  @include tablet {
    grid-template-columns: 1fr 1fr;
  }
}

.stock-card {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.stock-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;

  i {
    color: var(--gold-500);
    font-size: 1.1rem;
  }

  h2 {
    font-size: 1.2rem;
  }
}

.stock-big {
  margin: 0;
  font-size: 2rem;
  font-weight: 800;
  color: var(--navy-800);
  line-height: 1.1;

  small {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--ink-400);
  }
}

.stock-flags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.flag {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.6rem;
  border-radius: 999px;
  background: var(--cream-100);
  color: var(--ink-600);
  font-size: 0.8rem;
  font-weight: 700;

  &--low {
    background: rgba(185, 128, 47, 0.14);
    color: #8a5d1d;
  }

  &--neg {
    background: rgba(180, 72, 59, 0.12);
    color: var(--danger);
  }

  &--ok {
    background: rgba(63, 122, 87, 0.12);
    color: var(--success);
  }
}

.stock-low {
  list-style: none;
  margin: 0;
  padding: 0.45rem 0 0;
  border-top: 1px solid var(--cream-200);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.86rem;

  li {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    color: var(--ink-600);
  }

  strong {
    text-align: right;
    flex-shrink: 0;
  }
}

.neg {
  color: var(--danger);
}

.stock-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 48px;
  font-weight: 700;
  color: var(--gold-500);

  @include tablet {
    grid-column: 1 / -1;
  }
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;

  @include desktop {
    grid-template-columns: repeat(3, 1fr);
  }
}

.action {
  position: relative;
  min-height: 150px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  text-align: left;
  border: 2px solid transparent;
  transition:
    transform 0.14s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;

  strong {
    font-size: 1.12rem;
    color: var(--ink-900);
  }

  small {
    color: var(--ink-400);
    font-size: 0.88rem;
  }

  &:hover {
    border-color: var(--gold-500);
  }

  &:active {
    transform: scale(0.98);
  }
}

.action-icon {
  width: 54px;
  height: 54px;
  margin-bottom: 0.35rem;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: var(--navy-800);
  color: #fff;
  font-size: 1.35rem;

  &--danger {
    background: var(--danger);
  }
}

.action-badge {
  position: absolute;
  top: 0.9rem;
  right: 0.9rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  background: var(--gold-500);
  color: #fff;
  font-size: 0.78rem;
  font-weight: 700;
}

.pending {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.pending-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;

  h2 {
    font-size: 1.2rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;

    i {
      color: var(--gold-500);
      font-size: 1rem;
    }
  }
}

.pending-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 48px;
  font-weight: 700;
  color: var(--gold-500);
}

.muted {
  margin: 0;
  color: var(--ink-400);
}

.pending-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.pending-item {
  width: 100%;
  min-height: 64px;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.9rem;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  background: #fff;
  text-align: left;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;

  &:active {
    background: var(--powder-100);
  }
}

.pending-tag {
  flex-shrink: 0;
  padding: 0.25rem 0.55rem;
  border-radius: 999px;
  background: var(--powder-300);
  color: var(--navy-800);
  font-size: 0.75rem;
  font-weight: 700;

  &--rev {
    background: rgba(185, 128, 47, 0.15);
    color: #8a5d1d;
  }
}

.pending-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;

  strong {
    font-size: 0.95rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  small {
    color: var(--ink-400);
  }
}

.pending-go {
  flex-shrink: 0;
  font-weight: 700;
  color: var(--gold-500);
  font-size: 0.9rem;
}
</style>
