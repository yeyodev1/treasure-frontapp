<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseDatePicker from '@/components/ui/BaseDatePicker.vue'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { apiCommissions, apiCreateCommissionPayment, apiVoidCommissionPayment } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDate, formatDateTime, formatDayKey, formatMoney, todayKey } from '@/utils/format'
import type { CommissionPaymentRow, CommissionSummary, CruiseCommission } from '@/types'

/**
 * Comisiones del bartender (pedido de Gerencia, 3-nov-2026). Solo el
 * bartender comisiona: 10 % de las ventas del bar ÷ 1,21. Se acumulan por
 * crucero y se pagan juntas; cada pago se descuenta de lo pendiente. El
 * servidor calcula todo: aquí no se hacen cuentas a mano.
 */
const toast = useToastStore()
const confirmStore = useConfirmStore()

const data = shallowRef<CommissionSummary | null>(null)
const loading = shallowRef(true)
const busy = shallowRef(false)

const showPay = shallowRef(false)
const amountText = shallowRef('')
const paidAt = shallowRef('')
const note = shallowRef('')

const STATE: Record<CruiseCommission['state'], { label: string; tone: string }> = {
  pagada: { label: 'Pagada', tone: 'ok' },
  parcial: { label: 'Pago parcial', tone: 'warn' },
  pendiente: { label: 'Pendiente', tone: 'due' },
}

async function load() {
  loading.value = true
  try {
    data.value = await apiCommissions()
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)

function cruiseDates(c: CruiseCommission) {
  const end = c.closedAt ?? c.endDate
  return end ? `${formatDate(c.startDate)} – ${formatDate(end)}` : `Desde ${formatDate(c.startDate)}`
}

/** Monto escrito con coma o punto. */
const amount = computed(() => {
  const value = Number(amountText.value.replace(',', '.'))
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN
})

const payError = computed(() => {
  if (!data.value) return ''
  if (!amountText.value.trim()) return 'Escribe el monto pagado.'
  if (!(amount.value > 0)) return 'El monto debe ser mayor a $0.'
  if (amount.value > data.value.totals.pending + 0.004) {
    return `No puede ser mayor que lo pendiente (${formatMoney(data.value.totals.pending)}).`
  }
  if (!paidAt.value) return 'Elige la fecha del pago.'
  if (paidAt.value > todayKey()) return 'La fecha no puede ser futura.'
  return ''
})

const remaining = computed(() =>
  data.value && amount.value > 0 ? Math.max(0, Math.round((data.value.totals.pending - amount.value) * 100) / 100) : null,
)

function openPay() {
  if (!data.value) return
  amountText.value = data.value.totals.pending.toFixed(2)
  paidAt.value = todayKey()
  note.value = ''
  showPay.value = true
}

async function savePayment() {
  if (payError.value || busy.value) return
  busy.value = true
  try {
    data.value = await apiCreateCommissionPayment({
      amount: amount.value,
      paidAt: paidAt.value,
      note: note.value.trim(),
    })
    showPay.value = false
    toast.success(`Pago de ${formatMoney(amount.value)} registrado. Pendiente: ${formatMoney(data.value.totals.pending)}`)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

/** Un pago mal registrado se anula con motivo (no se borra) y deja de descontar. */
async function voidPayment(p: CommissionPaymentRow) {
  const reason = await confirmStore.askReason({
    title: `¿Anular el pago de ${formatMoney(p.amount)}?`,
    message: 'Vuelve a sumarse a lo pendiente. Queda en el historial como anulado, con el motivo.',
    confirmLabel: 'Anular pago',
    danger: true,
    icon: 'fa-rotate-left',
    reason: { label: 'Motivo (obligatorio)', suggestions: ['Monto equivocado', 'Pago registrado dos veces'] },
  })
  if (!reason) return
  busy.value = true
  try {
    data.value = await apiVoidCommissionPayment(p.id, reason)
    toast.success('Pago anulado')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="commissions panel" aria-labelledby="commissions-title">
    <header class="c-head">
      <div>
        <h2 id="commissions-title" class="panel-title">
          <i class="fa-solid fa-hand-holding-dollar" aria-hidden="true" /> Comisiones del bartender
        </h2>
        <p class="c-rule">
          10 % de las ventas del bar ÷ 1,21. Solo el bartender: no aplica a la directora ni a la tripulación.
          Ej.: venta de $10,00 → $1,00 ÷ 1,21 = <strong>$0,83</strong>.
        </p>
      </div>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="!data || data.totals.pending <= 0 || busy"
        @click="openPay"
      >
        <i class="fa-solid fa-money-bill-wave" aria-hidden="true" /> Registrar pago
      </button>
    </header>

    <div v-if="loading && !data" class="c-skeleton">
      <SkeletonBlock height="96px" />
      <SkeletonBlock height="160px" />
    </div>

    <template v-else-if="data">
      <!-- Lo que responde «¿cuánto le debo?» -->
      <dl class="c-figures">
        <div class="c-figure">
          <dt>Comisión acumulada</dt>
          <dd>{{ formatMoney(data.totals.generated) }}</dd>
          <small>
            {{ data.totals.cruises }} {{ data.totals.cruises === 1 ? 'crucero' : 'cruceros' }} · ventas
            {{ formatMoney(data.totals.sales) }}
          </small>
        </div>
        <div class="c-figure">
          <dt>Pagado</dt>
          <dd>{{ formatMoney(data.totals.paid) }}</dd>
          <small>{{ data.payments.filter((p) => p.status === 'vigente').length }} pago(s)</small>
        </div>
        <div class="c-figure c-figure--due">
          <dt>Pendiente de pago</dt>
          <dd :class="{ zero: data.totals.pending <= 0 }">{{ formatMoney(data.totals.pending) }}</dd>
          <small>{{ data.totals.pending > 0 ? 'Se paga junto, cuando decidas' : 'Al día' }}</small>
        </div>
      </dl>

      <!-- Por crucero, el más reciente arriba -->
      <h3 class="c-sub">Por crucero</h3>
      <p v-if="!data.cruises.length" class="c-empty">Todavía no hay ventas del bar.</p>
      <div v-else class="c-table" role="table" aria-label="Comisión por crucero">
        <div class="c-row c-row--head" role="row">
          <span role="columnheader">Crucero y fechas</span>
          <span role="columnheader" class="num">Ventas del bar</span>
          <span role="columnheader" class="num">Comisión neta</span>
          <span role="columnheader" class="num">Acumulada</span>
          <span role="columnheader">Estado</span>
        </div>
        <div v-for="c in data.cruises" :key="c.id" class="c-row" role="row">
          <span role="cell" class="c-cruise">
            <strong>
              {{ c.code ? `Crucero ${c.code}` : c.name }}
              <em v-if="c.status === 'abordo'" class="c-live">en curso</em>
            </strong>
            <small>
              {{ cruiseDates(c) }}<template v-if="c.routeFrom"> · {{ c.routeFrom }} → {{ c.routeTo }}</template>
            </small>
          </span>
          <span role="cell" class="num" data-label="Ventas del bar">{{ formatMoney(c.sales) }}</span>
          <span role="cell" class="num c-strong" data-label="Comisión neta">{{ formatMoney(c.commission) }}</span>
          <span role="cell" class="num" data-label="Acumulada">{{ formatMoney(c.accumulated) }}</span>
          <span role="cell" data-label="Estado">
            <span class="c-state" :class="`c-state--${STATE[c.state].tone}`">{{ STATE[c.state].label }}</span>
            <small v-if="c.state === 'parcial'" class="c-left">falta {{ formatMoney(c.pending) }}</small>
          </span>
        </div>
      </div>
      <p v-if="data.cruises.some((c) => c.status === 'abordo')" class="c-note">
        El crucero en curso sigue sumando hasta que se finalice.
      </p>

      <!-- Historial de pagos -->
      <h3 class="c-sub">Pagos al bartender</h3>
      <p v-if="!data.payments.length" class="c-empty">Aún no se registran pagos.</p>
      <ul v-else class="c-payments">
        <li v-for="p in data.payments" :key="p.id" class="c-payment" :class="{ 'c-payment--void': p.status === 'anulado' }">
          <div class="c-payment-main">
            <strong>{{ formatMoney(p.amount) }}</strong>
            <span>
              Pagado el {{ formatDate(p.paidAt) }} · registró {{ p.by || '—' }}
              <template v-if="p.note"> · {{ p.note }}</template>
            </span>
            <small v-if="p.voided" class="c-void-why">
              Anulado {{ formatDateTime(p.voided.at) }} por {{ p.voided.by }}: {{ p.voided.reason }}
            </small>
          </div>
          <button
            v-if="p.status === 'vigente'"
            type="button"
            class="btn-text c-void"
            :disabled="busy"
            @click="voidPayment(p)"
          >
            <i class="fa-solid fa-rotate-left" aria-hidden="true" /> Anular
          </button>
          <span v-else class="c-state c-state--void">Anulado</span>
        </li>
      </ul>
    </template>

    <!-- Registrar un pago consolidado -->
    <BaseModal
      v-if="showPay && data"
      title="Registrar pago al bartender"
      :subtitle="`Pendiente hoy: ${formatMoney(data.totals.pending)}`"
      @close="showPay = false"
    >
      <form class="pay-form" @submit.prevent="savePayment">
        <div class="field">
          <label for="commission-amount">Monto pagado</label>
          <input id="commission-amount" v-model="amountText" type="text" inputmode="decimal" autocomplete="off" />
          <p class="field-hint">
            <template v-if="remaining !== null && !payError">Quedará pendiente {{ formatMoney(remaining) }}.</template>
            <template v-else>Puede ser todo lo pendiente o una parte.</template>
          </p>
        </div>
        <div class="field">
          <label>Fecha del pago</label>
          <BaseDatePicker v-model="paidAt" placeholder="Elige la fecha" />
          <p v-if="paidAt" class="field-hint">{{ formatDayKey(paidAt) }}</p>
        </div>
        <div class="field">
          <label for="commission-note">Nota (opcional)</label>
          <input
            id="commission-note"
            v-model="note"
            type="text"
            maxlength="300"
            placeholder="Ej.: cruceros A-003 a C-002, transferencia"
          />
        </div>
        <p v-if="payError && amountText" class="campo-error">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true" /> {{ payError }}
        </p>
      </form>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="showPay = false">Cancelar</button>
        <button type="button" class="btn btn-primary" :disabled="Boolean(payError) || busy" @click="savePayment">
          <i class="fa-solid" :class="busy ? 'fa-spinner fa-spin' : 'fa-check'" aria-hidden="true" />
          {{ busy ? 'Guardando…' : `Registrar ${amount > 0 ? formatMoney(amount) : 'pago'}` }}
        </button>
      </template>
    </BaseModal>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.commissions {
  --line: #dbe4eb;
  --line-strong: #c3d1dc;
  --muted: #55636d;
  margin-top: 1.25rem;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1rem 1.25rem 1.25rem;
}

.c-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  margin-bottom: 1rem;

  > div {
    flex: 1 1 320px;
    min-width: 0;
  }
}

.panel-title {
  margin: 0 0 0.3rem;
  font-size: 1.1875rem;
  color: var(--ink-900);

  i {
    margin-right: 0.35rem;
    color: var(--navy-700);
  }
}

.c-rule {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--muted);
}

.c-skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.c-figures {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0 -1.25rem;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);

  @include tablet {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.c-figure {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem 1.25rem;
  min-width: 0;

  & + & {
    border-left: 1px solid var(--line);
  }

  &:first-child {
    grid-column: 1 / -1;
    border-bottom: 1px solid var(--line);

    @include tablet {
      grid-column: auto;
      border-bottom: 0;
    }
  }

  &:nth-child(2) {
    border-left: 0;

    @include tablet {
      border-left: 1px solid var(--line);
    }
  }

  dt {
    font-size: 0.9375rem;
    color: var(--muted);
  }

  dd {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1.15;
    color: var(--ink-900);
    font-variant-numeric: tabular-nums;

    &.zero {
      color: var(--muted);
    }
  }

  small {
    font-size: 0.875rem;
    color: var(--muted);
  }

  &--due dd:not(.zero) {
    color: var(--navy-800);
    font-size: 1.75rem;
  }
}

.c-sub {
  margin: 1.25rem 0 0.5rem;
  font-size: 1.0625rem;
  color: var(--ink-900);
}

.c-empty,
.c-note {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--muted);
}

.c-note {
  margin-top: 0.5rem;
}

// Tabla en tableta; tarjetas apiladas en celular.
.c-table {
  display: flex;
  flex-direction: column;
}

.c-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem 0.75rem;
  padding: 0.7rem 0;
  border-top: 1px solid var(--line);
  align-items: center;

  > [data-label]::before {
    content: attr(data-label);
    display: block;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .c-cruise {
    grid-column: 1 / -1;
  }

  &--head {
    display: none;
  }

  @include tablet {
    grid-template-columns: minmax(0, 2.2fr) repeat(3, minmax(0, 1fr)) minmax(0, 1.1fr);

    > [data-label]::before {
      display: none;
    }

    .c-cruise {
      grid-column: auto;
    }

    &--head {
      display: grid;
      padding: 0 0 0.4rem;
      border-top: 0;
      font-size: 0.875rem;
      color: var(--muted);
    }
  }

  .num {
    font-variant-numeric: tabular-nums;

    @include tablet {
      text-align: right;
    }
  }
}

.c-cruise {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;

  strong {
    color: var(--ink-900);
  }

  small {
    font-size: 0.875rem;
    color: var(--muted);
  }
}

.c-live {
  margin-left: 0.35rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: var(--powder-100);
  color: var(--navy-700);
  font-size: 0.75rem;
  font-style: normal;
  font-weight: 600;
}

.c-strong {
  font-weight: 600;
  color: var(--ink-900);
}

.c-state {
  display: inline-block;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 600;

  &--ok {
    background: #e3f2ea;
    color: #1d6b43;
  }

  &--warn {
    background: #fbf0dc;
    color: #8a5d1d;
  }

  &--due {
    background: var(--powder-100);
    color: var(--navy-800);
  }

  &--void {
    background: #eef1f4;
    color: var(--muted);
  }
}

.c-left {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.8125rem;
  color: #8a5d1d;
}

.c-payments {
  list-style: none;
  margin: 0;
  padding: 0;
}

.c-payment {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0;
  border-top: 1px solid var(--line);

  &--void .c-payment-main > strong {
    text-decoration: line-through;
    color: var(--muted);
  }
}

.c-payment-main {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;

  strong {
    font-variant-numeric: tabular-nums;
    color: var(--ink-900);
  }

  span {
    font-size: 0.9375rem;
    color: var(--ink-600);
  }
}

.c-void-why {
  font-size: 0.875rem;
  color: var(--muted);
}

.c-void {
  flex-shrink: 0;
  color: var(--danger-ink);
}

.pay-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
</style>
