<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
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

const toast = useToastStore()
const userStore = useUserStore()

const { play } = useSound()

const payments = ref<Payment[]>([])
const from = shallowRef('')
const to = shallowRef('')
const loading = shallowRef(true)
const loadingMore = shallowRef(false)
const hasMore = shallowRef(false)
const sentinel = shallowRef<HTMLElement | null>(null)

const INVOICE_LABELS: Record<InvoiceStatus, string> = {
  pendiente: 'Pendiente',
  emitida: 'Emitida',
  error: 'Error',
  no_aplica: 'No aplica',
}

function rangeParams() {
  return {
    from: from.value || undefined,
    to: to.value ? `${to.value}T23:59:59` : undefined,
  }
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

async function retry(payment: Payment) {
  try {
    await apiRetryInvoice(payment._id)
    play('success')
    toast.success('Reintento de factura enviado')
    await refresh()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  }
}

const confirmStore = useConfirmStore()

/** Un cobro con pago o factura no se cancela: se reversa con motivo. */
async function reverse(payment: Payment) {
  const reason = await confirmStore.askReason({
    title: `¿Reversar el cobro de cabina ${payment.cabinNumber}?`,
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
    toast.success('Cobro reversado: la cuenta quedó abierta')
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
    </div>

    <section v-if="loading" class="card table-card">
      <SkeletonList variant="row" :rows="8" />
    </section>

    <section v-else class="card table-card">
      <table class="table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Salida</th>
            <th>Cabina</th>
            <th>Total</th>
            <th>Método</th>
            <th>Cobró</th>
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
            <td class="method">{{ payment.method }}</td>
            <td>{{ collectorName(payment) }}</td>
            <td>
              <span v-if="payment.status === 'reversado'" class="pill pill--error" :title="payment.reverseReason">
                Reversado
              </span>
              <template v-else>
                <span class="pill" :class="`pill--${payment.invoiceStatus}`">
                  {{ INVOICE_LABELS[payment.invoiceStatus] }}
                </span>
                <button
                  v-if="userStore.isAdmin && (payment.invoiceStatus === 'pendiente' || payment.invoiceStatus === 'error')"
                  type="button"
                  class="retry"
                  @click="retry(payment)"
                >
                  Reintentar
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
            <td colspan="8" class="empty">Sin cobros en este rango.</td>
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
  max-width: 420px;
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

.method {
  text-transform: capitalize;
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
  margin-left: 0.4rem;
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
