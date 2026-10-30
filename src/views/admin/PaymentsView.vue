<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
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
  parcial: 'Va en la factura del pago final',
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

/** Suma de lo recibido en la lista (los reversados no cuentan). */
const listTotal = computed(() =>
  payments.value.filter((p) => p.status !== 'reversado').reduce((sum, p) => sum + p.total, 0),
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
          :class="{ 'view-btn--on': !onlyPending }"
          :aria-selected="!onlyPending"
          @click="onlyPending && togglePending()"
        >
          Todos los cobros
        </button>
        <button
          type="button"
          role="tab"
          class="view-btn"
          :class="{ 'view-btn--on': onlyPending }"
          :aria-selected="onlyPending"
          @click="!onlyPending && togglePending()"
        >
          <i class="fa-solid fa-file-circle-exclamation" aria-hidden="true" /> Facturas pendientes
        </button>
      </div>
      <div class="dates">
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

    <section v-if="loading" class="list-card">
      <SkeletonList variant="row" :rows="6" />
    </section>

    <section v-else class="list-card" aria-label="Cobros">
      <p v-if="payments.length" class="count">
        {{ payments.length }}{{ hasMore ? '+' : '' }} {{ payments.length === 1 ? 'cobro' : 'cobros' }}
        <template v-if="!hasMore">
          · {{ formatMoney(listTotal) }} recibido<template v-if="reversedCount">
            · {{ reversedCount }} {{ reversedCount === 1 ? 'reversado' : 'reversados' }} no suman</template
          >
        </template>
      </p>

      <div v-if="payments.length" class="grid-head" aria-hidden="true">
        <span>Fecha</span>
        <span>Cabina</span>
        <span>Método</span>
        <span class="num">Monto</span>
        <span>Pago y factura</span>
      </div>

      <TransitionGroup tag="ul" name="list" class="rows">
        <li
          v-for="payment in payments"
          :key="payment._id"
          class="row"
          :class="{ 'row--reversed': payment.status === 'reversado' }"
        >
          <span class="c-date">{{ formatDateTime(payment.createdAt) }}</span>
          <span class="c-id">
            <strong>Cabina {{ payment.cabinNumber }}</strong>
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
              <a
                v-if="payment.invoiceStatus === 'emitida' && payment.invoiceNumber"
                class="invoice-link"
                :href="payment.invoiceUrl || undefined"
                target="_blank"
                rel="noopener"
              >
                <i class="fa-solid fa-file-pdf" aria-hidden="true" /> {{ payment.invoiceNumber }}
              </a>
            </template>
            <small
              v-if="payment.status !== 'reversado' && payment.invoiceStatus !== 'emitida' && payment.invoiceError"
              class="invoice-error"
              :class="{ 'invoice-error--soft': payment.invoiceStatus === 'pendiente' }"
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
            <button v-if="userStore.isAdmin" type="button" class="act act--danger" @click="reverse(payment)">
              <i class="fa-solid fa-rotate-left" aria-hidden="true" /> Reversar
            </button>
          </span>
        </li>
      </TransitionGroup>

      <p v-if="!payments.length" class="empty">
        {{ onlyPending ? 'Sin facturas pendientes en este rango.' : 'Sin cobros en este rango.' }}
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  max-width: 520px;

  .field label {
    font-size: 0.9375rem;
  }
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
