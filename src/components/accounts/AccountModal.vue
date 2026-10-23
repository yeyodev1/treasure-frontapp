<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from 'vue'
import type { AccountSummary, Cabin, Order, PaymentMethod } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import QrCanvas from '@/components/ui/QrCanvas.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import { useUserStore } from '@/stores/user'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import {
  apiAccountAction,
  apiCabinAccount,
  apiCollectCabin,
  apiOrders,
  apiReviewAnnulment,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { COUNTRY_OPTIONS } from '@/utils/countries'
import { formatDateTime, formatMoney } from '@/utils/format'

const props = defineProps<{ cruiseId: string; cabin: Cabin }>()
const emit = defineEmits<{ close: []; changed: [] }>()

const userStore = useUserStore()
const confirmStore = useConfirmStore()
const toast = useToastStore()
const { play } = useSound()

const account = shallowRef<AccountSummary | null>(null)
const annulmentOrders = shallowRef<Order[]>([])
const loading = shallowRef(true)
const busy = shallowRef(false)
const showQr = shallowRef(false)

const STATUS_LABEL: Record<string, string> = {
  abierta: 'Abierta',
  en_revision: 'En revisión',
  aprobada: 'Aprobada',
  cobrada: 'Cobrada',
}

const ACTION_LABEL: Record<string, string> = {
  creada: 'Cuenta abierta',
  cargo_cambiado: 'Cargo actualizado',
  enviada_revision: 'Enviada a revisión',
  aprobada: 'Aprobada',
  devuelta: 'Devuelta con motivo',
  invalidada: 'Aprobación sin efecto',
  cobrada: 'Cobrada',
  reversada: 'Cobro reversado',
}

const METHOD_OPTIONS = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'tarjeta', label: 'Tarjeta (datafast físico)' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'online', label: 'Pago en línea' },
]

const payer = computed(
  () => props.cabin.passengers.find((p) => p.isPayer) ?? props.cabin.passengers[0] ?? null,
)

const billing = reactive({ idNumber: '', email: '', country: '', name: '' })
const method = shallowRef('efectivo')
const cashConfirmed = shallowRef(false)

/** Solo se piden los datos que el pagador no tiene registrados. */
const missing = computed(() => ({
  name: !payer.value?.name,
  idNumber: !payer.value?.idNumber,
  email: !payer.value?.email,
  country: !payer.value?.country,
}))

const deliveredLines = computed(() =>
  (account.value?.orders ?? []).flatMap((order) =>
    order.items
      .filter((i) => i.chargeableQty > 0)
      .map((i) => ({ ...i, orderId: order.id, by: order.by, at: order.createdAt })),
  ),
)

const publicUrl = computed(() => `${window.location.origin}/cuenta/${props.cabin.accountToken}`)

const canSubmit = computed(
  () => account.value?.status === 'abierta' && (account.value?.orders.length ?? 0) > 0,
)
const canReview = computed(() => userStore.isLead && account.value?.status === 'en_revision')
const canReturn = computed(
  () =>
    userStore.isLead &&
    (account.value?.status === 'en_revision' || account.value?.status === 'aprobada'),
)
const collectReady = computed(
  () =>
    Boolean(account.value?.readyToCollect) &&
    (!missing.value.idNumber || billing.idNumber.trim()) &&
    (!missing.value.name || billing.name.trim()) &&
    (method.value !== 'efectivo' || cashConfirmed.value),
)

async function load() {
  try {
    const [acc, ann] = await Promise.all([
      apiCabinAccount(props.cruiseId, props.cabin.number),
      apiOrders({ cruiseId: props.cruiseId, cabinNumber: props.cabin.number, annulment: 'pendiente' }),
    ])
    account.value = acc
    annulmentOrders.value = ann.orders
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function run(action: () => Promise<void>, successSound: 'success' | 'cash' = 'success') {
  busy.value = true
  try {
    await action()
    play(successSound)
    emit('changed')
    await load()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

function submitReview() {
  return run(async () => {
    account.value = await apiAccountAction(props.cruiseId, props.cabin.number, 'submit')
    toast.success('Cuenta enviada a revisión de Dirección')
  })
}

function approve() {
  return run(async () => {
    account.value = await apiAccountAction(props.cruiseId, props.cabin.number, 'approve')
    toast.success('Cuenta aprobada: lista para cobrar')
  })
}

async function giveBack() {
  const reason = await confirmStore.askReason({
    title: `¿Devolver la cuenta de cabina ${props.cabin.number}?`,
    message: 'El bar la corrige y la vuelve a enviar. El cobro queda bloqueado.',
    confirmLabel: 'Devolver',
    icon: 'fa-clipboard-check',
    reason: {
      label: 'Motivo (obligatorio)',
      suggestions: ['Falta un consumo', 'Cargo equivocado', 'Revisar cortesía'],
    },
  })
  if (!reason) return
  await run(async () => {
    account.value = await apiAccountAction(props.cruiseId, props.cabin.number, 'return', reason)
    toast.success('Cuenta devuelta con motivo')
  })
}

async function reviewAnnulment(order: Order, annulmentId: string, decision: 'aprobar' | 'rechazar', restock: boolean) {
  const annulment = order.annulments.find((a) => a._id === annulmentId)!
  const item = order.items[annulment.index]!
  const ok = await confirmStore.ask({
    title:
      decision === 'aprobar'
        ? `¿Anular ${annulment.qty} ${item.name}?`
        : `¿Rechazar la anulación de ${item.name}?`,
    message:
      decision === 'aprobar'
        ? restock
          ? 'Sale de la cuenta y vuelve al inventario a bordo.'
          : 'Sale de la cuenta. El inventario no cambia (ya se sirvió).'
        : 'El cargo se mantiene en la cuenta.',
    confirmLabel: decision === 'aprobar' ? 'Anular' : 'Rechazar',
    danger: decision === 'aprobar',
    icon: 'fa-rotate-left',
  })
  if (!ok) return
  await run(async () => {
    await apiReviewAnnulment(order._id, annulmentId, decision, restock)
    toast.success(decision === 'aprobar' ? 'Anulación aprobada' : 'Anulación rechazada')
  })
}

async function collect() {
  if (!account.value) return
  const ok = await confirmStore.ask({
    title: `¿Cobrar ${formatMoney(account.value.total)} a cabina ${props.cabin.number}?`,
    message: `Método: ${METHOD_OPTIONS.find((m) => m.value === method.value)?.label}. Se emite la factura a nombre de ${billing.name || payer.value?.name}.`,
    confirmLabel: 'Cobrar',
    icon: 'fa-cash-register',
  })
  if (!ok) return
  await run(async () => {
    await apiCollectCabin({
      cruiseId: props.cruiseId,
      cabinNumber: props.cabin.number,
      method: method.value as PaymentMethod,
      cashConfirmed: cashConfirmed.value,
      billing: {
        name: billing.name || undefined,
        idNumber: billing.idNumber || undefined,
        email: billing.email || undefined,
        country: billing.country || undefined,
      },
    })
    toast.success(`Cabina ${props.cabin.number} cobrada`)
  }, 'cash')
}
</script>

<template>
  <BaseModal
    :title="`Cabina ${cabin.number}${account ? ` · Cuenta v${account.version}` : ''}`"
    @close="emit('close')"
  >
    <SkeletonList v-if="loading" variant="row" :rows="5" />

    <div v-else-if="account" class="acc">
      <header class="acc-state" :class="`acc-state--${account.status}`">
        <span class="acc-status">{{ STATUS_LABEL[account.status] }}</span>
        <strong class="acc-total">{{ formatMoney(account.total) }}</strong>
      </header>

      <p v-if="account.pendingDeliveries" class="warn">
        <i class="fa-solid fa-hourglass-half" aria-hidden="true" />
        Hay {{ account.pendingDeliveries }} bebida(s) sin entregar. Entrégalas o cancélalas en el Bar
        antes de enviar a revisión.
      </p>

      <!-- Consumos entregados con su autor -->
      <section class="lines">
        <p v-if="!deliveredLines.length" class="muted">Sin consumos en esta cuenta.</p>
        <div v-for="line in deliveredLines" :key="`${line.orderId}-${line.index}`" class="line">
          <div class="line-main">
            <span class="line-name">
              {{ line.chargeableQty }} × {{ line.name }}
              <em v-if="line.courtesy" class="tag-courtesy">cortesía</em>
              <em v-if="line.pendingQty" class="tag-pending">{{ line.pendingQty }} por entregar</em>
            </span>
            <span class="line-meta">
              <i class="fa-regular fa-user" aria-hidden="true" /> {{ line.by }} ·
              {{ formatDateTime(line.at) }}
            </span>
          </div>
          <span class="line-amount">
            {{ formatMoney(line.courtesy ? 0 : line.chargeableQty * line.unitPrice) }}
          </span>
        </div>
        <p v-if="account.courtesyTotal" class="muted small">
          Cortesías registradas: {{ formatMoney(account.courtesyTotal) }}
        </p>
      </section>

      <!-- Anulaciones pendientes de revisión -->
      <section v-if="annulmentOrders.length && userStore.isLead" class="annulments">
        <h4><i class="fa-solid fa-rotate-left" aria-hidden="true" /> Anulaciones por revisar</h4>
        <template v-for="order in annulmentOrders" :key="order._id">
          <div
            v-for="a in order.annulments.filter((x) => x.status === 'pendiente')"
            :key="a._id"
            class="annulment"
          >
            <div>
              <strong>{{ a.qty }} × {{ order.items[a.index]?.name }}</strong>
              <p class="muted small">
                {{ a.reason }} · pidió {{ typeof a.requestedBy === 'object' ? a.requestedBy.name : '' }}
              </p>
            </div>
            <div class="annulment-actions">
              <button type="button" class="btn btn-ghost" :disabled="busy" @click="reviewAnnulment(order, a._id, 'rechazar', false)">
                Rechazar
              </button>
              <button type="button" class="btn btn-primary" :disabled="busy" @click="reviewAnnulment(order, a._id, 'aprobar', false)">
                Anular
              </button>
              <button
                v-if="userStore.isAdmin"
                type="button"
                class="btn btn-gold"
                :disabled="busy"
                @click="reviewAnnulment(order, a._id, 'aprobar', true)"
              >
                Anular y devolver al stock
              </button>
            </div>
          </div>
        </template>
      </section>

      <!-- Pagador: datos recuperados del pasajero -->
      <section class="payer">
        <p v-if="payer">
          <i class="fa-solid fa-user-tie" aria-hidden="true" />
          Pagador: <strong>{{ payer.name }}</strong>
        </p>
        <p v-else class="warn-text">
          <i class="fa-solid fa-user-slash" aria-hidden="true" /> Sin pasajeros registrados en esta cabina.
        </p>
        <p v-if="payer" class="muted small">
          {{ payer.email ? 'Correo recuperado' : 'Sin correo' }} ·
          {{ payer.country ? `País: ${payer.country}` : 'Sin país' }} ·
          {{ payer.idNumber ? 'Identificación recuperada' : 'Completar identificación pendiente' }}
        </p>
      </section>

      <!-- Acciones del flujo según rol y estado -->
      <div class="flow">
        <button
          v-if="canSubmit"
          type="button"
          class="btn btn-primary"
          :disabled="busy || account.pendingDeliveries > 0"
          @click="submitReview"
        >
          <i class="fa-solid fa-paper-plane" aria-hidden="true" /> Enviar a revisión
        </button>
        <div v-if="canReview || canReturn" class="flow-pair">
          <button v-if="canReturn" type="button" class="btn btn-return" :disabled="busy" @click="giveBack">
            <i class="fa-solid fa-clipboard-check" aria-hidden="true" /> Devolver con motivo
          </button>
          <button v-if="canReview" type="button" class="btn btn-primary" :disabled="busy" @click="approve">
            <i class="fa-solid fa-shield-halved" aria-hidden="true" /> Aprobar cuenta
          </button>
        </div>
        <p v-if="account.status === 'en_revision' && !userStore.isLead" class="muted small">
          Dirección está revisando esta cuenta.
        </p>
      </div>

      <!-- Cobro: bloqueado hasta aprobar -->
      <section v-if="account.status !== 'cobrada'" class="collect" :class="{ 'collect--locked': !account.readyToCollect }">
        <h4>
          <i class="fa-solid fa-receipt" aria-hidden="true" />
          {{ account.readyToCollect ? 'Facturar y cobrar' : 'Facturar / cobrar · Bloqueado hasta aprobar' }}
        </h4>

        <template v-if="account.readyToCollect && userStore.canCollect">
          <div v-if="missing.name" class="field">
            <label for="bill-name">Nombre para la factura</label>
            <input id="bill-name" v-model="billing.name" type="text" />
          </div>
          <div v-if="missing.idNumber" class="field">
            <label for="bill-id">Cédula / pasaporte / RUC del pagador</label>
            <input id="bill-id" v-model="billing.idNumber" type="text" />
          </div>
          <div v-if="missing.email" class="field">
            <label for="bill-email">Correo para la factura (opcional)</label>
            <input id="bill-email" v-model="billing.email" type="email" />
          </div>
          <div v-if="missing.country" class="field">
            <label>País (opcional)</label>
            <BaseSelect v-model="billing.country" :options="COUNTRY_OPTIONS" searchable placeholder="Buscar país…" />
          </div>
          <div class="field">
            <label>Método de pago</label>
            <BaseSelect v-model="method" :options="METHOD_OPTIONS" />
          </div>
          <label v-if="method === 'efectivo'" class="cash-check">
            <input v-model="cashConfirmed" type="checkbox" />
            Confirmo que el efectivo fue recaudado en caja
          </label>
          <button type="button" class="btn btn-gold" :disabled="!collectReady || busy" @click="collect">
            <i class="fa-solid fa-cash-register" aria-hidden="true" /> Cobrar {{ formatMoney(account.total) }}
          </button>
        </template>
        <p v-else-if="account.readyToCollect" class="muted small">
          Aprobada. Cobra Paula (o Dirección si fue designada como cajera).
        </p>
      </section>

      <button type="button" class="btn btn-ghost qr-toggle" @click="showQr = !showQr">
        <i class="fa-solid fa-qrcode" aria-hidden="true" />
        {{ showQr ? 'Ocultar QR' : 'Mostrar QR para el pasajero' }}
      </button>
      <Transition name="fade">
        <div v-if="showQr" class="qr-box">
          <QrCanvas :text="publicUrl" :size="220" />
          <p>El pasajero escanea y ve su consumo en su celular.</p>
        </div>
      </Transition>

      <!-- Historial de la cuenta -->
      <details class="history">
        <summary><i class="fa-solid fa-clock-rotate-left" aria-hidden="true" /> Historial de la cuenta</summary>
        <ol>
          <li v-for="(h, i) in [...account.history].reverse()" :key="i">
            <strong>{{ ACTION_LABEL[h.action] ?? h.action }}</strong>
            <span class="muted small">
              v{{ h.version }} · {{ h.by || 'Sistema' }} · {{ formatDateTime(h.at) }}
            </span>
            <span v-if="h.reason" class="small">{{ h.reason }}</span>
          </li>
        </ol>
      </details>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">
.acc {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.acc-state {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.85rem 1rem;
  border-radius: var(--radius-sm);
  background: var(--powder-100);

  &--en_revision {
    background: rgba(185, 128, 47, 0.14);
  }

  &--aprobada {
    background: rgba(63, 122, 87, 0.13);
  }

  &--cobrada {
    background: var(--navy-800);
    color: #fff;
  }
}

.acc-status {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.acc-total {
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
}

.warn {
  margin: 0;
  padding: 0.65rem 0.8rem;
  border-radius: var(--radius-sm);
  background: rgba(185, 128, 47, 0.12);
  color: #7a5219;
  font-size: 0.86rem;
  font-weight: 600;
}

.warn-text {
  color: var(--warning);
}

.lines {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.line {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding-bottom: 0.55rem;
  border-bottom: 1px dashed var(--cream-200);
}

.line-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.line-name {
  font-weight: 600;
}

.line-meta {
  font-size: 0.76rem;
  color: var(--ink-400);
}

.line-amount {
  font-weight: 700;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.tag-courtesy,
.tag-pending {
  font-style: normal;
  font-size: 0.7rem;
  font-weight: 700;
  margin-left: 0.35rem;
}

.tag-courtesy {
  color: var(--success);
}

.tag-pending {
  color: var(--warning);
}

.muted {
  margin: 0;
  color: var(--ink-400);
}

.small {
  font-size: 0.8rem;
}

.annulments {
  border: 1px solid rgba(185, 128, 47, 0.4);
  border-radius: var(--radius-sm);
  padding: 0.8rem;

  h4 {
    margin: 0 0 0.6rem;
    font-size: 0.9rem;
  }
}

.annulment {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0;

  & + & {
    border-top: 1px solid var(--cream-200);
  }
}

.annulment-actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;

  .btn {
    min-height: 40px;
    padding: 0.4rem 0.8rem;
    font-size: 0.82rem;
  }
}

.payer p {
  margin: 0;
}

.payer i {
  color: var(--gold-500);
  margin-right: 0.3rem;
}

.flow {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  > .btn {
    width: 100%;
  }
}

.flow-pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.5rem;
}

.btn-return {
  background: #8c5a1d;
  color: #fff;
}

.collect {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.9rem;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--cream-200);

  h4 {
    margin: 0;
    font-size: 0.92rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  &--locked {
    background: var(--cream-100);
    color: var(--ink-400);
  }
}

.cash-check {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.88rem;
  font-weight: 600;
  padding: 0.6rem;
  background: rgba(185, 128, 47, 0.1);
  border-radius: var(--radius-sm);

  input {
    width: 1.2rem;
    height: 1.2rem;
    accent-color: var(--navy-800);
  }
}

.qr-toggle {
  width: 100%;
}

.qr-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  background: var(--powder-100);
  border-radius: var(--radius-sm);

  p {
    margin: 0;
    font-size: 0.82rem;
    color: var(--ink-600);
    text-align: center;
  }
}

.history {
  border-top: 1px solid var(--cream-200);
  padding-top: 0.6rem;

  summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 0.88rem;
    color: var(--ink-600);
  }

  ol {
    list-style: none;
    margin: 0.6rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  li {
    display: flex;
    flex-direction: column;
    padding-left: 0.8rem;
    border-left: 2px solid var(--cream-200);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
