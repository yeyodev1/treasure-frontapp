<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PurchaseFlow from '@/components/supply/PurchaseFlow.vue'
import PurchaseReceive from '@/components/supply/PurchaseReceive.vue'
import TransferFlow from '@/components/supply/TransferFlow.vue'
import WasteFlow from '@/components/supply/WasteFlow.vue'
import RequisitionReceive from '@/components/supply/RequisitionReceive.vue'
import { useUserStore } from '@/stores/user'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { apiPurchases, apiRequisitions, apiWeeklyOrder, apiWeeklyOrderCurrent } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime } from '@/utils/format'
import type { Requisition, WeeklyOrder } from '@/types'
import { containerText, personName, requisitionUnit, stockText } from '@/components/supply/units'

/**
 * Compras y entregas (pestaña de Inventario y pedidos, 4-nov-2026): el pedido
 * aprobado con lo comprado, recibido y pendiente por línea; registrar la
 * compra desde ese pedido; recibir; trasladar entre Quito, Puerto y el barco;
 * entregar lo que pidió el bar y registrar mermas.
 */
type Flow = 'compra' | 'recibir' | 'carga' | 'requerimiento' | 'merma'
const FLOWS: Flow[] = ['compra', 'recibir', 'carga', 'requerimiento', 'merma']

const userStore = useUserStore()
const toast = useToastStore()
const route = useRoute()
const router = useRouter()
const { play } = useSound()

const pendingPurchases = shallowRef(0)
const toReceive = shallowRef<Requisition[]>([])
const revisions = shallowRef<Requisition[]>([])
const receiving = shallowRef<Requisition | null>(null)
/** Pedido semanal aprobado más reciente que sigue abierto. */
const order = shallowRef<WeeklyOrder | null>(null)

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
/** Compra desde el pedido: ?flujo=compra&pedido=1. */
const buyingOrder = computed(() => (route.query.pedido && order.value ? order.value : null))

function go(next: Flow | null, extra: Record<string, string> = {}) {
  play('tap')
  router.push({ query: next ? { flujo: next, ...extra } : {} })
}

/** Cuántas cosas esperan: lo primero que se ve al entrar. */
const pendingCount = computed(
  () => toReceive.value.length + revisions.value.length + (canBuy.value ? pendingPurchases.value : 0),
)

const orderOpen = computed(() => order.value && order.value.phase !== 'recibido')
const orderToBuy = computed(() => order.value?.lines.filter((l) => l.toBuy > 0).length ?? 0)

async function loadOrder() {
  try {
    const current = await apiWeeklyOrderCurrent()
    if (current.order?.status === 'aprobado') {
      order.value = current.order
      return
    }
    const approved = current.others.find((o) => o.status === 'aprobado')
    order.value = approved ? await apiWeeklyOrder(approved._id) : null
  } catch (err) {
    toast.error(apiErrorMessage(err))
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
  void loadPending()
  void loadOrder()
}

onMounted(refresh)

// Al volver al tablero se refrescan pendientes y el avance del pedido.
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
      <PurchaseFlow
        v-if="flow === 'compra'"
        :key="`compra-${buyingOrder?._id ?? ''}`"
        :order="buyingOrder"
        @back="go(null)"
        @receive="receiveNow"
      />
      <PurchaseReceive
        v-else-if="flow === 'recibir'"
        :key="`recibir-${purchaseId ?? ''}`"
        :initial-id="purchaseId"
        @back="go(null)"
      />
      <TransferFlow v-else-if="flow === 'carga'" key="carga" @back="go(null)" />
      <RequisitionReceive
        v-else-if="flow === 'requerimiento' && receiving"
        key="requerimiento"
        :requisition="receiving"
        back-label="Compras y entregas"
        @back="go(null)"
        @saved="onRequisitionSaved"
      />
      <WasteFlow v-else-if="flow === 'merma'" key="merma" @back="go(null)" />

      <!-- Tablero -->
      <div v-else key="hub" class="hub">
        <header class="page-head">
          <div class="page-head-text">
            <h1 class="page-title">Compras y entregas</h1>
            <p class="page-lead">Compra desde el pedido aprobado, recibe lo que llegó y lleva la mercadería al barco.</p>
          </div>
        </header>

        <!-- Pedido aprobado: lo comprado, recibido y pendiente por línea -->
        <section v-if="orderOpen && order" class="card order" aria-labelledby="order-title">
          <header class="block-head">
            <h2 id="order-title" class="section-title">
              Pedido {{ order.code }}
              <span class="estado" :class="order.phase === 'comprar' ? 'estado--warn' : ''">{{ order.phaseLabel }}</span>
            </h2>
            <button v-if="canBuy && orderToBuy" type="button" class="btn btn-primary" @click="go('compra', { pedido: '1' })">
              <i class="fa-solid fa-file-invoice-dollar" aria-hidden="true" /> Registrar compra de este pedido
            </button>
          </header>
          <p v-if="order.revision" class="order-rev">
            <i class="fa-solid fa-pen-to-square" aria-hidden="true" />
            La directora lo cambió después de aprobarlo (revisión {{ order.revision }}). Revisa las cantidades.
          </p>
          <div class="order-table" role="table" :aria-label="`Avance del pedido ${order.code}`">
            <div class="order-row order-row--head" role="row">
              <span role="columnheader">Producto</span>
              <span role="columnheader" class="num">Pedido</span>
              <span role="columnheader" class="num">Comprado</span>
              <span role="columnheader" class="num">Recibido</span>
              <span role="columnheader" class="num">Pendiente</span>
            </div>
            <div v-for="l in order.lines.filter((x) => x.qty > 0 || x.purchased > 0)" :key="l.product" class="order-row" role="row">
              <span role="cell" class="order-name">{{ l.name }}</span>
              <span role="cell" class="num" data-label="Pedido">{{ containerText(l.qty, l) }}</span>
              <span role="cell" class="num" data-label="Comprado">{{ l.purchased ? containerText(l.purchased, l) : '—' }}</span>
              <span role="cell" class="num" data-label="Recibido">{{ l.received ? containerText(l.received, l) : '—' }}</span>
              <span role="cell" class="num" data-label="Pendiente">
                <template v-if="l.toBuy > 0">{{ containerText(l.toBuy, l) }} por comprar</template>
                <template v-else-if="l.toReceive > 0">{{ containerText(l.toReceive, l) }} por recibir</template>
                <template v-else><i class="fa-solid fa-circle-check ok" aria-hidden="true" /> Listo</template>
              </span>
            </div>
          </div>
        </section>

        <!-- Lo que espera: primero, porque es lo que hay que hacer hoy -->
        <section v-if="canBuy" class="todo" aria-labelledby="todo-title">
          <header class="block-head">
            <h2 id="todo-title" class="section-title">
              Por atender
              <span v-if="pendingCount" class="estado estado--warn num">{{ pendingCount }}</span>
            </h2>
            <RouterLink to="/inventario/compras/solicitudes?tab=recibir" class="link-action">
              Solicitudes del bar <i class="fa-solid fa-arrow-right" aria-hidden="true" />
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
                  <small>Marca lo que llegó y dónde (Quito, Puerto o a bordo).</small>
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
              <RouterLink to="/inventario/compras/solicitudes?tab=revisiones" class="todo-row">
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
        <section class="tasks" aria-label="Acciones de compras y entregas">
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
                <small>Marca lo que llegó y dónde. Lo que falta queda pendiente.</small>
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
                <strong>Trasladar o cargar al barco</strong>
                <small>Quito → Puerto, Puerto → A bordo… Regístralo cuando llega.</small>
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
            <RouterLink to="/inventario/compras/solicitudes" class="task">
              <i class="fa-solid fa-stamp task-icon" aria-hidden="true" />
              <span class="task-text">
                <strong>Solicitudes del bar</strong>
                <small>{{ userStore.isDirector ? 'Aprueba lo que pidió el bar durante el crucero.' : 'Lo que pidió el bar durante el crucero.' }}</small>
              </span>
              <i class="fa-solid fa-chevron-right task-chev" aria-hidden="true" />
            </RouterLink>
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

// ── Pedido aprobado ──
.order {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.order-rev {
  margin: 0;
  color: var(--ink-600);
}

.order-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem 0.75rem;
  padding: 0.6rem 0;
  border-top: 1px solid var(--rule);
  align-items: center;

  > [data-label]::before {
    content: attr(data-label);
    display: block;
    font-size: 0.8rem;
    color: var(--ink-600);
  }

  &--head {
    display: none;
  }

  @include tablet {
    grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr)) minmax(0, 1.4fr);

    > [data-label]::before {
      display: none;
    }

    .num {
      text-align: right;
    }

    &--head {
      display: grid;
      border-top: 0;
      padding-top: 0;
      font-size: 0.875rem;
      color: var(--ink-600);
    }
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .ok {
    color: var(--ok, #1d6b43);
  }
}

.order-name {
  grid-column: 1 / -1;
  font-weight: 600;
  color: var(--ink-900);

  @include tablet {
    grid-column: auto;
  }
}

@include tablet {
  .todo-text small {
    white-space: normal;
  }
}
</style>
