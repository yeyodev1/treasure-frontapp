<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { apiCruises, apiDepositCash, apiDropInvoice, apiPayments, apiRetryInvoice, apiReversePayment } from '@/services/api'
import { useConfirmStore } from '@/stores/confirm'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney, formatDateTime } from '@/utils/format'
import { fmt } from '@/components/owner/insights'
import BaseDatePicker from '@/components/ui/BaseDatePicker.vue'
import CruiseMonthCalendar from '@/components/payments/CruiseMonthCalendar.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import { useInfiniteScroll } from '@/composables/useInfiniteScroll'
import { useSound } from '@/composables/useSound'
import type { BillingLine, Cruise, InvoiceStatus, Payment } from '@/types'

/**
 * Cobros y facturas: el pago registrado y la factura son estados separados
 * (checklist 29-oct, 03). Reintentar solo vuelve a emitir el documento.
 */
const toast = useToastStore()
const userStore = useUserStore()
const route = useRoute()
const router = useRouter()

const { play } = useSound()

const payments = ref<Payment[]>([])
const from = shallowRef('')
const to = shallowRef('')
const loading = shallowRef(true)
const loadingMore = shallowRef(false)
const hasMore = shallowRef(false)
const sentinel = shallowRef<HTMLElement | null>(null)
/**
 * Por crucero (calendario, pedido de Gerencia 23-nov-2026) con los cobros
 * divididos en bar y wetsuits; todos los cobros por fechas; o solo las
 * facturas pendientes (desde las alertas del resumen).
 */
type View = 'crucero' | 'todos' | 'pendiente' | 'efectivo'
const view = shallowRef<View>(route.query.factura === 'pendiente' ? 'pendiente' : route.query.metodo === 'efectivo' ? 'efectivo' : 'crucero')
/** Efectivo que sigue en caja (desde «Dónde está la plata» del Resumen). */
// Pestaña propia (pedido de Gerencia, 26-nov-2026): mezclada con el filtro de línea no se entendía.
const cashOnly = computed(() => view.value === 'efectivo')
const onlyPending = computed(() => view.value === 'pendiente')
const cruises = shallowRef<Cruise[]>([])
const cruiseId = shallowRef('')
/** Filtro de línea fuera del calendario: '' = bar y wetsuits. */
const line = shallowRef<'' | BillingLine>('')
const LINES: Array<{ value: '' | BillingLine; label: string }> = [
  { value: '', label: 'Bar y wetsuits' },
  { value: 'bar', label: 'Bar' },
  { value: 'wetsuit', label: 'Wetsuits' },
]

/** Paso de la factura en el SRI, en palabras claras (12-nov-2026). */
const SRI_LABELS: Record<string, string> = {
  Autorizado: 'Autorizada por el SRI',
  'Enviado SRI': 'Enviada al SRI, esperando su autorización',
  'Enviado Sri': 'Enviada al SRI, esperando su autorización',
  Firmado: 'Firmada en Contífico, todavía no enviada al SRI',
  'No se ha firmado': 'Contífico todavía no la firma',
  Anulada: 'Anulada en Contífico',
}

/** Firmada o sin firmar en Contífico por más de 2 h: no llegó al SRI y hay que revisarla allá. */
function stuckAtSri(p: { invoiceStatus: string; invoiceSriStatus?: string; createdAt: string }): boolean {
  if (p.invoiceStatus !== 'emitida') return false
  if (p.invoiceSriStatus !== 'Firmado' && p.invoiceSriStatus !== 'No se ha firmado') return false
  return Date.now() - new Date(p.createdAt).getTime() > 2 * 60 * 60 * 1000
}

const INVOICE_LABELS: Record<InvoiceStatus, string> = {
  pendiente: 'Factura pendiente',
  emitiendo: 'Emitiendo factura…',
  emitida: 'Factura emitida',
  error: 'Factura pendiente',
  no_aplica: 'Sin factura',
  parcial: 'Va en la factura del pago final',
}

const METHOD_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  online: 'Pago en línea',
}

function rangeParams() {
  // Un crucero entero de una vez, para dividirlo en bar y wetsuits.
  if (view.value === 'crucero') return { cruiseId: cruiseId.value, limit: 300 }
  return {
    // Días completos en hora de Galápagos (el servidor interpreta 'YYYY-MM-DD').
    from: from.value || undefined,
    to: to.value || undefined,
    // El efectivo en caja es de bar y wetsuits juntos: ahí no aplica el filtro de línea.
    line: cashOnly.value ? undefined : line.value || undefined,
    invoice: onlyPending.value ? ('pendiente' as const) : undefined,
    deposit: cashOnly.value ? ('pendiente' as const) : undefined,
  }
}

/** Depósito del efectivo en el banco (especificación del Resumen, bloque 8). */
const depositPick = shallowRef<Set<string>>(new Set())
const depositRef = shallowRef('')
const depositing = shallowRef(false)
const depositTotal = computed(() => payments.value.filter((p) => depositPick.value.has(p._id)).reduce((s, p) => s + p.total, 0))
function togglePickDeposit(id: string) {
  const next = new Set(depositPick.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  depositPick.value = next
}
async function registerDeposit() {
  if (depositing.value || !depositPick.value.size) return
  depositing.value = true
  try {
    const result = await apiDepositCash([...depositPick.value], depositRef.value.trim())
    play('success')
    toast.success(`Depósito registrado: ${result.deposited} cobro(s) · ${formatMoney(result.total)}`)
    depositPick.value = new Set()
    depositRef.value = ''
    await refresh()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    depositing.value = false
  }
}

function setView(next: View) {
  if (view.value === next) return
  view.value = next
  depositPick.value = new Set()
  router.replace({ query: next === 'pendiente' ? { factura: 'pendiente' } : next === 'efectivo' ? { metodo: 'efectivo' } : {} })
  refresh()
}

function setLine(next: '' | BillingLine) {
  line.value = next
  refresh()
}

async function refresh() {
  if (view.value === 'crucero' && !cruiseId.value) {
    payments.value = []
    hasMore.value = false
    loading.value = false
    return
  }
  loading.value = true
  try {
    const data = await apiPayments(rangeParams())
    payments.value = data.payments
    hasMore.value = data.hasMore
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

/** Siguiente página del historial de cobros (scroll infinito). */
async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  const last = payments.value[payments.value.length - 1]
  if (!last) return
  loadingMore.value = true
  try {
    const data = await apiPayments({ ...rangeParams(), before: last.createdAt })
    payments.value = [...payments.value, ...data.payments]
    hasMore.value = data.hasMore
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loadingMore.value = false
  }
}

useInfiniteScroll({ sentinel, onReach: loadMore })

onMounted(async () => {
  try {
    cruises.value = (await apiCruises()).sort((a, b) => b.startDate.localeCompare(a.startDate))
    // Abre en el crucero pedido (desde el Resumen), en el que está en curso o en el último que salió.
    const today = new Date().toISOString()
    const asked = String(route.query.crucero ?? '')
    cruiseId.value =
      cruises.value.find((c) => c._id === asked)?._id ??
      cruises.value.find((c) => c.status === 'abordo')?._id ??
      cruises.value.find((c) => c.startDate <= today)?._id ??
      cruises.value[0]?._id ??
      ''
  } catch {
    // Sin la lista de cruceros se ven todos los cobros.
    if (view.value === 'crucero') view.value = 'todos'
  }
  await refresh()
})

const day = (d: string) => fmt(d, { day: 'numeric', month: 'short' })
const selectedCruise = computed(() => cruises.value.find((c) => c._id === cruiseId.value))
const cruiseCode = computed(() => (view.value === 'crucero' ? (selectedCruise.value?.code ?? '') : ''))

/** Lo recibido (los reversados no cuentan). */
const received = (list: Payment[]) => list.filter((p) => p.status !== 'reversado').reduce((sum, p) => sum + p.total, 0)

/** En el calendario, el crucero se lee dividido en bar y wetsuits. */
const sections = computed(() => {
  if (view.value !== 'crucero') return [{ key: 'all', label: '', icon: '', items: payments.value }]
  return [
    { key: 'bar', label: 'Bar', icon: 'fa-martini-glass-citrus', items: payments.value.filter((p) => p.line !== 'wetsuit') },
    { key: 'wetsuit', label: 'Wetsuits', icon: 'fa-person-swimming', items: payments.value.filter((p) => p.line === 'wetsuit') },
  ]
})

const retrying = shallowRef('')

async function retry(payment: Payment) {
  if (retrying.value) return
  retrying.value = payment._id
  try {
    const updated = await apiRetryInvoice(payment._id)
    // Solo se afirma la emisión si el documento quedó emitido.
    if (updated.invoiceStatus === 'emitida') {
      play('success')
      toast.success(`Factura ${updated.invoiceNumber ?? ''} emitida`)
    } else {
      play('error')
      toast.push(
        `Factura pendiente. ${updated.invoiceError || 'No se pudo emitir. Intenta de nuevo más tarde.'}`,
        updated.invoiceStatus === 'error' ? 'error' : 'info',
      )
    }
    await refresh()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    retrying.value = ''
  }
}

const confirmStore = useConfirmStore()

/** La factura que no se va a emitir se elimina; el pago queda registrado. */
async function dropInvoice(payment: Payment) {
  const reason = await confirmStore.askReason({
    title: `¿Eliminar la factura pendiente de cabina ${payment.cabinNumber}?`,
    message: `${formatMoney(payment.total)} · el pago sigue registrado, sin factura. Ya no sale en «Facturas pendientes».`,
    confirmLabel: 'Eliminar factura',
    danger: true,
    icon: 'fa-file-circle-xmark',
    reason: { label: 'Motivo (obligatorio)', suggestions: ['Se facturó por fuera', 'El cliente no quiere factura'] },
  })
  if (!reason) return
  try {
    await apiDropInvoice(payment._id, reason)
    play('success')
    toast.success('Factura eliminada: el pago sigue registrado')
    await refresh()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  }
}

/** Un cobro con pago o factura no se cancela: se reversa con motivo. */
async function reverse(payment: Payment) {
  const reason = await confirmStore.askReason({
    title: `¿Reversar el pago de cabina ${payment.cabinNumber}?`,
    message:
      payment.settled === false
        ? `${formatMoney(payment.total)} · pago parcial: vuelve al saldo de la cuenta y la aprobación se mantiene.`
        : `${formatMoney(payment.total)} · la cuenta vuelve a abrirse para corregirla y aprobarla de nuevo.${
            payment.invoiceStatus === 'emitida' ? ' La factura emitida requiere nota de crédito en Contífico.' : ''
          }`,
    confirmLabel: 'Reversar',
    danger: true,
    icon: 'fa-rotate-left',
    reason: { label: 'Motivo (obligatorio)', suggestions: ['Método de pago equivocado', 'Cargo mal cobrado'] },
  })
  if (!reason) return
  try {
    await apiReversePayment(payment._id, reason)
    play('success')
    toast.success(payment.settled === false ? 'Pago parcial reversado: volvió al saldo' : 'Pago reversado: la cuenta quedó abierta')
    await refresh()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  }
}

/** Suma de lo recibido en la lista. */
const listTotal = computed(() => received(payments.value))
/** Cobrado del crucero por forma de pago (pedido de Gerencia, 24-nov-2026). */
const byMethod = computed(() =>
  (['tarjeta', 'efectivo', 'transferencia', 'online'] as const)
    .map((m) => ({ method: m, total: received(payments.value.filter((p) => p.method === m)) }))
    .filter((m) => m.total > 0),
)
const reversedCount = computed(() => payments.value.filter((p) => p.status === 'reversado').length)

function cruiseName(payment: Payment): string {
  return typeof payment.cruise === 'object' ? payment.cruise.code || payment.cruise.name : ''
}

function collectorName(payment: Payment): string {
  return typeof payment.collectedBy === 'object' ? payment.collectedBy.name : ''
}
</script>

<template>
  <div class="page payments-page">
    <header class="head">
      <h1 class="page-title">Cobros y facturas</h1>
      <p class="subtitle">Cada pago registrado y, por separado, el estado de su factura.</p>
    </header>

    <div class="filters">
      <div class="view" role="tablist" aria-label="Qué mostrar">
        <button
          type="button"
          role="tab"
          class="view-btn"
          :class="{ 'view-btn--on': view === 'crucero' }"
          :aria-selected="view === 'crucero'"
          @click="setView('crucero')"
        >
          <i class="fa-solid fa-calendar-days" aria-hidden="true" /> Por crucero
        </button>
        <button
          type="button"
          role="tab"
          class="view-btn"
          :class="{ 'view-btn--on': view === 'todos' }"
          :aria-selected="view === 'todos'"
          @click="setView('todos')"
        >
          Todos los cobros
        </button>
        <button
          type="button"
          role="tab"
          class="view-btn"
          :class="{ 'view-btn--on': view === 'pendiente' }"
          :aria-selected="view === 'pendiente'"
          @click="setView('pendiente')"
        >
          <i class="fa-solid fa-file-circle-exclamation" aria-hidden="true" /> Facturas pendientes
        </button>
        <button
          v-if="userStore.isAdmin"
          type="button"
          role="tab"
          class="view-btn"
          :class="{ 'view-btn--on': view === 'efectivo' }"
          :aria-selected="view === 'efectivo'"
          @click="setView('efectivo')"
        >
          <i class="fa-solid fa-money-bill-wave" aria-hidden="true" /> Efectivo sin depositar
        </button>
      </div>
      <div v-if="view !== 'crucero' && view !== 'efectivo'" class="line-filter">
        <span class="field-label" id="f-line-label">Línea</span>
        <div class="view view--line" role="group" aria-labelledby="f-line-label">
            <button
              v-for="l in LINES"
              :key="l.value"
              type="button"
              class="view-btn"
              :class="{ 'view-btn--on': line === l.value }"
              :aria-pressed="line === l.value"
              @click="setLine(l.value)"
            >
              {{ l.label }}
            </button>
        </div>
      </div>
      <div v-if="view !== 'crucero'" class="dates">
        <div class="field">
          <label id="f-from-label">Desde</label>
          <BaseDatePicker v-model="from" clearable aria-labelledby="f-from-label" @update:model-value="refresh" />
        </div>
        <div class="field">
          <label id="f-to-label">Hasta</label>
          <BaseDatePicker v-model="to" clearable aria-labelledby="f-to-label" @update:model-value="refresh" />
        </div>
      </div>
    </div>

    <CruiseMonthCalendar v-if="view === 'crucero' && cruises.length" v-model="cruiseId" :cruises="cruises" @update:model-value="refresh" />

    <section v-if="loading" class="list-card">
      <SkeletonList variant="row" :rows="6" />
    </section>

    <section v-else class="list-card" aria-label="Cobros">
      <h2 v-if="selectedCruise && view === 'crucero'" class="cruise-title">
        Crucero {{ selectedCruise.code }}
        <small>{{ day(selectedCruise.startDate) }}<template v-if="selectedCruise.endDate"> – {{ day(selectedCruise.endDate) }}</template></small>
      </h2>
      <ul v-if="view === 'crucero' && byMethod.length" class="methods" aria-label="Cobrado por forma de pago">
        <li v-for="m in byMethod" :key="m.method">
          <span>{{ METHOD_LABELS[m.method] }}</span><strong>{{ formatMoney(m.total) }}</strong>
        </li>
      </ul>
      <p v-if="payments.length" class="count">
        {{ payments.length }}{{ hasMore ? '+' : '' }} {{ payments.length === 1 ? 'cobro' : 'cobros' }}
        <template v-if="!hasMore">
          · {{ formatMoney(listTotal) }} recibido<template v-if="reversedCount">
            · {{ reversedCount }} {{ reversedCount === 1 ? 'reversado' : 'reversados' }} no suman</template
          >
        </template>
      </p>

      <section v-for="section in sections" :key="section.key" class="line-section" :aria-label="section.label || undefined">
      <h3 v-if="section.label" class="line-title">
        <span><i class="fa-solid" :class="section.icon" aria-hidden="true" /> {{ section.label }}</span>
        <span class="line-sum">
          {{ section.items.length }} {{ section.items.length === 1 ? 'cobro' : 'cobros' }} ·
          <strong>{{ formatMoney(received(section.items)) }}</strong>
        </span>
      </h3>
      <p v-if="section.label && !section.items.length" class="empty empty--line">Sin cobros de {{ section.label.toLowerCase() }} en este crucero.</p>
      <div v-if="section.items.length" class="grid-head" aria-hidden="true">
        <span>Fecha</span>
        <span>Cabina</span>
        <span>Método</span>
        <span class="num">Monto</span>
        <span>Pago y factura</span>
      </div>

      <TransitionGroup tag="ul" name="list" class="rows">
        <li
          v-for="payment in section.items"
          :key="payment._id"
          class="row"
          :class="{ 'row--reversed': payment.status === 'reversado' }"
        >
          <span class="c-date">
            <input
              v-if="cashOnly && payment.method === 'efectivo' && !payment.deposit && payment.status !== 'reversado'"
              type="checkbox"
              class="deposit-check"
              :checked="depositPick.has(payment._id)"
              :aria-label="`Depositado: cabina ${payment.cabinNumber}, ${formatMoney(payment.total)}`"
              @change="togglePickDeposit(payment._id)"
            />
            {{ formatDateTime(payment.createdAt) }}
          </span>
          <span class="c-id">
            <strong>Cabina {{ payment.cabinNumber }}<template v-if="payment.line === 'wetsuit'"> · Wetsuits</template></strong>
            <small v-if="cruiseName(payment)">Crucero {{ cruiseName(payment) }}</small>
          </span>
          <span class="c-method">
            {{ METHOD_LABELS[payment.method] ?? payment.method }}
            <small v-if="collectorName(payment)">cobró {{ collectorName(payment) }}</small>
          </span>
          <strong class="c-amount">{{ formatMoney(payment.total) }}</strong>

          <span class="c-states">
            <span v-if="payment.status === 'reversado'" class="pill pill--error">
              <i class="fa-solid fa-rotate-left" aria-hidden="true" /> Pago reversado
            </span>
            <template v-else>
              <span class="pill pill--paid">
                <i class="fa-solid fa-check" aria-hidden="true" />
                {{ payment.invoiceStatus === 'parcial' ? 'Pago parcial' : 'Pago registrado' }}
              </span>
              <span class="pill" :class="`pill--${payment.invoiceStatus}`">
                <i class="fa-regular fa-file-lines" aria-hidden="true" />
                {{ INVOICE_LABELS[payment.invoiceStatus] }}
              </span>
              <span v-if="payment.method === 'efectivo' && payment.deposit" class="pill pill--paid">
                <i class="fa-solid fa-building-columns" aria-hidden="true" /> Depositado
              </span>
              <span v-if="payment.billing?.noEmail" class="pill pill--no-email">
                <i class="fa-solid fa-envelope-circle-check" aria-hidden="true" /> Sin correo del cliente
              </span>
              <a
                v-if="payment.invoiceStatus === 'emitida' && payment.invoiceNumber"
                class="invoice-link"
                :href="payment.invoiceUrl || undefined"
                target="_blank"
                rel="noopener"
              >
                <i class="fa-solid fa-file-pdf" aria-hidden="true" /> {{ payment.invoiceNumber }}
              </a>
              <small v-if="stuckAtSri(payment)" class="invoice-error">
                Lleva más de 2 horas sin llegar al SRI. El sistema lo sigue reintentando; si no avanza, ábrela en
                Contífico y toca «Enviar al SRI» para ver el motivo.
              </small>
              <small v-else-if="payment.invoiceStatus === 'emitida' && payment.invoiceSriStatus" class="invoice-sri">
                {{ SRI_LABELS[payment.invoiceSriStatus] ?? payment.invoiceSriStatus }}<template
                  v-if="payment.invoiceEmail?.status === 'enviado'"
                > · enviada a {{ payment.invoiceEmail.to }}</template><template
                  v-else-if="payment.invoiceEmail?.status === 'error'"
                > · correo no enviado: {{ payment.invoiceEmail.error }}</template>
              </small>
            </template>
            <small
              v-if="payment.status !== 'reversado' && payment.invoiceStatus !== 'emitida' && payment.invoiceError"
              class="invoice-error"
              :class="{ 'invoice-error--soft': payment.invoiceStatus !== 'error' }"
            >
              {{ payment.invoiceError }}
            </small>
            <small v-if="payment.status === 'reversado' && payment.reverseReason" class="reverse-reason">
              {{ payment.reverseReason }}
            </small>
          </span>

          <span
            v-if="
              payment.status !== 'reversado' &&
              ((userStore.isDirector && (payment.invoiceStatus === 'pendiente' || payment.invoiceStatus === 'error')) ||
                userStore.isAdmin)
            "
            class="c-actions"
          >
            <button
              v-if="userStore.isDirector && (payment.invoiceStatus === 'pendiente' || payment.invoiceStatus === 'error')"
              type="button"
              class="act"
              :disabled="retrying === payment._id"
              @click="retry(payment)"
            >
              <i class="fa-solid fa-rotate" :class="{ 'fa-spin': retrying === payment._id }" aria-hidden="true" />
              {{ retrying === payment._id ? 'Emitiendo…' : 'Reintentar emisión de factura' }}
            </button>
            <button
              v-if="userStore.isAdmin && (payment.invoiceStatus === 'pendiente' || payment.invoiceStatus === 'error')"
              type="button"
              class="act act--danger"
              @click="dropInvoice(payment)"
            >
              <i class="fa-solid fa-file-circle-xmark" aria-hidden="true" /> Eliminar factura
            </button>
            <button v-if="userStore.isAdmin" type="button" class="act act--danger" @click="reverse(payment)">
              <i class="fa-solid fa-rotate-left" aria-hidden="true" /> Reversar
            </button>
          </span>
        </li>
      </TransitionGroup>
      </section>

      <div v-if="cashOnly && payments.length" class="deposit-bar">
        <input v-model="depositRef" type="text" maxlength="80" aria-label="Referencia del depósito" placeholder="Nº de papeleta o referencia" />
        <button type="button" class="act" :disabled="!depositPick.size || depositing" @click="registerDeposit">
          <i class="fa-solid" :class="depositing ? 'fa-spinner fa-spin' : 'fa-building-columns'" aria-hidden="true" />
          Registrar depósito<template v-if="depositPick.size"> · {{ depositPick.size }} · {{ formatMoney(depositTotal) }}</template>
        </button>
      </div>

      <p v-if="!payments.length && view !== 'crucero'" class="empty">
        <template v-if="cashOnly">Todo el efectivo está depositado. No hay efectivo en caja{{ from || to ? ' en estas fechas' : '' }}.</template>
        <template v-else>{{ onlyPending ? 'Sin facturas pendientes' : 'Sin cobros' }}{{ line === 'wetsuit' ? ' de wetsuits' : line === 'bar' ? ' del bar' : '' }} en este rango.</template>
      </p>
      <div v-if="hasMore" ref="sentinel" class="sentinel">
        <BaseSpinner v-if="loadingMore" label="Cargando más cobros…" />
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

/*
 * Cobros: una fila por pago. En tableta y celular cada fila se lee en tres
 * líneas (cabina y monto, fecha y método, estados); desde 1100 px las mismas
 * celdas se alinean en columnas bajo un encabezado.
 */
.payments-page {
  --line: #dbe4eb;
  --line-strong: #c3d1dc;
  --muted: #55636d;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.head .page-title {
  margin-bottom: 0.2rem;
}

.subtitle {
  margin: 0;
  font-size: 1rem;
  color: var(--muted);
}

.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem 1rem;
}

.view {
  display: inline-flex;
  flex: none;
  max-width: 100%;
  overflow-x: auto;
  padding: 4px;
  border-radius: 999px;
  background: var(--powder-100);
}

.view-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 44px;
  padding: 0 1.1rem;
  border-radius: 999px;
  font-size: 1rem;
  font-weight: 500;
  white-space: nowrap;
  color: var(--ink-600);
  transition:
    background 0.18s ease,
    color 0.18s ease;

  &--on {
    background: var(--navy-800);
    color: #fff;
  }
}

.dates {
  flex: 1 1 360px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 0.75rem;
  max-width: 780px;

  .field label {
    font-size: 0.9375rem;
  }
}

.field-label {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--ink-900);
}

.methods {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.6rem 0 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    flex-direction: column;
    flex: 1 1 140px;
    padding: 0.55rem 0.8rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--cream-100);

    span {
      font-size: 0.85rem;
      color: var(--muted);
    }

    strong {
      font-size: 1.1rem;
      font-variant-numeric: tabular-nums;
    }
  }
}

.line-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;

  .field-label {
    margin: 0;
  }
}

.view--line {
  display: flex;

  .view-btn {
    flex: 1 1 auto;
    justify-content: center;
    padding: 0 0.8rem;
  }
}

.cruise-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 0.6rem;
  margin: 0.75rem 0 0;
  font-size: 1.25rem;
  color: var(--navy-900);

  small {
    font-size: 0.95rem;
    font-weight: 400;
    color: var(--muted);
  }
}

.line-section + .line-section {
  margin-top: 0.75rem;
}

.line-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.25rem 1rem;
  margin: 0;
  padding: 0.75rem 0.85rem;
  border-radius: var(--radius-sm);
  background: var(--powder-100);
  font-size: 1.1rem;
  color: var(--navy-900);

  i {
    margin-right: 0.3rem;
    color: var(--navy-700);
  }
}

.line-sum {
  font-size: 0.95rem;
  font-weight: 400;
  color: var(--ink-600);
  font-variant-numeric: tabular-nums;

  strong {
    font-size: 1.05rem;
    color: var(--navy-900);
  }
}

.deposit-check {
  width: 22px;
  height: 22px;
  margin-right: 0.4rem;
  vertical-align: middle;
  accent-color: var(--navy-700);
}

.deposit-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.75rem 0;
  border-top: 1px solid var(--line);
  background: var(--surface);

  input {
    flex: 1 1 220px;
    min-height: 44px;
    padding: 0 0.75rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    font-size: 1rem;
  }
}

.empty--line {
  margin-top: 0.5rem;
}

.list-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 0.25rem 1rem 0.5rem;

  @include tablet {
    padding: 0.5rem 1.25rem 0.75rem;
  }
}

.count {
  margin: 0;
  padding: 0.75rem 0;
  font-size: 0.9375rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

// Fila en tableta y celular
.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'id amount'
    'meta meta'
    'states states'
    'actions actions';
  gap: 0.3rem 1rem;
  padding: 0.9rem 0;
  border-top: 1px solid var(--line);
  transition: opacity 0.2s ease;

  &--reversed {
    .c-id,
    .c-amount,
    .c-date,
    .c-method {
      opacity: 0.55;
    }

    .c-amount {
      text-decoration: line-through;
    }
  }
}

.c-id {
  grid-area: id;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 0.5rem;

  strong {
    font-size: 1.0625rem;
    font-weight: 500;
  }

  small {
    font-size: 0.9375rem;
    color: var(--muted);
  }
}

.c-amount {
  grid-area: amount;
  justify-self: end;
  font-size: 1.125rem;
  font-weight: 600;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

// En filas apiladas, fecha y método comparten la línea 2.
.c-date,
.c-method {
  grid-area: meta;
  font-size: 0.9375rem;
  color: var(--muted);
}

.c-date {
  justify-self: start;
}

.c-method {
  justify-self: end;
  text-align: right;

  small {
    display: block;
    font-size: 0.875rem;
  }
}

.c-states {
  grid-area: states;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.2rem;
}

.c-actions {
  grid-area: actions;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.35rem;
}

.grid-head {
  display: none;
}

@media (min-width: 1100px) {
  .grid-head,
  .row {
    grid-template-columns: 140px minmax(120px, 1fr) minmax(140px, 1fr) 100px minmax(250px, 1.5fr);
    grid-template-areas: none;
    column-gap: 1.25rem;
    align-items: start;
  }

  .grid-head {
    display: grid;
    padding: 0.25rem 0 0.6rem;
    font-size: 0.875rem;
    color: var(--muted);

    .num {
      text-align: right;
    }
  }

  .c-id,
  .c-amount,
  .c-date,
  .c-method,
  .c-states,
  .c-actions {
    grid-area: auto;
    margin: 0;
  }

  .c-id {
    flex-direction: column;
  }

  .c-date {
    color: var(--ink-900);
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
  }

  .c-method {
    justify-self: start;
    text-align: left;
    color: var(--ink-900);
    font-size: 1rem;

    small {
      color: var(--muted);
    }
  }

  .c-amount {
    font-size: 1rem;
  }

  // Las acciones van bajo los estados, en la misma columna.
  .c-actions {
    grid-column: 5;
    margin-top: 0.4rem;
  }
}

.pill {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  background: #eef2f5;
  color: #3c4a54;

  i {
    font-size: 0.75rem;
  }

  &--paid,
  &--emitida {
    background: #e2efe6;
    color: #255a3b;
  }

  &--pendiente,
  &--emitiendo {
    background: #f7ecdc;
    color: #6f4a16;
  }

  &--error {
    background: #f8e4e1;
    color: #8a2f25;
  }

  &--no-email {
    background: #e8e6f3;
    color: #3d3670;
  }
}

.invoice-link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 32px;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--navy-700);
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: opacity 0.15s ease;

  &:hover {
    opacity: 0.75;
  }
}

.invoice-error,
.reverse-reason {
  flex-basis: 100%;
  font-size: 0.875rem;
  line-height: 1.35;
  color: var(--danger);
}

.invoice-sri {
  flex-basis: 100%;
  font-size: 0.875rem;
  line-height: 1.35;
  color: var(--ink-600);
}

.invoice-error--soft {
  color: #6f4a16;
}

.reverse-reason {
  color: var(--muted);
}

.act {
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
  white-space: nowrap;
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
    opacity: 0.55;
  }

  &--danger {
    color: var(--danger);
  }
}

.empty {
  margin: 0.75rem 0;
  padding: 1rem;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-sm);
  font-size: 1rem;
  color: var(--muted);
}

.sentinel {
  min-height: 12px;
}
</style>
