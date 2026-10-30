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
  apiBonifyConsumption,
  apiCollectCabin,
  apiOrders,
  apiProforma,
  apiReviewAnnulment,
  apiUndoConsumption,
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
const proformaBusy = shallowRef<'' | 'ver' | 'descargar'>('')

const STATUS_LABEL: Record<string, string> = {
  abierta: 'Abierta',
  en_revision: 'En revisión',
  aprobada: 'Aprobada',
  cobrada: 'Pagada',
}

const ACTION_LABEL: Record<string, string> = {
  creada: 'Cuenta abierta',
  cargo_cambiado: 'Cargo actualizado',
  enviada_revision: 'Enviada a revisión',
  aprobada: 'Aprobada',
  devuelta: 'Devuelta con motivo',
  invalidada: 'Aprobación sin efecto',
  cobrada: 'Pagada',
  reversada: 'Pago reversado',
}

const METHOD_OPTIONS = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'online', label: 'Pago en línea' },
]

const payer = computed(
  () => props.cabin.passengers.find((p) => p.isPayer) ?? props.cabin.passengers[0] ?? null,
)

const billing = reactive({ idNumber: '', email: '', country: '', name: '' })
const method = shallowRef('efectivo')
const cashConfirmed = shallowRef(false)
/** Voucher, número de transferencia… (obligatorio en transferencias). */
const reference = shallowRef('')

/** Solo se piden los datos que el pagador no tiene registrados. */
const missing = computed(() => ({
  name: !payer.value?.name,
  idNumber: !payer.value?.idNumber,
  email: !payer.value?.email,
  country: !payer.value?.country,
}))

function linesOf(orders: AccountSummary['orders']) {
  return orders.flatMap((order) =>
    order.items
      .filter((i) => i.chargeableQty > 0)
      .map((i) => ({ ...i, orderId: order.id, by: order.by, at: order.createdAt, single: order.items.length === 1 })),
  )
}

const deliveredLines = computed(() => linesOf(account.value?.orders ?? []))
/** Lo ya pagado se conserva: productos, pagos e historial (checklist 29-oct, 01). */
const paidLines = computed(() => linesOf(account.value?.paidOrders ?? []))
const neverCharged = computed(() => !deliveredLines.value.length && !paidLines.value.length)

const INVOICE_LABEL: Record<string, string> = {
  pendiente: 'Factura pendiente',
  emitiendo: 'Emitiendo factura…',
  emitida: 'Factura emitida',
  error: 'Factura pendiente',
  no_aplica: 'Sin factura',
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const emailError = computed(() =>
  billing.email.trim() && !EMAIL.test(billing.email.trim()) ? 'Revisa el correo. Ejemplo: nombre@dominio.com.' : '',
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
    !emailError.value &&
    (method.value !== 'efectivo' || cashConfirmed.value) &&
    (method.value !== 'transferencia' || reference.value.trim()),
)

/** Dirección corrige: cortesía (se sirvió) o deshacer registro por error (no se sirvió). */
const canCorrect = computed(() => userStore.isDirector && account.value?.status !== 'cobrada')
const isBar = computed(() => userStore.role === 'bartender')

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
    toast.success('Cuenta enviada a revisión')
  })
}

function approve() {
  return run(async () => {
    account.value = await apiAccountAction(props.cruiseId, props.cabin.number, 'approve')
    toast.success('Cuenta aprobada. Lista para cobrar.')
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

async function bonify(line: { orderId: string; name: string; chargeableQty: number }) {
  const reason = await confirmStore.askReason({
    title: `¿Marcar ${line.chargeableQty} ${line.name} como cortesía?`,
    message: 'Deja de cobrarse, pero se sirvió: los ingredientes siguen descontados. La aprobación de la cuenta queda sin efecto.',
    confirmLabel: 'Marcar como cortesía',
    icon: 'fa-gift',
    reason: { label: 'Motivo (obligatorio)', suggestions: ['Cortesía de la casa', 'Compensación al pasajero'] },
  })
  if (!reason) return
  await run(async () => {
    await apiBonifyConsumption(line.orderId, reason)
    toast.success('Marcada como cortesía')
  })
}

async function removeLine(line: { orderId: string; name: string; chargeableQty: number }) {
  if (account.value?.status !== 'abierta') {
    toast.error('Devuelve primero la cuenta (Devolver con motivo) para corregirla')
    return
  }
  const reason = await confirmStore.askReason({
    title: `¿Deshacer ${line.chargeableQty} ${line.name} registrado por error?`,
    message: 'Se quitará el cargo y se devolverán los ingredientes porque la bebida no se sirvió.',
    confirmLabel: 'Deshacer registro',
    danger: true,
    icon: 'fa-rotate-left',
    reason: { label: 'Motivo (obligatorio)', suggestions: ['No se sirvió', 'Cabina equivocada'] },
  })
  if (!reason) return
  await run(async () => {
    await apiUndoConsumption(line.orderId, reason)
    toast.success('Registro deshecho: cargo quitado e ingredientes devueltos')
  })
}

async function collect() {
  if (!account.value) return
  const ok = await confirmStore.ask({
    title: `¿Cobrar ${formatMoney(account.value.total)} a cabina ${props.cabin.number}?`,
    message: `Método: ${METHOD_OPTIONS.find((m) => m.value === method.value)?.label}. Factura a nombre de ${billing.name || payer.value?.name}.`,
    confirmLabel: 'Cobrar',
    icon: 'fa-cash-register',
  })
  if (!ok) return
  await run(async () => {
    const payment = await apiCollectCabin({
      cruiseId: props.cruiseId,
      cabinNumber: props.cabin.number,
      method: method.value as PaymentMethod,
      cashConfirmed: cashConfirmed.value,
      reference: reference.value.trim() || undefined,
      billing: {
        name: billing.name || undefined,
        idNumber: billing.idNumber || undefined,
        email: billing.email || undefined,
        country: billing.country || undefined,
      },
    })
    // Pago y factura son estados separados: nunca se afirma una emisión pendiente (L03).
    if (payment?.invoiceStatus === 'emitida') {
      toast.success(`Pago registrado. Factura ${payment.invoiceNumber ?? ''} emitida.`)
    } else {
      toast.success(`Pago registrado · cabina ${props.cabin.number}`)
      toast.push(
        `Factura pendiente. ${payment?.invoiceError || 'Reintenta la emisión desde Cobros.'}`,
        payment?.invoiceStatus === 'error' ? 'error' : 'info',
      )
    }
  }, 'cash')
}

/**
 * Prefactura en inglés: "Ver" la abre en otra pestaña (se reserva antes de
 * pedirla para que el navegador no la bloquee); "Descargar" guarda el PDF.
 */
async function openProforma(download: boolean) {
  if (proformaBusy.value) return
  const tab = download ? null : window.open('', '_blank')
  proformaBusy.value = download ? 'descargar' : 'ver'
  try {
    const { blob, fileName } = await apiProforma(props.cruiseId, props.cabin.number, download)
    const url = URL.createObjectURL(blob)
    if (tab) {
      tab.location.href = url
    } else {
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (err) {
    tab?.close()
    toast.error(apiErrorMessage(err))
  } finally {
    proformaBusy.value = ''
  }
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
        <strong class="acc-total">{{ formatMoney(account.status === 'cobrada' ? account.consumed : account.total) }}</strong>
      </header>

      <!-- Cuenta completa: lo pagado no desaparece (checklist 29-oct, 01) -->
      <dl v-if="!isBar && !neverCharged" class="acc-sums">
        <div>
          <dt>Consumos</dt>
          <dd>{{ formatMoney(account.consumed) }}</dd>
        </div>
        <div>
          <dt>Pagado</dt>
          <dd>{{ formatMoney(account.paid) }}</dd>
        </div>
        <div :class="{ 'acc-sums--due': account.due > 0 }">
          <dt>Por cobrar</dt>
          <dd>{{ formatMoney(account.due) }}</dd>
        </div>
      </dl>

      <p v-if="account.pendingDeliveries" class="warn">
        <i class="fa-solid fa-hourglass-half" aria-hidden="true" />
        Hay {{ account.pendingDeliveries }} bebida(s) sin entregar. Entrégalas o cancélalas en el Bar
        antes de enviar a revisión.
      </p>

      <!-- Consumos entregados con su autor -->
      <section class="lines">
        <p v-if="neverCharged" class="muted">Sin consumos en esta cuenta.</p>
        <p v-else-if="!deliveredLines.length" class="muted">Sin consumos por cobrar.</p>
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
          <div v-if="canCorrect && line.single" class="line-actions">
            <button v-if="!line.courtesy" type="button" class="line-btn" :disabled="busy" @click="bonify(line)">
              <i class="fa-solid fa-gift" aria-hidden="true" /> Marcar como cortesía
            </button>
            <button type="button" class="line-btn line-btn--danger" :disabled="busy" @click="removeLine(line)">
              <i class="fa-solid fa-rotate-left" aria-hidden="true" /> Deshacer registro por error
            </button>
          </div>
        </div>
        <p v-if="account.courtesyTotal" class="muted small">
          Cortesías registradas: {{ formatMoney(account.courtesyTotal) }}
        </p>
      </section>

      <!-- Consumos ya pagados y sus pagos: solo lectura -->
      <section v-if="paidLines.length || account.payments.length" class="paid">
        <h4><i class="fa-solid fa-circle-check" aria-hidden="true" /> Pagado</h4>
        <div v-for="line in paidLines" :key="`p-${line.orderId}-${line.index}`" class="line line--paid">
          <div class="line-main">
            <span class="line-name">
              {{ line.chargeableQty }} × {{ line.name }}
              <em v-if="line.courtesy" class="tag-courtesy">cortesía</em>
            </span>
            <span class="line-meta">
              <i class="fa-regular fa-user" aria-hidden="true" /> {{ line.by }} · {{ formatDateTime(line.at) }}
            </span>
          </div>
          <span class="line-amount">{{ formatMoney(line.courtesy ? 0 : line.chargeableQty * line.unitPrice) }}</span>
        </div>
        <ul v-if="!isBar" class="payments">
          <li v-for="p in account.payments" :key="p.id">
            <span>
              <strong>Pago registrado</strong> · {{ METHOD_OPTIONS.find((m) => m.value === p.method)?.label ?? p.method }} ·
              {{ formatDateTime(p.createdAt) }}
              <small :class="`invoice invoice--${p.invoiceStatus}`">
                {{ INVOICE_LABEL[p.invoiceStatus] ?? p.invoiceStatus }}{{ p.invoiceNumber ? ` ${p.invoiceNumber}` : '' }}{{
                  p.invoiceStatus !== 'emitida' && p.invoiceError ? `. ${p.invoiceError}` : ''
                }}
              </small>
            </span>
            <strong>{{ formatMoney(p.total) }}</strong>
          </li>
        </ul>
      </section>

      <!-- Prefactura en inglés: antes y después de pagar, sin correo ni Contífico -->
      <div v-if="userStore.isDirector && !neverCharged" class="proforma">
        <button type="button" class="btn btn-ghost" :disabled="Boolean(proformaBusy)" @click="openProforma(false)">
          <i class="fa-regular fa-file-lines" aria-hidden="true" />
          {{ proformaBusy === 'ver' ? 'Abriendo…' : 'Ver prefactura' }}
        </button>
        <button type="button" class="btn btn-ghost" :disabled="Boolean(proformaBusy)" @click="openProforma(true)">
          <i class="fa-solid fa-file-arrow-down" aria-hidden="true" />
          {{ proformaBusy === 'descargar' ? 'Descargando…' : 'Descargar prefactura en inglés' }}
        </button>
      </div>

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
          Cuenta en revisión.
        </p>
      </div>

      <!-- Cobro: bloqueado hasta aprobar -->
      <section v-if="account.status !== 'cobrada' && !isBar" class="collect" :class="{ 'collect--locked': !account.readyToCollect }">
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
            <input
              id="bill-email"
              v-model="billing.email"
              type="email"
              :aria-invalid="Boolean(emailError)"
              aria-describedby="bill-email-error"
            />
            <Transition name="fade">
              <small v-if="emailError" id="bill-email-error" class="field-error">{{ emailError }}</small>
            </Transition>
          </div>
          <div v-if="missing.country" class="field">
            <label>País (opcional)</label>
            <BaseSelect v-model="billing.country" :options="COUNTRY_OPTIONS" searchable placeholder="Buscar país…" />
          </div>
          <div class="field">
            <label>Método de pago</label>
            <BaseSelect v-model="method" :options="METHOD_OPTIONS" />
          </div>
          <div v-if="method !== 'efectivo'" class="field">
            <label for="pay-ref">Referencia {{ method === 'transferencia' ? '(obligatoria)' : '(voucher, opcional)' }}</label>
            <input id="pay-ref" v-model="reference" type="text" maxlength="40" placeholder="Número de transferencia o voucher" />
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
          Aprobada. Lista para cobrar.
        </p>
      </section>

      <button type="button" class="btn btn-ghost qr-toggle" @click="showQr = !showQr">
        <i class="fa-solid fa-qrcode" aria-hidden="true" />
        {{ showQr ? 'Ocultar QR' : 'Mostrar QR para el pasajero' }}
      </button>
      <Transition name="fade">
        <div v-if="showQr" class="qr-box">
          <QrCanvas :text="publicUrl" :size="220" />
          <p>El pasajero escanea y ve su cuenta en inglés: total, pagos y saldo.</p>
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
.line-actions {
  display: flex;
  gap: 0.4rem;
  width: 100%;
  justify-content: flex-start;
  margin-top: 0.35rem;
}

.line-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 44px;
  padding: 0 0.75rem;
  border-radius: 10px;
  border: 1.5px solid var(--cream-200);
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--gold-500);
  transition:
    border-color 0.15s ease,
    opacity 0.15s ease;

  &:hover:not(:disabled) {
    border-color: currentColor;
  }

  &:disabled {
    opacity: 0.4;
  }

  &--danger {
    color: var(--danger);
  }
}

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

.acc-sums {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin: 0;

  div {
    padding: 0.55rem 0.7rem;
    border-radius: var(--radius-sm);
    background: var(--cream-100);
    min-width: 0;
  }

  dt {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-400);
  }

  dd {
    margin: 0.1rem 0 0;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  &--due dd {
    color: var(--warning);
  }
}

.paid {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;

  h4 {
    margin: 0;
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--ink-600);

    i {
      color: var(--success);
    }
  }
}

.line--paid {
  opacity: 0.8;
}

.payments {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  font-size: 0.86rem;

  li {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
  }

  small {
    display: block;
  }
}

.invoice {
  font-weight: 600;
  color: var(--warning);

  &--emitida {
    color: var(--success);
  }

  &--error {
    color: var(--danger);
  }
}

.proforma {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 0.5rem;
}

.field-error {
  color: var(--danger);
  font-weight: 600;
  font-size: 0.8rem;
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
  flex-wrap: wrap;
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
