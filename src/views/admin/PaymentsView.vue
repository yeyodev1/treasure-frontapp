<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { apiPayments, apiRetryInvoice } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney, formatDateTime } from '@/utils/format'
import type { InvoiceStatus, Payment } from '@/types'

const toast = useToastStore()
const userStore = useUserStore()

const payments = ref<Payment[]>([])
const from = shallowRef('')
const to = shallowRef('')

const INVOICE_LABELS: Record<InvoiceStatus, string> = {
  pendiente: 'Pendiente',
  emitida: 'Emitida',
  error: 'Error',
  no_aplica: 'No aplica',
}

async function refresh() {
  try {
    payments.value = await apiPayments({
      from: from.value || undefined,
      to: to.value ? `${to.value}T23:59:59` : undefined,
    })
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

onMounted(refresh)

async function retry(payment: Payment) {
  try {
    await apiRetryInvoice(payment._id)
    toast.success('Reintento de factura enviado')
    await refresh()
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

function cruiseName(payment: Payment): string {
  return typeof payment.cruise === 'object' ? payment.cruise.name : ''
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
        <label for="f-from">Desde</label>
        <input id="f-from" v-model="from" type="date" @change="refresh" />
      </div>
      <div class="field">
        <label for="f-to">Hasta</label>
        <input id="f-to" v-model="to" type="date" @change="refresh" />
      </div>
    </div>

    <section class="card table-card">
      <table class="table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Crucero</th>
            <th>Cabina</th>
            <th>Total</th>
            <th>Método</th>
            <th>Cobró</th>
            <th>Factura</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="payment in payments" :key="payment._id">
            <td>{{ formatDateTime(payment.createdAt) }}</td>
            <td>{{ cruiseName(payment) }}</td>
            <td>{{ payment.cabinNumber }}</td>
            <td><strong>{{ formatMoney(payment.total) }}</strong></td>
            <td class="method">{{ payment.method }}</td>
            <td>{{ collectorName(payment) }}</td>
            <td>
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
            </td>
          </tr>
          <tr v-if="!payments.length">
            <td colspan="7" class="empty">Sin cobros en este rango.</td>
          </tr>
        </tbody>
      </table>
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
</style>
