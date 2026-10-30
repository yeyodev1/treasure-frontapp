<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { apiPayments, apiRetryInvoice, apiReversePayment } from '@/services/api'
import { useConfirmStore } from '@/stores/confirm'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney, formatDateTime } from '@/utils/format'
import BaseDatePicker from '@/components/ui/BaseDatePicker.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import { useInfiniteScroll } from '@/composables/useInfiniteScroll'
import { useSound } from '@/composables/useSound'
import type { InvoiceStatus, Payment } from '@/types'

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
/** Desde las alertas del resumen: solo facturas pendientes. */
const onlyPending = shallowRef(route.query.factura === 'pendiente')

const INVOICE_LABELS: Record<InvoiceStatus, string> = {
  pendiente: 'Factura pendiente',
  emitiendo: 'Emitiendo factura…',
  emitida: 'Factura emitida',
  error: 'Factura pendiente',
  no_aplica: 'Sin factura',
}

const METHOD_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  online: 'Pago en línea',
}

function rangeParams() {
  return {
    // Días completos en hora de Galápagos (el servidor interpreta 'YYYY-MM-DD').
    from: from.value || undefined,
    to: to.value || undefined,
    invoice: onlyPending.value ? ('pendiente' as const) : undefined,
  }
}

function togglePending() {
  onlyPending.value = !onlyPending.value
  router.replace({ query: onlyPending.value ? { factura: 'pendiente' } : {} })
  refresh()
}

async function refresh() {
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

onMounted(refresh)

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

/** Un cobro con pago o factura no se cancela: se reversa con motivo. */
async function reverse(payment: Payment) {
  const reason = await confirmStore.askReason({
    title: `¿Reversar el pago de cabina ${payment.cabinNumber}?`,
    message: `${formatMoney(payment.total)} · la cuenta vuelve a abrirse para corregirla y aprobarla de nuevo.${
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
    toast.success('Pago reversado: la cuenta quedó abierta')
    await refresh()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  }
}

function cruiseName(payment: Payment): string {
  return typeof payment.cruise === 'object' ? payment.cruise.code || payment.cruise.name : ''
}

function collectorName(payment: Payment): string {
  return typeof payment.collectedBy === 'object' ? payment.collectedBy.name : ''
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">Cobros y facturas</h1>

    <div class="filters">
      <div class="field">
        <label id="f-from-label">Desde</label>
        <BaseDatePicker v-model="from" clearable aria-labelledby="f-from-label" @update:model-value="refresh" />
      </div>
      <div class="field">
        <label id="f-to-label">Hasta</label>
        <BaseDatePicker v-model="to" clearable aria-labelledby="f-to-label" @update:model-value="refresh" />
      </div>
      <button
        type="button"
        class="pending-toggle"
        :class="{ 'pending-toggle--on': onlyPending }"
        :aria-pressed="onlyPending"
        @click="togglePending"
      >
        <i class="fa-solid fa-file-circle-exclamation" aria-hidden="true" /> Solo facturas pendientes
      </button>
    </div>

    <section v-if="loading" class="card table-card">
      <SkeletonList variant="row" :rows="8" />
    </section>

    <section v-else class="card table-card">
      <table class="table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Crucero</th>
            <th>Cabina</th>
            <th>Total</th>
            <th>Método</th>
            <th>Cobró</th>
            <th>Pago</th>
            <th>Factura</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="payment in payments" :key="payment._id" :class="{ reversed: payment.status === 'reversado' }">
            <td>{{ formatDateTime(payment.createdAt) }}</td>
            <td>{{ cruiseName(payment) }}</td>
            <td>{{ payment.cabinNumber }}</td>
            <td><strong>{{ formatMoney(payment.total) }}</strong></td>
            <td>{{ METHOD_LABELS[payment.method] ?? payment.method }}</td>
            <td>{{ collectorName(payment) }}</td>
            <td>
              <span v-if="payment.status === 'reversado'" class="pill pill--error" :title="payment.reverseReason">
                Pago reversado
              </span>
              <span v-else class="pill pill--emitida">Pago registrado</span>
            </td>
            <td>
              <span v-if="payment.status === 'reversado'" class="muted">—</span>
              <template v-else>
                <span class="pill" :class="`pill--${payment.invoiceStatus}`">
                  {{ INVOICE_LABELS[payment.invoiceStatus] }}
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
                <small
                  v-if="payment.invoiceStatus !== 'emitida' && payment.invoiceError"
                  class="invoice-error"
                  :class="{ 'invoice-error--soft': payment.invoiceStatus === 'pendiente' }"
                >
                  {{ payment.invoiceError }}
                </small>
                <button
                  v-if="userStore.isDirector && (payment.invoiceStatus === 'pendiente' || payment.invoiceStatus === 'error')"
                  type="button"
                  class="retry"
                  :disabled="retrying === payment._id"
                  @click="retry(payment)"
                >
                  {{ retrying === payment._id ? 'Emitiendo…' : 'Reintentar emisión de factura' }}
                </button>
              </template>
            </td>
            <td>
              <button
                v-if="userStore.isAdmin && payment.status !== 'reversado'"
                type="button"
                class="reverse"
                @click="reverse(payment)"
              >
                <i class="fa-solid fa-rotate-left" aria-hidden="true" /> Reversar
              </button>
              <span v-else-if="payment.status === 'reversado'" class="reverse-reason">{{ payment.reverseReason }}</span>
            </td>
          </tr>
          <tr v-if="!payments.length">
            <td colspan="9" class="empty">{{ onlyPending ? 'Sin facturas pendientes en este rango.' : 'Sin cobros en este rango.' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="hasMore" ref="sentinel" class="sentinel">
        <BaseSpinner v-if="loadingMore" label="Cargando más cobros…" />
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.filters {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  max-width: 640px;

  @include tablet {
    grid-template-columns: 1fr 1fr auto;
  }
  margin-bottom: 1rem;
}

.table-card {
  overflow-x: auto;
  padding: 0.5rem;

  @include tablet {
    padding: 0.75rem;
  }
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;

  th {
    text-align: left;
    font-size: 0.72rem;
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
    white-space: nowrap;
  }
}

.pending-toggle {
  align-self: end;
  grid-column: 1 / -1;
  justify-self: start;

  @include tablet {
    grid-column: auto;
  }

  min-height: 44px;
  padding: 0 0.9rem;
  border-radius: 999px;
  border: 1.5px solid var(--cream-200);
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--ink-600);
  white-space: nowrap;
  transition:
    background 0.18s ease,
    color 0.18s ease,
    border-color 0.18s ease;

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: var(--cream-100);
  }
}

.muted {
  color: var(--ink-400);
}

.pill {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: var(--cream-200);

  &--emitida {
    background: rgba(63, 174, 106, 0.15);
    color: var(--success);
  }

  &--pendiente {
    background: rgba(232, 161, 60, 0.18);
    color: #9a6a16;
  }

  &--error {
    background: rgba(224, 82, 82, 0.15);
    color: var(--danger);
  }

  &--emitiendo {
    background: rgba(200, 215, 231, 0.5);
    color: var(--navy-600);
  }
}

.invoice-link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-left: 0.4rem;
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--navy-600);
  white-space: nowrap;
  transition: opacity 0.15s ease;

  &:hover {
    opacity: 0.75;
  }
}

.invoice-error {
  display: block;
  max-width: 260px;
  margin-top: 0.25rem;
  font-size: 0.72rem;
  line-height: 1.3;
  color: var(--danger);
  white-space: normal;

  &--soft {
    color: #9a6a16;
  }
}

.reverse {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--danger);
  white-space: nowrap;
}

.reverse-reason {
  font-size: 0.76rem;
  color: var(--ink-400);
}

tr.reversed td {
  opacity: 0.6;
}

.retry {
  display: block;
  margin-top: 0.3rem;
  min-height: 32px;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--navy-600);
  text-decoration: underline;
}

.empty {
  color: var(--ink-400);
  text-align: center;
  padding: 1rem;
}

.sentinel {
  min-height: 12px;
}
</style>
