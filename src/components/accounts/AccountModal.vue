<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import type { AccountSummary, Cabin, Order } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import PayerForm from '@/components/accounts/PayerForm.vue'
import PaymentLines from '@/components/accounts/PaymentLines.vue'
import QrCanvas from '@/components/ui/QrCanvas.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import { useUserStore } from '@/stores/user'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { useConsumptionCorrections } from '@/composables/useConsumptionCorrections'
import {
  apiAccountAction,
  apiAssignConsumers,
  apiCabinAccount,
  apiCollectCabin,
  apiOrders,
  apiResendSummary,
  apiReviewAnnulment,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import {
  METHOD_OPTIONS,
  billingError,
  emptyBilling,
  linesState,
  methodsLabel,
  newLine,
  toPayload,
  type Billing,
  type PayLine,
} from '@/components/accounts/payLines'
import { dayKeyOf, formatDateTime, formatDayHeading, formatHour, formatMoney } from '@/utils/format'

const props = defineProps<{ cruiseId: string; cabin: Cabin }>()
const emit = defineEmits<{ close: []; changed: []; groupWith: [cabinNumber: number] }>()

const userStore = useUserStore()
const confirmStore = useConfirmStore()
const toast = useToastStore()
const { play } = useSound()
const corrections = useConsumptionCorrections()

const account = shallowRef<AccountSummary | null>(null)
const annulmentOrders = shallowRef<Order[]>([])
const loading = shallowRef(true)
const busy = shallowRef(false)
/** QR arriba desde que se abre la cuenta (pedido 3-nov-2026); se amplía al tocarlo. */
const qrBig = shallowRef(false)

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

/**
 * Recorrido de la cuenta en tres pasos: Consumos (abierta; "en revisión" es
 * un estado heredado y se trata igual) → Aprobada → Pagada. Solo informa;
 * las reglas viven en el servidor.
 */
const steps = computed(() => {
  const status = account.value?.status ?? 'abierta'
  const at = status === 'cobrada' ? 2 : status === 'aprobada' ? 1 : 0
  return [
    { key: 'consumos', label: 'Consumos', state: at > 0 ? 'done' : 'now' },
    { key: 'aprobada', label: 'Aprobada', state: at > 1 ? 'done' : at === 1 ? 'now' : 'next' },
    { key: 'pagada', label: 'Pagada', state: at === 2 ? 'done' : 'next' },
  ] as const
})

const payer = computed(
  () => props.cabin.passengers.find((p) => p.isPayer) ?? props.cabin.passengers[0] ?? null,
)

// ---- Cobro (pedido del cliente, 31-oct-2026) ----
// Una persona paga todo, o se divide: por consumos (cada uno paga lo suyo)
// o por porcentaje. Cada parte con su factura y su pagador; cada cobro con
// una o varias formas de pago ($10 efectivo + el resto con tarjeta).
type SplitMode = 'una' | 'consumos' | 'porcentaje'
const splitMode = shallowRef<SplitMode>('una')
const payerBilling = ref<Billing>(emptyBilling())
const payLines = ref<PayLine[]>([newLine()])
/** Consumos que paga la persona elegida (modo por consumos). */
const selected = ref<Set<string>>(new Set())
const percentText = shallowRef('50')

function billingOf(p: Cabin['passengers'][number] | null): Billing {
  return p
    ? { passengerId: p._id ?? '', name: p.name, idNumber: p.idNumber ?? '', email: p.email ?? '', country: p.country ?? '' }
    : emptyBilling()
}

/** Pagos parciales sin factura propia: impiden dividir (se cobra el saldo). */
const hasAbonos = computed(() => (account.value?.payments ?? []).some((p) => !p.settled && !p.part))
const hasParts = computed(() => (account.value?.payments ?? []).some((p) => !p.settled && p.part))
/** Quienes ya pagaron su parte en esta cuenta abierta. */
const paidNames = computed(() =>
  (account.value?.payments ?? []).filter((p) => p.head !== false && p.payer && (p.part || p.settled)).map((p) => p.payer!),
)

/** Consumos por cobrar que se pueden asignar (con importe). */
const openOrders = computed(() =>
  (account.value?.orders ?? [])
    .filter((o) => o.total > 0)
    .map((o) => ({
      id: o.id,
      at: o.createdAt,
      label: o.items.map((i) => `${i.chargeableQty} × ${i.name}`).join(', '),
      total: o.total,
      consumerId: o.consumerId && peopleIds.value.has(o.consumerId) ? o.consumerId : null,
      consumerName: o.consumerName,
    })),
)

/**
 * Cada uno lo suyo: la persona elegida ve lo suyo ya marcado, lo sin asignar
 * para sumar si corresponde y lo de los demás bloqueado (no se cobra dos veces
 * ni se mezcla). Lo suyo primero.
 */
const collectOrders = computed(() => {
  const me = payerBilling.value.passengerId
  const rank = (o: (typeof openOrders.value)[number]) => (o.consumerId && o.consumerId === me ? 0 : o.consumerId ? 2 : 1)
  return [...openOrders.value]
    .map((o) => ({ ...o, mine: Boolean(me) && o.consumerId === me, other: Boolean(o.consumerId) && o.consumerId !== me }))
    .sort((a, b) => rank(a) - rank(b))
})
const selectable = computed(() => collectOrders.value.filter((o) => !o.other))

/** Al elegir quién paga se marcan sus consumos asignados. */
function syncSelection() {
  if (splitMode.value !== 'consumos') return
  const me = payerBilling.value.passengerId
  selected.value = new Set(me ? openOrders.value.filter((o) => o.consumerId === me).map((o) => o.id) : [])
}
watch([() => payerBilling.value.passengerId, splitMode], syncSelection)

// ---- Quién consumió qué (pedido del cliente, 3-nov-2026) ----
// Se asigna antes de aprobar; no es un cargo: no anula la aprobación.
const people = computed(() => props.cabin.passengers.filter((p) => p._id))
const peopleIds = computed(() => new Set(people.value.map((p) => p._id!)))
const assigning = shallowRef('')

async function assign(orderIds: string[], passengerId: string | null) {
  if (!orderIds.length || assigning.value) return
  assigning.value = orderIds.length === 1 ? orderIds[0]! : 'todos'
  try {
    account.value = await apiAssignConsumers(
      props.cruiseId,
      props.cabin.number,
      orderIds.map((orderId) => ({ orderId, passengerId })),
    )
    syncSelection()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    assigning.value = ''
  }
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

/** Lo que queda por cobrar repartido por persona, y lo que falta asignar. */
const sharing = computed(() => {
  const round = (n: number) => Math.round(n * 100) / 100
  const rows = people.value.map((p) => {
    const mine = openOrders.value.filter((o) => o.consumerId === p._id)
    return { id: p._id!, name: p.name, count: mine.length, total: round(mine.reduce((s, o) => s + o.total, 0)) }
  })
  const loose = openOrders.value.filter((o) => !o.consumerId)
  return {
    rows,
    looseIds: loose.map((o) => o.id),
    looseTotal: round(loose.reduce((s, o) => s + o.total, 0)),
    anyAssigned: rows.some((r) => r.count > 0),
  }
})

function toggleOrder(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

const percentValue = computed(() => Number(percentText.value.replace(',', '.')))
const percentOk = computed(() => percentValue.value > 0 && percentValue.value <= 100)

/** Lo que cubre este cobro según cómo se divide. */
const target = computed(() => {
  const acc = account.value
  if (!acc) return 0
  if (splitMode.value === 'consumos') {
    return Math.round(openOrders.value.filter((o) => selected.value.has(o.id)).reduce((s, o) => s + o.total, 0) * 100) / 100
  }
  if (splitMode.value === 'porcentaje') {
    if (!percentOk.value) return 0
    const share = Math.round(acc.total * percentValue.value) / 100
    return share >= acc.due - 0.01 ? acc.due : share
  }
  return acc.due
})

const payState = computed(() => linesState(payLines.value, target.value, splitMode.value === 'una'))
const payerError = computed(() => billingError(payerBilling.value))

const collectBlocked = computed(() => {
  if (!account.value?.readyToCollect) return 'Aprueba la cuenta para cobrar.'
  if (splitMode.value === 'consumos' && !selected.value.size) return 'Marca los consumos que paga esta persona.'
  if (splitMode.value === 'porcentaje' && !percentOk.value) return 'El porcentaje va de 1 a 100.'
  if (target.value <= 0) return 'No hay importe para cobrar.'
  return payerError.value || payState.value.error
})

function setMode(mode: SplitMode) {
  splitMode.value = mode
  selected.value = new Set()
  payLines.value = [newLine()]
  syncSelection()
}

/** Siguiente persona sin pagar (al dividir) o el titular de la cabina. */
function suggestPayer() {
  const pax = props.cabin.passengers
  const next =
    splitMode.value === 'una'
      ? (pax.find((p) => p.isPayer) ?? pax[0] ?? null)
      : (pax.find((p) => sharing.value.rows.some((r) => r.id === p._id && r.count > 0)) ??
        pax.find((p) => !paidNames.value.includes(p.name)) ??
        pax[0] ??
        null)
  payerBilling.value = billingOf(next)
}

function linesOf(orders: AccountSummary['orders']) {
  return orders.flatMap((order) =>
    order.items
      .filter((i) => i.chargeableQty > 0)
      .map((i) => ({
        ...i,
        orderId: order.id,
        by: order.by,
        at: order.createdAt,
        single: order.items.length === 1,
        consumerId: order.consumerId,
        consumerName: order.consumerName,
      })),
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
  if (p.invoiceStatus === 'parcial' && p.group && p.head === false && p.settled) return 'En la factura de este cobro'
  if (p.invoiceStatus === 'parcial') return p.settled ? 'Incluido en la factura del pago final' : INVOICE_LABEL.parcial
  return INVOICE_LABEL[p.invoiceStatus] ?? p.invoiceStatus
}


const publicUrl = computed(() => `${window.location.origin}/cuenta/${props.cabin.accountToken}`)

/**
 * Quien aprueba (Dirección de crucero o Gerencia) ve abajo solo Aprobar; la
 * cortesía y el retiro están siempre bajo cada consumo (pedido 31-oct-2026).
 */
const isApprover = computed(() => userStore.isDirector)
const isBar = computed(() => userStore.role === 'bartender')
const hasOpenCharges = computed(() => (account.value?.orders.length ?? 0) > 0)
/** "En revisión" es heredado: se trata como abierta. */
const isOpen = computed(() => account.value?.status === 'abierta' || account.value?.status === 'en_revision')
const isApproved = computed(() => account.value?.status === 'aprobada')
const canApprove = computed(() => isApprover.value && hasOpenCharges.value && isOpen.value)
/**
 * Cortesía / Retirar bajo cada consumo sin pagar: el bar con la cuenta
 * abierta; Dirección y Gerencia también con la cuenta aprobada (la anula).
 */
const canCorrect = computed(() => (isApprover.value && (isOpen.value || isApproved.value)) || (isBar.value && isOpen.value))
/** Asignar quién consumió: con dos o más personas y algo por cobrar. */
const canAssign = computed(
  () => people.value.length > 1 && hasOpenCharges.value && account.value?.status !== 'cobrada' && (isApprover.value || isBar.value),
)
/** Primera carga: si ya se asignaron consumos a dos o más personas, el cobro abre en "Cada uno lo suyo". */
let firstLoad = true
const collectSection = useTemplateRef<HTMLElement>('collectSection')


async function load() {
  try {
    const [acc, ann] = await Promise.all([
      apiCabinAccount(props.cruiseId, props.cabin.number),
      apiOrders({ cruiseId: props.cruiseId, cabinNumber: props.cabin.number, annulment: 'pendiente' }),
    ])
    account.value = acc
    // Con partes ya cobradas se sigue dividiendo como se empezó.
    if (acc.payments.some((p) => !p.settled && p.part) && splitMode.value === 'una') splitMode.value = 'porcentaje'
    else if (firstLoad && splitMode.value === 'una' && !hasAbonos.value && sharing.value.rows.filter((r) => r.count).length > 1) {
      splitMode.value = 'consumos'
    }
    firstLoad = false
    suggestPayer()
    syncSelection()
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
    toast.success('Cuenta aprobada. Lista para cobrar.')
  })
  if (account.value?.readyToCollect) {
    await nextTick()
    collectSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
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

type AccountLine = { orderId: string; name: string; chargeableQty: number; courtesy: boolean }

/** Cortesía: se sirvió, deja de cobrarse. Con la cuenta aprobada, la anula. */
async function bonify(line: AccountLine) {
  await correct(() => corrections.courtesy({ orderId: line.orderId, name: line.name, qty: line.chargeableQty }, { approved: isApproved.value }))
}

/**
 * Retirar un consumo que el pasajero dice que no hizo. Si no se sirvió, se
 * deshace y vuelven los ingredientes; si se sirvió, queda como cortesía y el
 * stock sigue descontado. El total se actualiza y queda en el historial.
 */
async function retire(line: AccountLine) {
  await correct(() =>
    corrections.retire(
      { orderId: line.orderId, name: line.name, qty: line.chargeableQty, courtesy: line.courtesy },
      { approved: isApproved.value },
    ),
  )
}

async function correct(action: () => Promise<{ message: string } | null>) {
  busy.value = true
  try {
    const result = await action()
    if (!result) return
    play('success')
    toast.success(result.message)
    emit('changed')
    await load()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

async function collect() {
  const acc = account.value
  if (!acc || collectBlocked.value) return
  const amount = payState.value.total
  const who = payerBilling.value.name.trim()
  const how = methodsLabel(payLines.value, payState.value, formatMoney)
  const what =
    splitMode.value === 'consumos'
      ? `${selected.value.size} consumo(s) de ${who}`
      : splitMode.value === 'porcentaje'
        ? `${percentValue.value}% de la cuenta (${who})`
        : `cabina ${props.cabin.number}`
  const ok = await confirmStore.ask({
    title: `¿Cobrar ${formatMoney(amount)}?`,
    message: payState.value.partial
      ? `Pago parcial de ${what}: ${how}. Queda un saldo de ${formatMoney(acc.due - amount)}; la cuenta se marca Pagada cuando llegue a cero.`
      : `${what[0]!.toUpperCase()}${what.slice(1)}: ${how}. Factura a nombre de ${who}.`,
    confirmLabel: 'Cobrar',
    icon: 'fa-cash-register',
  })
  if (!ok) return
  await run(async () => {
    const b = payerBilling.value
    const result = await apiCollectCabin({
      cruiseId: props.cruiseId,
      cabinNumber: props.cabin.number,
      lines: toPayload(payLines.value, payState.value),
      orderIds: splitMode.value === 'consumos' ? [...selected.value] : undefined,
      percent: splitMode.value === 'porcentaje' ? percentValue.value : undefined,
      expectedDue: acc.due,
      billing: {
        passengerId: b.passengerId || undefined,
        name: b.name.trim(),
        idNumber: b.idNumber.trim(),
        email: b.email.trim() || undefined,
        country: b.country || undefined,
      },
    })
    const payment = result.payment
    payLines.value = [newLine()]
    selected.value = new Set()
    if (!result.settled) {
      toast.success(
        splitMode.value === 'una'
          ? `Pago parcial registrado. Saldo ${formatMoney(result.due)}`
          : `${who} pagó ${formatMoney(amount)}. Falta ${formatMoney(result.due)}`,
      )
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

</script>

<template>
  <BaseModal :title="`Cabina ${cabin.number}`" size="lg" @close="emit('close')">
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

        <!-- QR para el pasajero, visible al abrir: revisa su cuenta en inglés en su celular -->
        <button
          v-if="cabin.accountToken"
          type="button"
          class="qr-top"
          :class="{ 'qr-top--big': qrBig }"
          :aria-expanded="qrBig"
          :aria-label="qrBig ? 'Achicar el QR' : 'Ampliar el QR'"
          @click="qrBig = !qrBig"
        >
          <QrCanvas :text="publicUrl" :size="qrBig ? 240 : 96" />
          <span class="qr-top-text">
            <strong><i class="fa-solid fa-qrcode" aria-hidden="true" /> Cuenta en el celular del pasajero</strong>
            <small>Que escanee el QR: ve sus consumos, pagos y saldo en inglés.</small>
            <small class="qr-top-hint">{{ qrBig ? 'Toca para achicar' : 'Toca para ampliar' }}</small>
          </span>
        </button>

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
            <i class="fa-solid fa-users" aria-hidden="true" />
            <span>
              <strong>{{ cabin.passengers.map((p) => p.name).join(' · ') }}</strong>
              <small>Quién paga (o si dividen la cuenta) se elige al cobrar.</small>
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
        Hay {{ account.pendingDeliveries }} bebida(s) sin entregar. Entrégalas o cancélalas en el Bar antes de aprobar.
      </p>

      <!-- Consumos por día (Galápagos): subtotal del día y acumulado de la cabina -->
      <section class="block" aria-labelledby="acc-lines-title">
        <h4 id="acc-lines-title" class="block-title">Consumos</h4>
        <p v-if="canCorrect && isApproved && hasOpenCharges" class="edit-banner">
          <i class="fa-solid fa-circle-info" aria-hidden="true" />
          Cuenta aprobada: una cortesía o un retiro anula la aprobación y hay que volver a aprobarla.
        </p>
        <p v-else-if="isBar && isApproved && hasOpenCharges" class="muted">
          Cuenta aprobada: las correcciones las hace Dirección de crucero o Gerencia.
        </p>
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
            :class="{ 'line--paid': line.paid }"
          >
            <div class="line-main">
              <span class="line-name">
                <span class="line-qty">{{ line.chargeableQty }} ×</span> {{ line.name }}
              </span>
              <span class="line-meta">
                {{ formatHour(line.at) }} · {{ line.by }}
                <em v-if="line.courtesy" class="tag tag--courtesy" :class="{ 'tag--agency': line.courtesyKind === 'agencia' }">
                  {{ line.courtesyKind === 'agencia' ? 'Cortesía agencia' : 'Cortesía casa' }}
                </em>
                <em v-if="line.paid" class="tag tag--paid">Cobrado</em>
                <em v-if="line.pendingQty" class="tag tag--pending">{{ line.pendingQty }} por entregar</em>
                <em v-if="line.consumerName && (line.paid || !canAssign)" class="tag tag--who">
                  <i class="fa-solid fa-user" aria-hidden="true" /> {{ line.consumerName }}
                </em>
              </span>
            </div>
            <span class="line-amount" :class="{ 'line-amount--zero': lineAmount(line) === 0 }">
              {{ formatMoney(lineAmount(line)) }}
            </span>
            <!-- ¿Quién lo consumió? Antes de aprobar; un toque en la misma persona lo deja sin asignar -->
            <div
              v-if="canAssign && !line.paid && lineAmount(line) > 0"
              class="who-row"
              role="radiogroup"
              :aria-label="`Quién consumió ${line.name}`"
            >
              <span class="who-label">¿Quién?</span>
              <button
                v-for="p in people"
                :key="p._id"
                type="button"
                role="radio"
                class="who-btn"
                :class="{ 'who-btn--on': line.consumerId === p._id }"
                :aria-checked="line.consumerId === p._id"
                :disabled="Boolean(assigning)"
                @click="assign([line.orderId], line.consumerId === p._id ? null : p._id!)"
              >
                <i
                  class="fa-solid"
                  :class="assigning === line.orderId ? 'fa-spinner fa-spin' : line.consumerId === p._id ? 'fa-circle-check' : 'fa-user'"
                  aria-hidden="true"
                />
                {{ firstName(p.name) }}
              </button>
            </div>
            <!-- Corrección directa bajo cada consumo (sin modo Modificar) -->
            <div v-if="canCorrect && !line.paid && line.single" class="line-actions">
              <button
                v-if="!line.courtesy && !line.pendingQty"
                type="button"
                class="btn-text line-link"
                :disabled="busy"
                @click="bonify(line)"
              >
                <i class="fa-solid fa-gift" aria-hidden="true" /> Cortesía
              </button>
              <button type="button" class="btn-text line-link line-link--danger" :disabled="busy" @click="retire(line)">
                <i class="fa-solid fa-rotate-left" aria-hidden="true" /> Retirar consumo
              </button>
            </div>
          </div>
          <p class="day-total">
            <span>Acumulado de la cabina</span>
            <strong>{{ formatMoney(day.cumulative) }}</strong>
          </p>
        </div>
        <p v-if="!neverCharged && !deliveredLines.length" class="muted">Nada por cobrar.</p>
        <p v-if="account.courtesyAll" class="muted">Cortesías registradas: {{ formatMoney(account.courtesyAll) }}</p>
      </section>

      <!-- Reparto por persona (pedido 3-nov-2026): se ve antes de aprobar y alimenta "Cada uno lo suyo" -->
      <section v-if="canAssign" class="block sharing" aria-labelledby="acc-share-title">
        <h4 id="acc-share-title" class="block-title">
          <i class="fa-solid fa-users" aria-hidden="true" /> Quién consumió qué
        </h4>
        <p class="muted">
          Si dividen la cuenta, toca en cada consumo de quién es. Al cobrar, "Cada uno lo suyo" ya trae lo de cada persona.
        </p>
        <ul class="share-list">
          <li v-for="r in sharing.rows" :key="r.id" class="share-row">
            <span class="share-name"><i class="fa-solid fa-user" aria-hidden="true" /> {{ r.name }}</span>
            <small>{{ r.count }} consumo{{ r.count === 1 ? '' : 's' }}</small>
            <strong>{{ formatMoney(r.total) }}</strong>
          </li>
          <li class="share-row" :class="{ 'share-row--loose': sharing.looseIds.length }">
            <span class="share-name">
              <i class="fa-solid" :class="sharing.looseIds.length ? 'fa-circle-question' : 'fa-circle-check'" aria-hidden="true" />
              {{ sharing.looseIds.length ? 'Sin asignar' : 'Todo asignado' }}
            </span>
            <small v-if="sharing.looseIds.length">{{ sharing.looseIds.length }} consumo{{ sharing.looseIds.length === 1 ? '' : 's' }}</small>
            <strong v-if="sharing.looseIds.length">{{ formatMoney(sharing.looseTotal) }}</strong>
          </li>
        </ul>
        <div v-if="sharing.looseIds.length" class="share-all">
          <span>Lo sin asignar:</span>
          <button
            v-for="p in people"
            :key="p._id"
            type="button"
            class="tool tool--sm"
            :disabled="Boolean(assigning)"
            @click="assign(sharing.looseIds, p._id!)"
          >
            <i class="fa-solid" :class="assigning === 'todos' ? 'fa-spinner fa-spin' : 'fa-user-check'" aria-hidden="true" />
            Todo a {{ firstName(p.name) }}
          </button>
        </div>
      </section>

      <!-- Pagos recibidos: pago y factura son estados separados -->
      <section v-if="account.payments.length && !isBar" class="block" aria-labelledby="acc-paid-title">
        <h4 id="acc-paid-title" class="block-title">Pagos recibidos</h4>
        <ul class="payments">
          <li v-for="p in account.payments" :key="p.id" class="payment">
            <div class="payment-main">
              <span class="payment-name">
                {{ METHOD_OPTIONS.find((m) => m.value === p.method)?.label ?? p.method }}
                <span class="payment-when">
                  {{ formatDateTime(p.createdAt) }}<template v-if="p.payer"> · {{ p.payer }}</template>
                  <template v-if="p.cabins && p.cabins.length > 1"> · cabinas {{ p.cabins.join(', ') }} juntas</template>
                  <template v-if="p.part"> · parte de la cuenta</template>
                </span>
              </span>
              <span class="payment-states">
                <span class="state state--paid">
                  <i class="fa-solid fa-check" aria-hidden="true" />
                  {{ p.invoiceStatus === 'parcial' && !p.settled ? 'Pago parcial' : 'Pago registrado' }}
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

      <!-- Abajo solo Aprobar (Dirección de crucero o Gerencia); luego se cobra aquí mismo -->
      <section v-if="canApprove" class="flow flow--sticky" aria-label="Siguiente paso">
        <button
          type="button"
          class="btn btn-primary btn-wide btn-approve"
          :disabled="busy || account.pendingDeliveries > 0 || account.pendingAnnulments > 0"
          @click="approve"
        >
          <i class="fa-solid fa-shield-halved" aria-hidden="true" /> Aprobar {{ formatMoney(account.due) }}
        </button>
        <p v-if="account.pendingAnnulments > 0" class="muted">Resuelve las anulaciones pendientes para aprobar.</p>
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
          <!-- ¿Cómo pagan? Una persona, o cada uno lo suyo -->
          <div class="split" role="radiogroup" aria-label="Cómo pagan">
            <button
              type="button"
              role="radio"
              class="split-opt"
              :class="{ 'split-opt--on': splitMode === 'una' }"
              :aria-checked="splitMode === 'una'"
              :disabled="hasParts"
              @click="setMode('una')"
            >
              <i class="fa-solid fa-user" aria-hidden="true" />
              <strong>Paga una persona</strong>
              <small>Toda la cuenta</small>
            </button>
            <button
              type="button"
              role="radio"
              class="split-opt"
              :class="{ 'split-opt--on': splitMode === 'consumos' }"
              :aria-checked="splitMode === 'consumos'"
              :disabled="hasAbonos || hasParts"
              @click="setMode('consumos')"
            >
              <i class="fa-solid fa-list-check" aria-hidden="true" />
              <strong>Cada uno lo suyo</strong>
              <small>Asignar consumos a cada persona</small>
            </button>
            <button
              type="button"
              role="radio"
              class="split-opt"
              :class="{ 'split-opt--on': splitMode === 'porcentaje' }"
              :aria-checked="splitMode === 'porcentaje'"
              :disabled="hasAbonos"
              @click="setMode('porcentaje')"
            >
              <i class="fa-solid fa-percent" aria-hidden="true" />
              <strong>Dividir en porcentaje</strong>
              <small>Ej. 50 % cada uno</small>
            </button>
            <button
              type="button"
              class="split-opt"
              :disabled="hasAbonos || hasParts"
              @click="emit('groupWith', cabin.number)"
            >
              <i class="fa-solid fa-people-arrows" aria-hidden="true" />
              <strong>Otra cabina paga</strong>
              <small>Una factura por las dos</small>
            </button>
          </div>
          <p v-if="hasAbonos" class="muted">Hay un pago parcial: cobra el saldo completo para dividir de nuevo.</p>

          <div class="collect-step">
            <p class="collect-label"><span class="collect-n">1</span> ¿Quién paga?</p>
            <PayerForm
              v-model="payerBilling"
              :passengers="cabin.passengers"
              :paid-names="splitMode === 'una' ? [] : paidNames"
              id-prefix="bill"
            />
          </div>

          <!-- Por consumos: marcar lo de esta persona -->
          <Transition name="fade" mode="out-in">
            <div v-if="splitMode === 'consumos'" key="consumos" class="collect-step">
              <p class="collect-label">
                <span class="collect-n">2</span> Consumos de {{ payerBilling.name || 'esta persona' }}
                <button
                  v-if="selectable.length"
                  type="button"
                  class="tool tool--sm"
                  @click="selected = selected.size === selectable.length ? new Set() : new Set(selectable.map((o) => o.id))"
                >
                  {{ selected.size === selectable.length ? 'Ninguno' : 'Todos' }}
                </button>
              </p>
              <ul class="assign">
                <li v-for="o in collectOrders" :key="o.id">
                  <label
                    class="assign-row"
                    :class="{ 'assign-row--on': selected.has(o.id), 'assign-row--other': o.other }"
                  >
                    <input type="checkbox" :checked="selected.has(o.id)" :disabled="o.other" @change="toggleOrder(o.id)" />
                    <span class="assign-name">
                      {{ o.label }}
                      <small>
                        {{ formatHour(o.at) }}
                        <template v-if="o.other"> · de {{ o.consumerName }}</template>
                        <template v-else-if="!o.consumerId"> · sin asignar</template>
                      </small>
                    </span>
                    <strong>{{ formatMoney(o.total) }}</strong>
                  </label>
                </li>
              </ul>
              <p class="muted">
                Lo de otra persona queda para su propio cobro. Para cambiar de quién es un consumo, tócalo arriba en "Quién consumió qué".
              </p>
            </div>
            <div v-else-if="splitMode === 'porcentaje'" key="pct" class="collect-step">
              <p class="collect-label"><span class="collect-n">2</span> Porcentaje que paga {{ payerBilling.name || 'esta persona' }}</p>
              <div class="pct-row">
                <button
                  v-for="pct in [50, 33.33, 25]"
                  :key="pct"
                  type="button"
                  class="pct-chip"
                  :class="{ 'pct-chip--on': percentValue === pct }"
                  @click="percentText = String(pct)"
                >
                  {{ String(pct).replace('.', ',') }} %
                </button>
                <label class="pct-input">
                  <input v-model="percentText" type="text" inputmode="decimal" aria-label="Porcentaje" />
                  <span>%</span>
                </label>
              </div>
              <p class="muted">
                {{ percentOk ? `${String(percentValue).replace('.', ',')} % de ${formatMoney(account.total)} = ${formatMoney(target)}` : 'Escribe un porcentaje de 1 a 100.' }}
                <template v-if="account.partialPaid > 0"> · ya se cobró {{ formatMoney(account.partialPaid) }}</template>
              </p>
            </div>
          </Transition>

          <div class="collect-step">
            <p class="collect-label">
              <span class="collect-n">{{ splitMode === 'una' ? 2 : 3 }}</span> Forma de pago
              <span class="collect-target">{{ formatMoney(target) }}</span>
            </p>
            <PaymentLines v-model="payLines" :target="target" :allow-partial="splitMode === 'una'" id-prefix="pay" />
          </div>

          <button
            type="button"
            class="btn btn-gold btn-wide btn-collect"
            :disabled="Boolean(collectBlocked) || busy"
            @click="collect"
          >
            <i class="fa-solid fa-cash-register" aria-hidden="true" />
            Cobrar {{ payState.valid && target > 0 ? formatMoney(payState.total) : '' }}
            <template v-if="splitMode !== 'una' && payerBilling.name"> a {{ payerBilling.name }}</template>
          </button>
          <Transition name="fade">
            <p v-if="collectBlocked && !payState.error" class="muted collect-why">{{ collectBlocked }}</p>
          </Transition>
        </template>
        <p v-else-if="account.readyToCollect" class="muted">Aprobada. Lista para cobrar.</p>
        <p v-else class="muted">Revisa los consumos con el pasajero y aprueba la cuenta para registrar el pago.</p>
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
  align-items: center;
  width: 100%;
  margin: 0.1rem 0 -0.45rem;
}

// Acciones pequeñas de texto bajo cada consumo, con zona táctil de 44 px.
.line-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 44px;
  padding: 0 0.6rem;
  margin-left: -0.6rem;
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--navy-700);
  transition:
    background 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease;

  i {
    font-size: 0.8125rem;
  }

  &:hover:not(:disabled) {
    background: var(--powder-100);
    color: var(--navy-900);
  }

  &:active:not(:disabled) {
    transform: scale(0.97);
  }

  &:disabled {
    opacity: 0.45;
  }

  &--danger {
    color: var(--danger);

    &:hover:not(:disabled) {
      background: #fbecea;
      color: var(--danger-ink, var(--danger));
    }
  }

  & + & {
    margin-left: 0.5rem;
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

  // Antes de aprobar, Aprobar queda a la vista mientras se recorren los
  // consumos con el pasajero.
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

.btn-approve {
  min-height: 52px;
  font-size: 1rem;
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

  .field label {
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

// ¿Cómo pagan?
.split {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.45rem;

  @include tablet {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @include desktop {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.split-opt {
  display: grid;
  grid-template-columns: 28px 1fr;
  grid-template-rows: auto auto;
  column-gap: 0.5rem;
  align-items: center;
  min-height: 60px;
  padding: 0.55rem 0.75rem;
  border: 2px solid var(--cream-200);
  border-radius: var(--radius-sm);
  background: var(--surface);
  text-align: left;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    opacity 0.15s ease,
    transform 0.12s ease;

  i {
    grid-row: span 2;
    color: var(--navy-600);
    font-size: 1.05rem;
  }

  strong {
    font-size: 0.92rem;
  }

  small {
    font-size: 0.78rem;
    color: var(--ink-400);
  }

  &:hover:not(:disabled):not(.split-opt--on) {
    border-color: var(--navy-600);
  }

  &:active:not(:disabled) {
    transform: scale(0.98);
  }

  &:disabled {
    opacity: 0.45;
  }

  &--on {
    border-color: var(--navy-800);
    background: var(--powder-100);
  }
}

.collect-step {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--line);
}

.collect-label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-weight: 700;
  color: var(--ink-900);
}

.collect-n {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--navy-800);
  color: #fff;
  font-size: 0.78rem;
}

.collect-target {
  margin-left: auto;
  font-family: var(--font-serif);
  font-size: 1.3rem;
  color: var(--navy-800);
  font-variant-numeric: tabular-nums;
}

.collect-why {
  margin: -0.4rem 0 0;
  text-align: center;
}

// Por consumos: lo que paga esta persona
.assign {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 300px;
  overflow-y: auto;
}

.assign-row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-height: 48px;
  padding: 0.4rem 0.75rem;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;

  input {
    width: 20px;
    height: 20px;
    accent-color: var(--navy-800);
    flex-shrink: 0;
  }

  strong {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  &--on {
    border-color: var(--navy-700);
    background: var(--powder-100);
  }
}

.assign-row--other {
  cursor: not-allowed;
  opacity: 0.55;
  border-style: dashed;
}

// Quién consumió qué: selector bajo cada consumo y reparto por persona
.who-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  margin-top: 0.15rem;
}

.who-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--ink-600);
  margin-right: 0.15rem;
}

.who-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 44px;
  padding: 0 0.85rem;
  border-radius: 999px;
  border: 1.5px solid var(--cream-200);
  background: var(--surface);
  font-size: 0.9rem;
  font-weight: 600;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    transform 0.12s ease;

  i {
    color: var(--navy-600);
  }

  &:hover:not(:disabled):not(.who-btn--on) {
    border-color: var(--navy-600);
  }

  &:active:not(:disabled) {
    transform: scale(0.97);
  }

  &:disabled {
    cursor: progress;
  }

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;

    i {
      color: var(--powder-300);
    }
  }
}

.tag--who {
  background: var(--powder-100);
  color: var(--navy-800);
}

.sharing .muted {
  margin: 0 0 0.6rem;
}

.share-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.share-row {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--cream-100);

  small {
    color: var(--ink-400);
  }

  strong {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  &--loose {
    background: var(--pill-warn-bg);
    color: var(--pill-warn-ink);
  }
}

.share-name {
  font-weight: 600;

  i {
    margin-right: 0.3rem;
  }
}

.share-all {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.6rem;

  span {
    font-size: 0.9rem;
    font-weight: 600;
  }
}

.assign-name {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-weight: 600;

  small {
    font-weight: 500;
    color: var(--ink-400);
  }
}

// Por porcentaje
.pct-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.pct-chip {
  min-height: 44px;
  padding: 0 1rem;
  border-radius: 999px;
  border: 1.5px solid var(--cream-200);
  background: var(--surface);
  font-weight: 700;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }
}

.pct-input {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-height: 44px;
  padding: 0 0.75rem;
  border: 1.5px solid var(--cream-200);
  border-radius: 999px;
  background: #fff;

  input {
    width: 4.5rem;
    border: none;
    outline: none;
    background: transparent;
    font-weight: 700;
    font-size: 1rem;
    text-align: right;
  }
}

.tool--sm {
  min-height: 36px;
  padding: 0 0.7rem;
  font-size: 0.82rem;
}

.tag--agency {
  background: var(--pill-warn-bg) !important;
  color: var(--pill-warn-ink) !important;
}

.btn-collect {
  min-height: 56px;
  font-size: 1.0625rem;
}

// Para el pasajero
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

.qr-top {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  width: 100%;
  padding: 0.6rem 0.75rem;
  background: var(--powder-100);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s ease;

  &:hover {
    border-color: var(--line-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--navy-700);
    outline-offset: 2px;
  }

  :deep(.qr) {
    flex-shrink: 0;
  }

  &--big {
    flex-direction: column;
    text-align: center;
    padding: 1rem;
  }
}

.qr-top-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;

  strong {
    font-size: 1rem;
    color: var(--navy-800);

    i {
      margin-right: 0.3rem;
    }
  }

  small {
    font-size: 0.9375rem;
    color: var(--ink-600);
  }
}

.qr-top-hint {
  color: var(--navy-700) !important;
  font-weight: 500;
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
