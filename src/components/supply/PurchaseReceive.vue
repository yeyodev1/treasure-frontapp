<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { useSound } from '@/composables/useSound'
import { useSaveAttempt } from '@/composables/useSaveAttempt'
import { apiCancelPurchase, apiPurchases, apiReceivePurchase } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDate, formatDateTime, formatMoney } from '@/utils/format'
import type { Purchase, PurchaseLine, PurchaseStatus } from '@/types'
import FlowHeader from './FlowHeader.vue'
import QtyStepper from './QtyStepper.vue'
import StatusPill from './StatusPill.vue'
import SummaryModal from './SummaryModal.vue'
import { containerText, conversionText, LOCATION_LABEL, missingText, personName, plural, toContainers } from './units'

/** Recibir mercadería: lo que llegó (en envases) suma al almacén destino. */
const props = defineProps<{ initialId?: string | null }>()
const emit = defineEmits<{ back: []; changed: [] }>()

const userStore = useUserStore()
const confirmStore = useConfirmStore()
const toast = useToastStore()
const { play } = useSound()
const save = useSaveAttempt('la recepción')

const purchases = shallowRef<Purchase[]>([])
const loading = shallowRef(true)
const filter = shallowRef<'pendientes' | 'todas'>('pendientes')
const current = shallowRef<Purchase | null>(null)
const arrived = ref<number[]>([])
const note = shallowRef('')
const reviewing = shallowRef(false)

const OPEN: PurchaseStatus[] = ['registrada', 'recibida_parcial']

async function load() {
  loading.value = true
  try {
    const { purchases: rows } = await apiPurchases()
    purchases.value = rows
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  if (props.initialId) {
    const found = purchases.value.find((p) => p._id === props.initialId)
    if (found) open(found)
  }
})

const visible = computed(() =>
  filter.value === 'pendientes' ? purchases.value.filter((p) => OPEN.includes(p.status)) : purchases.value,
)
const pendingCount = computed(() => purchases.value.filter((p) => OPEN.includes(p.status)).length)

/** Envases que faltan por llegar en una línea. */
function pendingOf(line: PurchaseLine): number {
  return toContainers(Math.max(0, line.qty - line.receivedQty), line)
}

function receivedOf(line: PurchaseLine): number {
  return toContainers(line.receivedQty, line)
}

function progress(p: Purchase): string {
  const total = p.lines.reduce((s, l) => s + l.containers, 0)
  const got = p.lines.reduce((s, l) => s + receivedOf(l), 0)
  return `${got} de ${total} envases recibidos`
}

function open(p: Purchase) {
  // Un envío sin confirmar de esta misma compra conserva su clave.
  if (!save.offline.value || current.value?._id !== p._id) save.reset()
  current.value = p
  arrived.value = p.lines.map((l) => pendingOf(l))
  note.value = ''
  play('tap')
}

function closeDetail() {
  current.value = null
}

const canReceive = computed(() => current.value && OPEN.includes(current.value.status) && userStore.isWarehouse)
const picks = computed(() =>
  (current.value?.lines ?? [])
    .map((line, index) => ({ line, index, containers: arrived.value[index] ?? 0 }))
    .filter((p) => p.containers > 0),
)
const willComplete = computed(() =>
  (current.value?.lines ?? []).every((l, i) => (arrived.value[i] ?? 0) + 1e-9 >= pendingOf(l)),
)

function setAll(full: boolean) {
  if (!current.value) return
  arrived.value = current.value.lines.map((l) => (full ? pendingOf(l) : 0))
  play('tap')
}

function review() {
  if (arrived.value.some((n) => !Number.isFinite(n) || n < 0)) {
    play('error')
    toast.error('Revisa las cantidades marcadas en rojo: deben ser cero o más.')
    return
  }
  if (!picks.value.length) {
    play('error')
    toast.error('Marca al menos un producto que haya llegado')
    return
  }
  if (!save.offline.value) save.reset()
  reviewing.value = true
}

async function confirm() {
  const p = current.value
  if (!p) return
  const result = await save.run((key) =>
    apiReceivePurchase(
      p._id,
      key,
      picks.value.map((x) => ({ index: x.index, containers: x.containers })),
      note.value.trim() || undefined,
    ),
  )
  if (result.ok) {
    play('success')
    current.value = result.value
    purchases.value = purchases.value.map((x) => (x._id === result.value._id ? result.value : x))
    emit('changed')
  } else {
    play('error')
  }
}

function done() {
  reviewing.value = false
  current.value = null
  void load()
}

async function cancelPurchase(p: Purchase) {
  const reason = await confirmStore.askReason({
    title: `¿Anular ${p.code}?`,
    message: `Factura ${p.document} de ${p.supplier}. No cambia el stock porque no se recibió nada.`,
    confirmLabel: 'Anular factura',
    danger: true,
    icon: 'fa-ban',
    reason: {
      label: 'Motivo (obligatorio)',
      suggestions: ['Factura duplicada', 'Registrada por error', 'El proveedor no entregará'],
    },
  })
  if (!reason) return
  try {
    const updated = await apiCancelPurchase(p._id, reason)
    play('success')
    toast.success(`${updated.code} anulada`)
    purchases.value = purchases.value.map((x) => (x._id === updated._id ? updated : x))
    if (current.value?._id === updated._id) current.value = updated
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  }
}

/** Recibida en parte: lo que falta no llegará; se cierra con motivo (P09). */
async function closePending(p: Purchase) {
  const missing = p.lines
    .filter((l) => pendingOf(l) > 0)
    .map((l) => `${containerText(pendingOf(l), l)} de ${l.name}`)
    .join(', ')
  const reason = await confirmStore.askReason({
    title: `¿Cerrar lo pendiente de ${p.code}?`,
    message: `No llegará: ${missing}. Lo ya recibido se queda en el stock y la compra deja de esperar recepciones.`,
    confirmLabel: 'Cerrar lo pendiente',
    icon: 'fa-box-archive',
    reason: {
      label: 'Motivo (obligatorio)',
      suggestions: ['El proveedor no tiene más', 'Llegó roto y no se repone', 'Se factura aparte'],
    },
  })
  if (!reason) return
  try {
    const updated = await apiCancelPurchase(p._id, reason)
    play('success')
    toast.success(`${updated.code} cerrada con faltante`)
    purchases.value = purchases.value.map((x) => (x._id === updated._id ? updated : x))
    if (current.value?._id === updated._id) current.value = updated
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  }
}

function receiptLines(p: Purchase, r: Purchase['receipts'][number]): string {
  return r.lines
    .map((l) => {
      const line = p.lines[l.index]
      return line ? `${line.name}: ${containerText(toContainers(l.qty, line), line)}` : ''
    })
    .filter(Boolean)
    .join(' · ')
}
</script>

<template>
  <section class="flow">
    <FlowHeader
      title="Recibir mercadería"
      icon="fa-box-open"
      :steps="current ? ['Elegir compra', 'Marcar lo que llegó', 'Confirmar'] : undefined"
      :current="reviewing ? 2 : current ? 1 : 0"
      :back-label="current ? 'Compras' : 'Bodega'"
      @back="current ? closeDetail() : emit('back')"
      @go="(i) => i === 0 && closeDetail()"
    />

    <Transition name="slide" mode="out-in">
      <!-- Lista de compras -->
      <div v-if="!current" key="list" class="pane">
        <div class="chips">
          <button type="button" class="chip" :class="{ on: filter === 'pendientes' }" @click="filter = 'pendientes'">
            Por recibir ({{ pendingCount }})
          </button>
          <button type="button" class="chip" :class="{ on: filter === 'todas' }" @click="filter = 'todas'">
            Todas
          </button>
        </div>

        <SkeletonList v-if="loading" variant="card" :rows="3" />
        <div v-else-if="!visible.length" class="card empty-state">
          <i class="fa-solid fa-inbox" aria-hidden="true" />
          <p>{{ filter === 'pendientes' ? 'No hay compras por recibir.' : 'Aún no hay compras registradas.' }}</p>
        </div>
        <TransitionGroup v-else tag="div" name="line" class="lines">
          <button
            v-for="p in visible"
            :key="p._id"
            type="button"
            class="card purchase"
            @click="open(p)"
          >
            <span class="purchase-top">
              <strong>{{ p.code }} · {{ p.supplier }}</strong>
              <StatusPill :status="p.status" />
            </span>
            <span class="purchase-meta">
              <span><i class="fa-solid fa-file-lines" aria-hidden="true" /> {{ p.document }}</span>
              <span v-if="p.documentDate"><i class="fa-regular fa-calendar" aria-hidden="true" /> {{ formatDate(p.documentDate) }}</span>
              <span><i class="fa-solid" :class="p.destination === 'bodega' ? 'fa-warehouse' : 'fa-ship'" aria-hidden="true" /> {{ LOCATION_LABEL[p.destination] }}</span>
              <span v-if="p.total"><i class="fa-solid fa-dollar-sign" aria-hidden="true" /> {{ formatMoney(p.total) }}</span>
            </span>
            <span class="purchase-items">
              {{ p.lines.map((l) => `${l.name} (${containerText(l.containers, l)})`).join(', ') }}
            </span>
            <span class="purchase-progress">
              {{ progress(p) }}
              <i class="fa-solid fa-chevron-right" aria-hidden="true" />
            </span>
          </button>
        </TransitionGroup>
      </div>

      <!-- Detalle: marcar lo que llegó -->
      <div v-else key="detail" class="pane">
        <div class="card context">
          <strong>{{ current.code }}</strong>
          <span><i class="fa-solid fa-truck" aria-hidden="true" /> {{ current.supplier }}</span>
          <span><i class="fa-solid fa-file-lines" aria-hidden="true" /> {{ current.document }}</span>
          <span><i class="fa-solid fa-location-dot" aria-hidden="true" /> Llega a {{ LOCATION_LABEL[current.destination].toLowerCase() }}</span>
          <StatusPill :status="current.status" />
        </div>

        <p v-if="current.status === 'anulada'" class="lead">
          Anulada: {{ current.cancelReason }}
        </p>
        <p v-else-if="current.status === 'cerrada'" class="lead">
          Cerrada con faltante: {{ current.cancelReason }}
        </p>

        <template v-if="canReceive">
          <p class="lead">
            Cuenta lo que llegó físicamente. Ya viene marcado lo pendiente; baja la cantidad si llegó menos.
          </p>
          <div class="chips">
            <button type="button" class="chip" @click="setAll(true)">
              <i class="fa-solid fa-check-double" aria-hidden="true" /> Llegó todo
            </button>
            <button type="button" class="chip" @click="setAll(false)">
              <i class="fa-solid fa-eraser" aria-hidden="true" /> Poner todo en cero
            </button>
          </div>
        </template>

        <div class="lines">
          <article v-for="(line, i) in current.lines" :key="i" class="card line">
            <header class="line-head">
              <strong>{{ line.name }}</strong>
              <span class="line-sub">
                Facturado {{ containerText(line.containers, line) }} · recibido {{ containerText(receivedOf(line), line) }}
              </span>
            </header>
            <div v-if="canReceive && pendingOf(line) > 0" class="line-body">
              <div class="line-qty">
                <span class="mini-label">Llegó ahora ({{ missingText(containerText(pendingOf(line), line), pendingOf(line)) }})</span>
                <QtyStepper
                  :model-value="arrived[i] ?? 0"
                  :min="0"
                  allow-zero
                  :max="pendingOf(line)"
                  :label="`${plural(line.containerLabel, 2)} de ${line.name} que llegaron`"
                  :unit="plural(line.containerLabel, arrived[i] ?? 0)"
                  @update:model-value="(v: number) => (arrived[i] = v)"
                />
                <span v-if="Number.isFinite(arrived[i] ?? 0) && (arrived[i] ?? 0) >= 0" class="conv">{{ conversionText(arrived[i] ?? 0, line) }}</span>
              </div>
            </div>
            <p v-else-if="pendingOf(line) <= 0" class="done-line">
              <i class="fa-solid fa-circle-check" aria-hidden="true" /> Completo
            </p>
          </article>
        </div>

        <div v-if="canReceive" class="field">
          <label for="pr-note">Nota (opcional)</label>
          <input id="pr-note" v-model="note" type="text" placeholder="Ej. 1 botella llegó rota, se reclama" />
        </div>

        <div v-if="current.receipts.length" class="card receipts">
          <h3 class="receipts-title">Recepciones anteriores</h3>
          <ul>
            <li v-for="r in current.receipts" :key="r.key">
              <strong>{{ formatDateTime(r.at) }} · {{ personName(r.by) }}</strong>
              <span>{{ receiptLines(current, r) }}</span>
              <small v-if="r.note">{{ r.note }}</small>
            </li>
          </ul>
        </div>

        <div class="footer">
          <button type="button" class="btn btn-ghost big" @click="closeDetail">
            <i class="fa-solid fa-arrow-left" aria-hidden="true" /> Compras
          </button>
          <button v-if="canReceive" type="button" class="btn btn-gold big" :disabled="!picks.length" @click="review">
            Revisar y recibir <i class="fa-solid fa-arrow-right" aria-hidden="true" />
          </button>
          <button
            v-if="userStore.isWarehouse && current.status === 'registrada' && !current.receipts.length"
            type="button"
            class="btn btn-ghost big danger"
            @click="cancelPurchase(current)"
          >
            <i class="fa-solid fa-ban" aria-hidden="true" /> Anular factura
          </button>
          <button
            v-if="userStore.isWarehouse && current.status === 'recibida_parcial'"
            type="button"
            class="btn btn-ghost big"
            @click="closePending(current)"
          >
            <i class="fa-solid fa-box-archive" aria-hidden="true" /> Cerrar lo pendiente
          </button>
        </div>
      </div>
    </Transition>

    <SummaryModal
      v-if="reviewing && current"
      title="Confirmar recepción"
      confirm-label="Recibir"
      :state="save.state.value"
      :message="save.message.value"
      :offline="save.offline.value"
      :saved-text="`Guardado · ${current.code} ${current.status === 'recibida' ? 'recibida completa' : 'recibida parcial'}`"
      :notice="`Se suma a ${LOCATION_LABEL[current.destination].toLowerCase()} con su costo. ${willComplete ? 'La compra queda completa.' : 'Lo que falta queda pendiente para otra recepción.'}`"
      @confirm="confirm"
      @close="reviewing = false"
      @done="done"
    >
      <ul class="sum-lines">
        <li v-for="x in picks" :key="x.index">
          <span>
            <strong>{{ x.line.name }}</strong>
            <small>{{ conversionText(x.containers, x.line) }}</small>
          </span>
          <span class="sum-money">
            <strong>+{{ containerText(x.containers, x.line) }}</strong>
          </span>
        </li>
      </ul>
    </SummaryModal>
  </section>
</template>

<style scoped lang="scss">
@use './flow' as *;

.purchase {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  text-align: left;
  width: 100%;
  transition:
    transform 0.12s ease,
    box-shadow 0.15s ease;

  &:active {
    transform: scale(0.99);
  }
}

.purchase-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;

  strong {
    font-size: 1.02rem;
  }
}

.purchase-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 1rem;
  font-size: 0.85rem;
  color: var(--ink-600);

  i {
    color: var(--gold-500);
    margin-right: 0.2rem;
  }
}

.purchase-items {
  font-size: 0.85rem;
  color: var(--ink-400);
}

.purchase-progress {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--navy-700);

  i {
    color: var(--gold-500);
  }
}

.line-head {
  flex-wrap: wrap;
}

.line-sub {
  flex-basis: 100%;
}

.done-line {
  margin: 0;
  color: var(--success);
  font-weight: 700;
}

.receipts {
  padding: 0.9rem 1rem;

  ul {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    font-size: 0.88rem;
  }

  small {
    color: var(--ink-400);
  }
}

.receipts-title {
  font-size: 1rem;
}

.danger {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
