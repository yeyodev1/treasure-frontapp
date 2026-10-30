<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, shallowRef, useTemplateRef } from 'vue'
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
  apiResendSummary,
  apiReviewAnnulment,
  apiUndoConsumption,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { COUNTRY_OPTIONS } from '@/utils/countries'
import { dayKeyOf, formatDateTime, formatDayHeading, formatHour, formatMoney } from '@/utils/format'

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
  devuelta: 'Reabierta para modificar',
  invalidada: 'Aprobación anulada',
  cobrada: 'Pagada',
  pago_parcial: 'Pago parcial',
  reversada: 'Pago reversado',
  correo_enviado: 'Resumen enviado por correo',
  correo_no_enviado: 'Correo no enviado',
}

const METHOD_OPTIONS = [
  { value: 'efectivo', label: 'Efectivo', icon: 'fa-money-bill-wave' },
  { value: 'tarjeta', label: 'Tarjeta', icon: 'fa-credit-card' },
  { value: 'transferencia', label: 'Transferencia', icon: 'fa-building-columns' },
  { value: 'online', label: 'Pago en línea', icon: 'fa-globe' },
]

/**
 * Recorrido de la cuenta en tres pasos: Consumos (abierta o en revisión) →
 * Aprobada → Pagada. Solo informa; las reglas viven en el servidor.
 */
const steps = computed(() => {
  const status = account.value?.status ?? 'abierta'
  const at = status === 'cobrada' ? 2 : status === 'aprobada' ? 1 : 0
  return [
    { key: 'consumos', label: status === 'en_revision' ? 'En revisión' : 'Consumos', state: at > 0 ? 'done' : 'now' },
    { key: 'aprobada', label: 'Aprobada', state: at > 1 ? 'done' : at === 1 ? 'now' : 'next' },
    { key: 'pagada', label: 'Pagada', state: at === 2 ? 'done' : 'next' },
  ] as const
})

const payer = computed(
  () => props.cabin.passengers.find((p) => p.isPayer) ?? props.cabin.passengers[0] ?? null,
)

const billing = reactive({ idNumber: '', email: '', country: '', name: '' })
const method = shallowRef('efectivo')
const cashConfirmed = shallowRef(false)
/** Voucher, número de transferencia… (obligatorio en transferencias). */
const reference = shallowRef('')
/** Monto de este pago: por defecto el saldo; menor = pago parcial (P05). */
const amount = shallowRef('')
const amountValue = computed(() => Number(amount.value.replace(',', '.')))
const amountError = computed(() => {
  const due = account.value?.due ?? 0
  const value = amountValue.value
  if (!amount.value.trim() || !Number.isFinite(value) || Math.round(value * 100) <= 0) {
    return 'Introduce una cantidad mayor que cero.'
  }
  if (Math.round(value * 100) > Math.round(due * 100)) {
    return `No puede ser mayor que el saldo (${formatMoney(due)}).`
  }
  return ''
})
const isPartial = computed(
  () => !amountError.value && Math.round(amountValue.value * 100) < Math.round((account.value?.due ?? 0) * 100),
)

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

type Line = ReturnType<typeof linesOf>[number] & { paid: boolean }
const lineAmount = (l: { courtesy: boolean; chargeableQty: number; unitPrice: number }) =>
  l.courtesy ? 0 : l.chargeableQty * l.unitPrice

/**
 * Consumos por día de Galápagos: subtotal del día y total acumulado de la
 * cabina (lo pagado y lo abierto, en orden).
 */
const days = computed(() => {
  const all: Line[] = [
    ...paidLines.value.map((l) => ({ ...l, paid: true })),
    ...deliveredLines.value.map((l) => ({ ...l, paid: false })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  const groups: Array<{ key: string; label: string; lines: Line[]; subtotal: number; cumulative: number }> = []
  let cumulative = 0
  for (const line of all) {
    const key = dayKeyOf(line.at)
    let group = groups.at(-1)
    if (!group || group.key !== key) {
      group = { key, label: formatDayHeading(key), lines: [], subtotal: 0, cumulative: 0 }
      groups.push(group)
    }
    group.lines.push(line)
    group.subtotal += lineAmount(line)
    cumulative += lineAmount(line)
    group.cumulative = cumulative
  }
  return groups
})

const INVOICE_LABEL: Record<string, string> = {
  pendiente: 'Factura pendiente',
  emitiendo: 'Emitiendo factura…',
  emitida: 'Factura emitida',
  error: 'Factura pendiente',
  no_aplica: 'Sin factura',
  parcial: 'Se factura al completar el pago',
}

function invoiceLabel(p: AccountSummary['payments'][number]) {
  if (p.invoiceStatus === 'parcial') return p.settled ? 'Incluido en la factura del pago final' : INVOICE_LABEL.parcial
  return INVOICE_LABEL[p.invoiceStatus] ?? p.invoiceStatus
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const emailError = computed(() =>
  billing.email.trim() && !EMAIL.test(billing.email.trim()) ? 'Revisa el correo. Ejemplo: nombre@dominio.com.' : '',
)

const publicUrl = computed(() => `${window.location.origin}/cuenta/${props.cabin.accountToken}`)

/**
 * Quien aprueba (Dirección de crucero o Gerencia) ve dos acciones en la
 * misma cuenta: Modificar y Aprobar. El bar envía a revisión.
 */
const isApprover = computed(() => userStore.isDirector)
const hasOpenCharges = computed(() => (account.value?.orders.length ?? 0) > 0)
const canSubmit = computed(
  () => !isApprover.value && account.value?.status === 'abierta' && hasOpenCharges.value,
)
const canApprove = computed(
  () =>
    isApprover.value &&
    hasOpenCharges.value &&
    (account.value?.status === 'abierta' || account.value?.status === 'en_revision'),
)
const canModify = computed(
  () =>
    isApprover.value &&
    hasOpenCharges.value &&
    ['abierta', 'en_revision', 'aprobada'].includes(account.value?.status ?? ''),
)
/** Modo Modificar: cortesía y retiro por línea. */
const editing = shallowRef(false)
const collectSection = useTemplateRef<HTMLElement>('collectSection')
const collectReady = computed(
  () =>
    Boolean(account.value?.readyToCollect) &&
    (!missing.value.idNumber || billing.idNumber.trim()) &&
    (!missing.value.name || billing.name.trim()) &&
    !emailError.value &&
    !amountError.value &&
    (method.value !== 'efectivo' || cashConfirmed.value) &&
    (method.value !== 'transferencia' || reference.value.trim()),
)

/** Dirección corrige en modo Modificar: cortesía (se sirvió) o retiro con motivo. */
const canCorrect = computed(
  () => editing.value && isApprover.value && account.value?.status === 'abierta',
)
const isBar = computed(() => userStore.role === 'bartender')

async function load() {
  try {
    const [acc, ann] = await Promise.all([
      apiCabinAccount(props.cruiseId, props.cabin.number),
      apiOrders({ cruiseId: props.cruiseId, cabinNumber: props.cabin.number, annulment: 'pendiente' }),
    ])
    account.value = acc
    if (acc.status !== 'abierta' || !acc.orders.length) editing.value = false
    amount.value = acc.due > 0 ? acc.due.toFixed(2) : ''
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

/** Aprobar en un toque: el modal muestra los consumos y el total; luego se cobra aquí mismo. */
async function approve() {
  const acc = account.value
  if (!acc) return
  if (acc.pendingDeliveries > 0) {
    toast.error(`Hay ${acc.pendingDeliveries} bebida(s) sin entregar: entrégalas o cancélalas en el Bar`)
    return
  }
  const ok = await confirmStore.ask({
    title: `¿Aprobar la cuenta de cabina ${props.cabin.number}?`,
    message: 'Queda lista para cobrar. Si después cambia un cargo, la aprobación se anula.',
    confirmLabel: 'Aprobar',
    icon: 'fa-shield-halved',
    details: {
      rows: deliveredLines.value.map((l) => ({
        label: `${l.chargeableQty} × ${l.name}${l.courtesy ? ' (cortesía)' : ''}`,
        note: formatDateTime(l.at),
        value: formatMoney(lineAmount(l)),
      })),
      total: { label: acc.partialPaid > 0 ? 'Saldo por cobrar' : 'Total', value: formatMoney(acc.due) },
    },
  })
  if (!ok) return
  await run(async () => {
    account.value = await apiAccountAction(props.cruiseId, props.cabin.number, 'approve')
    editing.value = false
    toast.success('Cuenta aprobada. Lista para cobrar.')
  })
  if (account.value?.readyToCollect) {
    await nextTick()
    collectSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

/**
 * Modificar: con la cuenta abierta entra directo a la edición; en revisión
 * o aprobada la reabre con motivo (la aprobación queda anulada).
 */
async function modify() {
  const acc = account.value
  if (!acc) return
  if (editing.value) {
    editing.value = false
    return
  }
  if (acc.status === 'abierta') {
    editing.value = true
    return
  }
  const reason = await confirmStore.askReason({
    title: `¿Modificar la cuenta de cabina ${props.cabin.number}?`,
    message:
      acc.status === 'aprobada'
        ? 'La aprobación queda anulada. Corrige los consumos y vuelve a aprobar.'
        : 'La cuenta vuelve a abierta para corregir los consumos.',
    confirmLabel: 'Modificar',
    icon: 'fa-pen',
    reason: {
      label: 'Motivo (obligatorio)',
      suggestions: ['El pasajero reclama un cargo', 'Falta un consumo', 'Revisar cortesía'],
    },
  })
  if (!reason) return
  await run(async () => {
    account.value = await apiAccountAction(props.cruiseId, props.cabin.number, 'return', reason)
    editing.value = true
    toast.success('Cuenta abierta para modificar')
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
    message: 'Deja de cobrarse, pero se sirvió: los ingredientes siguen descontados. Queda en el historial.',
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

/**
 * Retirar un consumo que el pasajero dice que no hizo. Si no se sirvió, se
 * deshace y vuelven los ingredientes; si se sirvió, queda como cortesía y el
 * stock sigue descontado. El total se actualiza y queda en el historial.
 */
async function retire(line: { orderId: string; name: string; chargeableQty: number }) {
  if (account.value?.status !== 'abierta') {
    toast.error('Toca Modificar para corregir la cuenta')
    return
  }
  const answer = await confirmStore.askChoice({
    title: `¿Retirar ${line.chargeableQty} ${line.name} de la cuenta?`,
    message: 'El total se actualiza al instante y la corrección queda en el historial.',
    confirmLabel: 'Retirar consumo',
    danger: true,
    icon: 'fa-rotate-left',
    choice: {
      label: '¿Se sirvió la bebida?',
      options: [
        { value: 'no', label: 'No se sirvió', hint: 'Vuelven los ingredientes' },
        { value: 'si', label: 'Sí se sirvió', hint: 'Queda como cortesía; el stock sigue descontado' },
      ],
    },
    reason: {
      label: 'Motivo (obligatorio)',
      suggestions: ['El pasajero dice que no lo pidió', 'Cabina equivocada', 'Compensación al pasajero'],
    },
  })
  if (!answer) return
  await run(async () => {
    if (answer.choice === 'no') {
      await apiUndoConsumption(line.orderId, answer.reason)
      toast.success('Consumo retirado: ingredientes devueltos')
    } else {
      await apiBonifyConsumption(line.orderId, `Retirado por reclamo (se sirvió): ${answer.reason}`)
      toast.success('Consumo retirado como cortesía')
    }
  })
}

async function collect() {
  if (!account.value || amountError.value) return
  const charge = Math.round(amountValue.value * 100) / 100
  const due = account.value.due
  const methodLabel = METHOD_OPTIONS.find((m) => m.value === method.value)?.label
  const ok = await confirmStore.ask({
    title: `¿Cobrar ${formatMoney(charge)} a cabina ${props.cabin.number}?`,
    message: isPartial.value
      ? `Pago parcial con ${methodLabel}. Queda un saldo de ${formatMoney(due - charge)}: la cuenta se marca Pagada cuando llegue a cero.`
      : `Método: ${methodLabel}. Factura a nombre de ${billing.name || payer.value?.name}.`,
    confirmLabel: 'Cobrar',
    icon: 'fa-cash-register',
  })
  if (!ok) return
  await run(async () => {
    const result = await apiCollectCabin({
      cruiseId: props.cruiseId,
      cabinNumber: props.cabin.number,
      method: method.value as PaymentMethod,
      cashConfirmed: cashConfirmed.value,
      reference: reference.value.trim() || undefined,
      amount: charge,
      expectedDue: due,
      billing: {
        name: billing.name || undefined,
        idNumber: billing.idNumber || undefined,
        email: billing.email || undefined,
        country: billing.country || undefined,
      },
    })
    const payment = result.payment
    // Otro medio para el siguiente pago: se limpia lo del anterior.
    cashConfirmed.value = false
    reference.value = ''
    if (!result.settled) {
      toast.success(`Pago parcial registrado. Saldo ${formatMoney(result.due)}`)
      return
    }
    // Pago y factura son estados separados: nunca se afirma una emisión pendiente (L03).
    if (payment?.invoiceStatus === 'emitida') {
      toast.success(`Cuenta pagada. Factura ${payment.invoiceNumber ?? ''} emitida.`)
    } else {
      toast.success(`Cuenta pagada · cabina ${props.cabin.number}`)
      toast.push(
        `Factura pendiente. ${payment?.invoiceError || 'Reintenta la emisión desde Cobros.'}`,
        payment?.invoiceStatus === 'error' ? 'error' : 'info',
      )
    }
    if (result.email?.status === 'enviado') toast.push(`Resumen enviado a ${result.email.to}`, 'info')
    else if (result.email?.status === 'error') toast.push(`Correo no enviado: ${result.email.error}`, 'error')
  }, 'cash')
}

/** Pago que liquidó la cuenta: lleva la factura y el resumen por correo. */
const settlingPayment = computed(() => {
  const list = account.value?.payments ?? []
  return [...list].reverse().find((p) => p.settled && p.invoiceStatus !== 'parcial') ?? null
})

async function resendSummary() {
  const target = settlingPayment.value
  if (!target) return
  const to = target.summaryEmail.to || payer.value?.email || ''
  if (!to) {
    toast.error('El pagador no tiene correo. Regístralo en Pasajeros y vuelve a intentar.')
    return
  }
  const ok = await confirmStore.ask({
    title: '¿Reenviar el resumen de la cuenta?',
    message: `Se enviará a ${to} en inglés, con la prefactura en PDF. No es una factura.`,
    confirmLabel: 'Reenviar',
    icon: 'fa-envelope',
  })
  if (!ok) return
  await run(async () => {
    const email = await apiResendSummary(target.id)
    if (email.status === 'enviado') toast.success(`Resumen enviado a ${email.to}`)
    else throw new Error(`Correo no enviado: ${email.error}`)
  })
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
  <BaseModal :title="`Cabina ${cabin.number}`" @close="emit('close')">
    <SkeletonList v-if="loading" variant="row" :rows="5" />

    <div v-else-if="account" class="acc-sheet">
      <!-- Dónde está la cuenta y cuánto falta -->
      <header class="sheet-head">
        <ol class="steps" aria-label="Estado de la cuenta">
          <li
            v-for="step in steps"
            :key="step.key"
            class="step"
            :class="`step--${step.state}`"
            :aria-current="step.state === 'now' ? 'step' : undefined"
          >
            <span class="step-label">
              <i v-if="step.state === 'done'" class="fa-solid fa-check" aria-hidden="true" />{{ step.label }}
            </span>
          </li>
        </ol>

        <div class="figure">
          <span class="figure-label">
            {{ account.status === 'cobrada' ? 'Cuenta pagada' : isBar ? 'Consumos abiertos' : 'Por cobrar' }}
            <template v-if="account.status !== 'cobrada' && account.partialPaid > 0"> · pago parcial</template>
          </span>
          <strong class="figure-value" :class="{ 'figure-value--settled': account.status === 'cobrada' }">
            {{ formatMoney(account.status === 'cobrada' ? account.consumed : account.due) }}
          </strong>
        </div>

        <!-- Cuenta completa: lo pagado no desaparece (checklist 29-oct, 01) -->
        <dl v-if="!isBar && !neverCharged" class="sums">
          <div>
            <dt>Consumos</dt>
            <dd>{{ formatMoney(account.consumed) }}</dd>
          </div>
          <div>
            <dt>Cobrado</dt>
            <dd>{{ formatMoney(account.paid) }}</dd>
          </div>
          <div :class="{ 'sums-due': account.due > 0 }">
            <dt>Por cobrar</dt>
            <dd>{{ formatMoney(account.due) }}</dd>
          </div>
        </dl>

        <p class="payer">
          <template v-if="payer">
            <i class="fa-solid fa-user" aria-hidden="true" />
            <span>
              Paga <strong>{{ payer.name }}</strong>
              <small>
                {{ payer.country ? payer.country : 'Sin país' }} ·
                {{ payer.email ? payer.email : 'sin correo' }} ·
                {{ payer.idNumber ? 'identificación registrada' : 'falta identificación' }}
              </small>
            </span>
          </template>
          <template v-else>
            <i class="fa-solid fa-user-slash" aria-hidden="true" />
            <span class="warn-text">Sin pasajeros registrados en esta cabina.</span>
          </template>
        </p>
      </header>

      <p v-if="account.pendingDeliveries" class="notice">
        <i class="fa-solid fa-hourglass-half" aria-hidden="true" />
        Hay {{ account.pendingDeliveries }} bebida(s) sin entregar. Entrégalas o cancélalas en el Bar antes de enviar a
        revisión.
      </p>

      <!-- Consumos por día (Galápagos): subtotal del día y acumulado de la cabina -->
      <section class="block" aria-labelledby="acc-lines-title">
        <h4 id="acc-lines-title" class="block-title">Consumos</h4>
        <Transition name="fade">
          <p v-if="editing" class="edit-banner">
            <i class="fa-solid fa-pen" aria-hidden="true" />
            Modificando: marca cortesías o retira consumos. Cada cambio actualiza el total y queda en el historial.
          </p>
        </Transition>
        <p v-if="neverCharged" class="muted">Sin consumos en esta cuenta.</p>
        <div v-for="day in days" :key="day.key" class="day">
          <h5 class="day-head">
            <span>{{ day.label }}</span>
            <span class="day-sub">{{ formatMoney(day.subtotal) }}</span>
          </h5>
          <div
            v-for="line in day.lines"
            :key="`${line.paid ? 'p' : 'o'}-${line.orderId}-${line.index}`"
            class="line"
            :class="{ 'line--paid': line.paid, 'line--editing': canCorrect && !line.paid && line.single }"
          >
            <div class="line-main">
              <span class="line-name">
                <span class="line-qty">{{ line.chargeableQty }} ×</span> {{ line.name }}
              </span>
              <span class="line-meta">
                {{ formatHour(line.at) }} · {{ line.by }}
                <em v-if="line.courtesy" class="tag tag--courtesy">Cortesía</em>
                <em v-if="line.paid" class="tag tag--paid">Cobrado</em>
                <em v-if="line.pendingQty" class="tag tag--pending">{{ line.pendingQty }} por entregar</em>
              </span>
            </div>
            <span class="line-amount" :class="{ 'line-amount--zero': lineAmount(line) === 0 }">
              {{ formatMoney(lineAmount(line)) }}
            </span>
            <Transition name="fade">
              <div v-if="canCorrect && !line.paid && line.single" class="line-actions">
                <button v-if="!line.courtesy" type="button" class="line-btn" :disabled="busy" @click="bonify(line)">
                  <i class="fa-solid fa-gift" aria-hidden="true" /> Marcar como cortesía
                </button>
                <button type="button" class="line-btn line-btn--danger" :disabled="busy" @click="retire(line)">
                  <i class="fa-solid fa-rotate-left" aria-hidden="true" /> Retirar consumo
                </button>
              </div>
            </Transition>
          </div>
          <p class="day-total">
            <span>Acumulado de la cabina</span>
            <strong>{{ formatMoney(day.cumulative) }}</strong>
          </p>
        </div>
        <p v-if="!neverCharged && !deliveredLines.length" class="muted">Nada por cobrar.</p>
        <p v-if="account.courtesyAll" class="muted">Cortesías registradas: {{ formatMoney(account.courtesyAll) }}</p>
      </section>

      <!-- Pagos recibidos: pago y factura son estados separados -->
      <section v-if="account.payments.length && !isBar" class="block" aria-labelledby="acc-paid-title">
        <h4 id="acc-paid-title" class="block-title">Pagos recibidos</h4>
        <ul class="payments">
          <li v-for="p in account.payments" :key="p.id" class="payment">
            <div class="payment-main">
              <span class="payment-name">
                {{ METHOD_OPTIONS.find((m) => m.value === p.method)?.label ?? p.method }}
                <span class="payment-when">{{ formatDateTime(p.createdAt) }}</span>
              </span>
              <span class="payment-states">
                <span class="state state--paid">
                  <i class="fa-solid fa-check" aria-hidden="true" />
                  {{ p.invoiceStatus === 'parcial' ? 'Pago parcial' : 'Pago registrado' }}
                </span>
                <span class="state" :class="`state--invoice-${p.invoiceStatus}`">
                  <i class="fa-regular fa-file-lines" aria-hidden="true" />
                  {{ invoiceLabel(p) }}{{ p.invoiceNumber ? ` ${p.invoiceNumber}` : '' }}
                </span>
              </span>
              <small v-if="p.invoiceStatus !== 'emitida' && p.invoiceError" class="payment-error">{{ p.invoiceError }}</small>
            </div>
            <strong class="payment-amount">{{ formatMoney(p.total) }}</strong>
          </li>
        </ul>
        <!-- Resumen por correo al pagador (al quedar Pagada) -->
        <div v-if="settlingPayment && account.status === 'cobrada'" class="mail">
          <p :class="`mail--${settlingPayment.summaryEmail.status}`">
            <i class="fa-regular fa-envelope" aria-hidden="true" />
            <template v-if="settlingPayment.summaryEmail.status === 'enviado'">
              Resumen enviado a {{ settlingPayment.summaryEmail.to }}
              <span v-if="settlingPayment.summaryEmail.sentAt"> · {{ formatDateTime(settlingPayment.summaryEmail.sentAt) }}</span>
            </template>
            <template v-else-if="settlingPayment.summaryEmail.status === 'error'">
              Correo no enviado: {{ settlingPayment.summaryEmail.error }}
            </template>
            <template v-else-if="settlingPayment.summaryEmail.status === 'enviando'">Enviando resumen…</template>
            <template v-else>Resumen por correo sin enviar</template>
          </p>
          <button v-if="userStore.canCollect" type="button" class="tool" :disabled="busy" @click="resendSummary">
            <i class="fa-solid fa-paper-plane" aria-hidden="true" /> Reenviar resumen por correo
          </button>
        </div>
      </section>

      <!-- Anulaciones pendientes de revisión -->
      <section v-if="annulmentOrders.length && userStore.isLead" class="annulments" aria-labelledby="acc-ann-title">
        <h4 id="acc-ann-title" class="block-title">
          <i class="fa-solid fa-rotate-left" aria-hidden="true" /> Anulaciones por revisar
        </h4>
        <template v-for="order in annulmentOrders" :key="order._id">
          <div v-for="a in order.annulments.filter((x) => x.status === 'pendiente')" :key="a._id" class="annulment">
            <div>
              <strong>{{ a.qty }} × {{ order.items[a.index]?.name }}</strong>
              <p class="muted">{{ a.reason }} · pidió {{ typeof a.requestedBy === 'object' ? a.requestedBy.name : '' }}</p>
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

      <!-- Siguiente paso según rol: el bar envía; quien aprueba ve Modificar y Aprobar -->
      <section
        v-if="canSubmit || canApprove || canModify || account.status === 'en_revision'"
        class="flow"
        :class="{ 'flow--sticky': canSubmit || canApprove }"
        aria-label="Siguiente paso"
      >
        <button
          v-if="canSubmit"
          type="button"
          class="btn btn-primary btn-wide"
          :disabled="busy || account.pendingDeliveries > 0"
          @click="submitReview"
        >
          <i class="fa-solid fa-paper-plane" aria-hidden="true" /> Enviar a revisión
        </button>
        <div v-if="canApprove || canModify" class="flow-pair" :class="{ 'flow-pair--single': !canApprove }">
          <button
            v-if="canModify"
            type="button"
            class="btn btn-ghost"
            :class="{ 'btn-editing': editing }"
            :disabled="busy"
            :aria-pressed="editing"
            @click="modify"
          >
            <i class="fa-solid" :class="editing ? 'fa-check' : 'fa-pen'" aria-hidden="true" />
            {{ editing ? 'Terminar cambios' : 'Modificar' }}
          </button>
          <button
            v-if="canApprove"
            type="button"
            class="btn btn-primary"
            :disabled="busy || account.pendingDeliveries > 0 || account.pendingAnnulments > 0"
            @click="approve"
          >
            <i class="fa-solid fa-shield-halved" aria-hidden="true" /> Aprobar {{ formatMoney(account.due) }}
          </button>
        </div>
        <p v-if="canApprove && account.pendingAnnulments > 0" class="muted">Resuelve las anulaciones pendientes para aprobar.</p>
        <p v-if="account.status === 'en_revision' && !isApprover" class="muted">Cuenta en revisión.</p>
      </section>

      <!-- Cobro: bloqueado hasta aprobar -->
      <section
        v-if="account.status !== 'cobrada' && !isBar && hasOpenCharges"
        ref="collectSection"
        class="collect"
        :class="{ 'collect--locked': !account.readyToCollect }"
        aria-labelledby="acc-collect-title"
      >
        <h4 id="acc-collect-title" class="block-title">
          <i class="fa-solid" :class="account.readyToCollect ? 'fa-cash-register' : 'fa-lock'" aria-hidden="true" />
          {{ account.readyToCollect ? 'Cobrar' : 'Cobrar · disponible al aprobar' }}
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
            <label for="pay-amount">Monto a cobrar</label>
            <div class="amount-row">
              <div class="amount-input">
                <span class="amount-prefix" aria-hidden="true">$</span>
                <input
                  id="pay-amount"
                  v-model="amount"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  :aria-invalid="Boolean(amountError)"
                  aria-describedby="pay-amount-help"
                />
              </div>
              <Transition name="fade">
                <button
                  v-if="Math.round(amountValue * 100) !== Math.round(account.due * 100)"
                  type="button"
                  class="tool"
                  @click="amount = account.due.toFixed(2)"
                >
                  Saldo completo
                </button>
              </Transition>
            </div>
            <Transition name="fade" mode="out-in">
              <small v-if="amountError" id="pay-amount-help" key="err" class="field-error">{{ amountError }}</small>
              <small v-else-if="isPartial" id="pay-amount-help" key="partial" class="field-help">
                Pago parcial: quedará un saldo de {{ formatMoney(account.due - amountValue) }}.
              </small>
              <small v-else id="pay-amount-help" key="full" class="field-help">
                Saldo completo: la cuenta queda Pagada.<template v-if="account.partialPaid > 0">
                  Ya se cobró {{ formatMoney(account.partialPaid) }} antes.</template
                >
              </small>
            </Transition>
          </div>

          <fieldset class="methods">
            <legend>Método de pago</legend>
            <div class="method-grid" role="radiogroup" aria-label="Método de pago">
              <button
                v-for="m in METHOD_OPTIONS"
                :key="m.value"
                type="button"
                role="radio"
                class="method"
                :class="{ 'method--on': method === m.value }"
                :aria-checked="method === m.value"
                @click="method = m.value"
              >
                <i class="fa-solid" :class="m.icon" aria-hidden="true" />
                {{ m.label }}
              </button>
            </div>
          </fieldset>

          <Transition name="fade" mode="out-in">
            <div v-if="method !== 'efectivo'" key="ref" class="field">
              <label for="pay-ref">Referencia {{ method === 'transferencia' ? '(obligatoria)' : '(voucher, opcional)' }}</label>
              <input id="pay-ref" v-model="reference" type="text" maxlength="40" placeholder="Número de transferencia o voucher" />
            </div>
            <label v-else key="cash" class="cash-check" :class="{ 'cash-check--on': cashConfirmed }">
              <input v-model="cashConfirmed" type="checkbox" />
              Confirmo que el efectivo ingresó a caja
            </label>
          </Transition>

          <button type="button" class="btn btn-gold btn-wide btn-collect" :disabled="!collectReady || busy" @click="collect">
            <i class="fa-solid fa-cash-register" aria-hidden="true" />
            Cobrar {{ amountError ? '' : formatMoney(amountValue) }}
          </button>
        </template>
        <p v-else-if="account.readyToCollect" class="muted">Aprobada. Lista para cobrar.</p>
        <p v-else class="muted">Revisa los consumos con el pasajero y aprueba la cuenta para registrar el pago.</p>
      </section>

      <!-- Para el pasajero: prefactura en inglés (sin correo ni Contífico) y QR -->
      <section class="block" aria-labelledby="acc-tools-title">
        <h4 id="acc-tools-title" class="block-title">Para el pasajero</h4>
        <div class="tools">
          <template v-if="userStore.isDirector && !neverCharged">
            <button type="button" class="tool" :disabled="Boolean(proformaBusy)" @click="openProforma(false)">
              <i class="fa-regular fa-file-lines" aria-hidden="true" />
              {{ proformaBusy === 'ver' ? 'Abriendo…' : 'Ver prefactura' }}
            </button>
            <button type="button" class="tool" :disabled="Boolean(proformaBusy)" @click="openProforma(true)">
              <i class="fa-solid fa-file-arrow-down" aria-hidden="true" />
              {{ proformaBusy === 'descargar' ? 'Descargando…' : 'Descargar prefactura en inglés' }}
            </button>
          </template>
          <button type="button" class="tool" :aria-expanded="showQr" @click="showQr = !showQr">
            <i class="fa-solid fa-qrcode" aria-hidden="true" />
            {{ showQr ? 'Ocultar QR' : 'Mostrar QR para el pasajero' }}
          </button>
        </div>
        <Transition name="fade">
          <div v-if="showQr" class="qr-box">
            <QrCanvas :text="publicUrl" :size="220" />
            <p>El pasajero escanea y ve su cuenta en inglés: total, pagos y saldo.</p>
          </div>
        </Transition>
      </section>

      <!-- Historial de la cuenta -->
      <details class="history">
        <summary>
          <i class="fa-solid fa-chevron-right" aria-hidden="true" />
          Historial de la cuenta <span class="muted">· versión {{ account.version }}</span>
        </summary>
        <ol>
          <li v-for="(h, i) in [...account.history].reverse()" :key="i">
            <strong>{{ ACTION_LABEL[h.action] ?? h.action }}</strong>
            <span class="muted">v{{ h.version }} · {{ h.by || 'Sistema' }} · {{ formatDateTime(h.at) }}</span>
            <span v-if="h.reason" class="history-reason">{{ h.reason }}</span>
          </li>
        </ol>
      </details>
    </div>
  </BaseModal>
</template>

<style lang="scss">
// La cuenta necesita más ancho que un diálogo corriente en tableta: se amplía
// solo el modal que la contiene (BaseModal no se toca).
@media (min-width: 640px) {
  .overlay .modal:has(> .modal-body > .acc-sheet) {
    max-width: 680px;
  }
}
</style>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.acc-sheet {
  --line: #dbe4eb;
  --line-strong: #c3d1dc;
  --muted: #55636d;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  font-size: 1rem;
}

// Encabezado: pasos, cifra y pagador
.sheet-head {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.step {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.875rem;
  color: var(--muted);

  &::before {
    content: '';
    display: block;
    height: 4px;
    border-radius: 999px;
    background: var(--powder-100);
    transition: background 0.3s ease;
  }

  &--done::before {
    background: var(--navy-700);
  }

  &--now::before {
    background: var(--navy-800);
  }

  &--now {
    color: var(--ink-900);
    font-weight: 500;
  }
}

.step-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.step-label i {
  font-size: 0.75rem;
  color: var(--navy-700);
}

.figure {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.figure-label {
  font-size: 0.9375rem;
  color: var(--muted);
}

.figure-value {
  font-size: 2.25rem;
  line-height: 1.1;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--navy-800);
  font-variant-numeric: tabular-nums;

  &--settled {
    color: var(--ink-900);
  }
}

.sums {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);

  div {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.6rem 0.85rem;
    min-width: 0;
  }

  div + div {
    border-left: 1px solid var(--line);
  }

  dt {
    font-size: 0.875rem;
    color: var(--muted);
  }

  dd {
    margin: 0;
    font-size: 1.0625rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
}

.sums-due dd {
  color: var(--navy-800);
  font-weight: 600;
}

.payer {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  margin: 0;
  font-size: 1rem;

  > i {
    margin-top: 0.2rem;
    color: var(--navy-600);
  }

  strong {
    font-weight: 500;
  }

  small {
    display: block;
    font-size: 0.875rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
}

.warn-text {
  color: #8a5d1d;
}

.notice {
  display: flex;
  gap: 0.6rem;
  margin: 0;
  padding: 0.75rem 0.9rem;
  border-radius: var(--radius-sm);
  background: #fbf5ec;
  border: 1px solid #ead7b8;
  color: #6f4a16;
  font-size: 0.9375rem;

  i {
    margin-top: 0.2rem;
  }
}

// Bloques con título
.block {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.block-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-family: var(--font-serif);
  font-size: 1.1875rem;
  font-weight: 400;
  color: var(--ink-900);

  i {
    font-size: 0.95rem;
    color: var(--navy-600);
  }
}

.muted {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--muted);
}

.edit-banner {
  margin: 0;
  padding: 0.7rem 0.9rem;
  border-radius: var(--radius-sm);
  background: var(--powder-100);
  color: var(--navy-900);
  font-size: 0.9375rem;

  i {
    margin-right: 0.4rem;
  }
}

// Consumos por día
.day {
  display: flex;
  flex-direction: column;
}

.day-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.75rem;
  margin: 0;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--powder-100);
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--navy-900);

  &::first-letter {
    text-transform: uppercase;
  }
}

.day-sub {
  font-variant-numeric: tabular-nums;
}

.line {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.25rem 1rem;
  padding: 0.7rem 0.75rem;
  border-bottom: 1px solid var(--line);
  transition: background 0.2s ease;

  &--editing {
    background: #f8fafc;
  }
}

.line-main {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  flex: 1 1 200px;
}

.line-name {
  font-size: 1rem;
  font-weight: 500;
}

.line-qty {
  color: var(--muted);
  font-weight: 400;
}

.line-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.5rem;
  font-size: 0.875rem;
  color: var(--muted);
}

.line-amount {
  font-size: 1rem;
  font-weight: 500;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;

  &--zero {
    color: var(--muted);
  }
}

.line--paid .line-name,
.line--paid .line-amount {
  color: var(--muted);
}

.tag {
  flex: none;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  font-style: normal;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;

  &--courtesy {
    background: #e2efe6;
    color: #255a3b;
  }

  &--paid {
    background: var(--powder-100);
    color: var(--navy-900);
  }

  &--pending {
    background: #f7ecdc;
    color: #6f4a16;
  }
}

.line-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  width: 100%;
  margin-top: 0.4rem;
}

.line-btn {
  @include touch-target;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--navy-800);
  transition:
    border-color 0.15s ease,
    opacity 0.15s ease,
    transform 0.12s ease;

  &:hover:not(:disabled) {
    border-color: currentColor;
  }

  &:active:not(:disabled) {
    transform: scale(0.97);
  }

  &:disabled {
    opacity: 0.45;
  }

  &--danger {
    color: var(--danger);
  }
}

.day-total {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 0;
  padding: 0.55rem 0.75rem 0.9rem;
  font-size: 0.9375rem;
  color: var(--muted);

  strong {
    font-weight: 600;
    color: var(--ink-900);
    font-variant-numeric: tabular-nums;
  }
}

// Pagos recibidos
.payments {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.payment {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  padding: 0.7rem 0;
  border-bottom: 1px solid var(--line);

  &:first-child {
    border-top: 1px solid var(--line);
  }
}

.payment-main {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.payment-name {
  font-weight: 500;
}

.payment-when {
  margin-left: 0.4rem;
  font-weight: 400;
  font-size: 0.875rem;
  color: var(--muted);
}

.payment-states {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.state {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 500;
  background: #eef2f5;
  color: #3c4a54;

  i {
    font-size: 0.75rem;
  }

  &--paid,
  &--invoice-emitida {
    background: #e2efe6;
    color: #255a3b;
  }

  &--invoice-pendiente,
  &--invoice-emitiendo {
    background: #f7ecdc;
    color: #6f4a16;
  }

  &--invoice-error {
    background: #f8e4e1;
    color: #8a2f25;
  }
}

.payment-error {
  font-size: 0.875rem;
  color: var(--danger);
}

.payment-amount {
  font-weight: 600;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.mail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;

  p {
    flex: 1 1 240px;
    margin: 0;
    font-size: 0.9375rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  i {
    margin-right: 0.35rem;
  }
}

.mail--enviado {
  color: #255a3b !important;
}

.mail--error {
  color: var(--danger) !important;
}

// Anulaciones
.annulments {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.9rem 1rem;
  border-radius: var(--radius-sm);
  background: #fbf5ec;
  border: 1px solid #ead7b8;
}

.annulment {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem 0;

  & + & {
    border-top: 1px solid #ead7b8;
  }
}

.annulment-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

// Siguiente paso
.flow {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;

  // Antes de aprobar, Modificar / Aprobar quedan a la vista mientras se
  // recorren los consumos con el pasajero.
  &--sticky {
    position: sticky;
    bottom: -1.25rem;
    z-index: 2;
    margin: 0 -1.25rem;
    padding: 0.75rem 1.25rem 1.25rem;
    background: var(--surface);
    box-shadow: 0 -6px 16px rgba(27, 49, 66, 0.08);
  }
}

.btn-wide {
  width: 100%;
}

.flow-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 0.6rem;

  &--single {
    grid-template-columns: minmax(0, 1fr);
  }

  .btn {
    min-height: 52px;
    font-size: 1rem;
  }
}

.btn-editing {
  border-color: var(--navy-800);
  background: var(--powder-100);
  color: var(--navy-900);
}

// Cobro
.collect {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.1rem 1.1rem 1.2rem;
  border-radius: var(--radius);
  border: 1px solid var(--line-strong);
  transition:
    background 0.25s ease,
    border-color 0.25s ease;

  &--locked {
    background: #f5f8fa;
    border-style: dashed;

    .block-title {
      color: var(--muted);
    }
  }

  .field label,
  .methods legend {
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--ink-900);
  }

  .field input {
    font-size: 1rem;
  }
}

.field-error {
  color: var(--danger);
  font-weight: 500;
  font-size: 0.875rem;
}

.field-help {
  font-size: 0.875rem;
  color: var(--muted);
}

.amount-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.amount-input {
  position: relative;
  flex: 1;
  min-width: 0;

  input {
    padding-left: 2rem !important;
    font-size: 1.25rem !important;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
}

.amount-prefix {
  position: absolute;
  left: 0.85rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 1.25rem;
  color: var(--muted);
  pointer-events: none;
}

.methods {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;

  legend {
    padding: 0;
    margin-bottom: 0.4rem;
  }
}

.method-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.method {
  @include touch-target;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.6rem;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--ink-900);
  text-align: center;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    transform 0.12s ease;

  i {
    color: var(--navy-600);
    transition: color 0.18s ease;
  }

  &:hover:not(.method--on) {
    border-color: var(--navy-600);
  }

  &:active {
    transform: scale(0.97);
  }

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;

    i {
      color: #fff;
    }
  }
}

.cash-check {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 52px;
  padding: 0.5rem 0.9rem;
  border-radius: var(--radius-sm);
  border: 1px solid #ead7b8;
  background: #fbf5ec;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease;

  input {
    flex: none;
    width: 1.4rem;
    height: 1.4rem;
    accent-color: var(--navy-800);
  }

  &--on {
    background: #e2efe6;
    border-color: #b9d6c3;
  }
}

.btn-collect {
  min-height: 56px;
  font-size: 1.0625rem;
}

// Para el pasajero
.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.tool {
  @include touch-target;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--navy-800);
  transition:
    border-color 0.15s ease,
    opacity 0.15s ease,
    transform 0.12s ease;

  &:hover:not(:disabled) {
    border-color: var(--navy-700);
  }

  &:active:not(:disabled) {
    transform: scale(0.97);
  }

  &:disabled {
    opacity: 0.5;
  }
}

.qr-box {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 1rem;
  background: var(--powder-100);
  border-radius: var(--radius-sm);

  p {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--ink-600);
  }
}

// Historial
.history {
  border-top: 1px solid var(--line);
  padding-top: 0.25rem;

  summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 48px;
    cursor: pointer;
    list-style: none;
    font-size: 1rem;
    font-weight: 500;
    color: var(--ink-900);

    &::-webkit-details-marker {
      display: none;
    }

    i {
      font-size: 0.75rem;
      color: var(--muted);
      transition: transform 0.2s ease;
    }
  }

  &[open] summary i {
    transform: rotate(90deg);
  }

  .muted {
    font-size: 0.875rem;
  }

  ol {
    list-style: none;
    margin: 0.25rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding-left: 0.85rem;
    border-left: 2px solid var(--line);

    strong {
      font-weight: 500;
    }
  }
}

.history-reason {
  font-size: 0.9375rem;
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
