<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseDatePicker from '@/components/ui/BaseDatePicker.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import {
  apiBartenders,
  apiCommissions,
  apiCreateCommissionPayment,
  apiUpdateCruise,
  apiVoidCommissionPayment,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { dayKeyOf, formatDate, formatDateTime, formatMoney, todayKey } from '@/utils/format'
import type { CommissionPaymentRow, CommissionSummary, CruiseCommission } from '@/types'

/**
 * Comisiones del bartender (pedido de Gerencia, 3-nov-2026). Solo el
 * bartender comisiona: 10 % de las ventas del bar ÷ 1,21.
 * 4-nov-2026: cada crucero tiene su bartender; se eligen los cruceros que se
 * pagan (de un solo bartender), se revisa la prefactura y se registra. El
 * histórico resume lo pagado por año, por mes y a quién. El servidor calcula
 * las comisiones: aquí solo se agrupa lo que ya viene calculado.
 */
const toast = useToastStore()
const confirmStore = useConfirmStore()

const data = shallowRef<CommissionSummary | null>(null)
const loading = shallowRef(true)
const busy = shallowRef(false)
const bartenderOptions = shallowRef<Array<{ value: string; label: string }>>([])

/** '' = todos; NONE = cruceros sin bartender. */
const NONE = '__none'
const filter = shallowRef('')
const selected = shallowRef<Set<string>>(new Set())

/** Prefactura abierta: la que se va a pagar o la de un pago ya registrado. */
const sheet = shallowRef<{ payment: CommissionPaymentRow | null } | null>(null)
const paidAt = shallowRef('')
const note = shallowRef('')

const STATE: Record<CruiseCommission['state'], { label: string; tone: string }> = {
  pagada: { label: 'Pagada', tone: 'ok' },
  parcial: { label: 'Pago parcial', tone: 'warn' },
  pendiente: { label: 'Pendiente', tone: 'due' },
}
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const round = (n: number) => Math.round(n * 100) / 100

async function load() {
  loading.value = true
  try {
    const [summary, bartenders] = await Promise.all([apiCommissions(), apiBartenders().catch(() => [])])
    data.value = summary
    bartenderOptions.value = bartenders.map((b) => ({ value: b._id, label: b.name }))
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** Fechas reales de operación (inicio y fin); si no constan, las programadas. */
function cruiseDates(c: CruiseCommission) {
  const start = c.startedAt ?? c.startDate
  const end = c.status === 'cerrado' ? (c.closedAt ?? c.endDate) : null
  return end ? `${formatDate(start)} – ${formatDate(end)}` : `Desde ${formatDate(start)}`
}

const cruiseLabel = (c: { code: string; name?: string }) => (c.code ? `Crucero ${c.code}` : c.name ?? '')

const visibleCruises = computed(() => {
  const rows = data.value?.cruises ?? []
  if (!filter.value) return rows
  return rows.filter((c) => (filter.value === NONE ? !c.bartenderId : c.bartenderId === filter.value))
})

// ---- Selección: cruceros con saldo de un solo bartender ----
const selectedRows = computed(() => (data.value?.cruises ?? []).filter((c) => selected.value.has(c.id)))
const selectedBartender = computed(() => selectedRows.value[0]?.bartenderId ?? null)
const selectedTotal = computed(() => round(selectedRows.value.reduce((s, c) => s + c.pending, 0)))

function selectable(c: CruiseCommission) {
  return c.pending > 0 && Boolean(c.bartenderId) && (!selectedBartender.value || selectedBartender.value === c.bartenderId)
}

function toggle(c: CruiseCommission) {
  const next = new Set(selected.value)
  if (next.has(c.id)) next.delete(c.id)
  else if (selectable(c)) next.add(c.id)
  selected.value = next
}

/** Todo lo pendiente de un bartender, listo para pagar. */
function selectAllOf(id: string | null) {
  if (!id || !data.value) return
  filter.value = id
  selected.value = new Set(data.value.cruises.filter((c) => c.bartenderId === id && c.pending > 0).map((c) => c.id))
}

async function assign(c: CruiseCommission, id: string) {
  if (!id) return
  busy.value = true
  try {
    await apiUpdateCruise(c.id, { bartender: id })
    data.value = await apiCommissions()
    toast.success(`${cruiseLabel(c)}: bartender asignado`)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

// ---- Prefactura ----
const cruiseById = computed(() => new Map((data.value?.cruises ?? []).map((c) => [c.id, c])))

/** Filas de la prefactura: lo elegido (por pagar) o el detalle guardado del pago. */
const sheetRows = computed(() => {
  const p = sheet.value?.payment
  if (!p) {
    return selectedRows.value.map((c) => ({ id: c.id, label: cruiseLabel(c), cruise: c as CruiseCommission | undefined, sales: c.sales, commission: c.commission, amount: c.pending }))
  }
  return p.items.map((i) => {
    const c = cruiseById.value.get(i.cruiseId)
    return { id: i.cruiseId, label: `Crucero ${i.code}`, cruise: c, sales: i.sales, commission: c?.commission ?? i.amount, amount: i.amount }
  })
})
const sheetTotal = computed(() => sheet.value?.payment?.amount ?? selectedTotal.value)
const sheetBartender = computed(
  () => sheet.value?.payment?.bartenderName || selectedRows.value[0]?.bartenderName || '',
)

const payError = computed(() => {
  if (!selectedRows.value.length) return 'Elige al menos un crucero.'
  if (!paidAt.value) return 'Elige la fecha del pago.'
  if (paidAt.value > todayKey()) return 'La fecha no puede ser futura.'
  return ''
})

function openPrefactura() {
  if (!selectedRows.value.length) return
  paidAt.value = todayKey()
  note.value = ''
  sheet.value = { payment: null }
}

async function savePayment() {
  if (payError.value || busy.value) return
  busy.value = true
  try {
    const total = selectedTotal.value
    const name = sheetBartender.value
    data.value = await apiCreateCommissionPayment({
      cruiseIds: selectedRows.value.map((c) => c.id),
      paidAt: paidAt.value,
      note: note.value.trim(),
    })
    selected.value = new Set()
    // Queda abierta la prefactura del pago registrado.
    const saved = data.value.payments.find((p) => p.id === data.value?.paymentId)
    sheet.value = saved ? { payment: saved } : null
    toast.success(`Pago de ${formatMoney(total)} a ${name} registrado`)
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
    message: 'Sus cruceros vuelven a quedar pendientes. Queda en el historial como anulado, con el motivo.',
    confirmLabel: 'Anular pago',
    danger: true,
    icon: 'fa-rotate-left',
    reason: { label: 'Motivo (obligatorio)', suggestions: ['Monto equivocado', 'Pago registrado dos veces'] },
  })
  if (!reason) return
  busy.value = true
  try {
    data.value = await apiVoidCommissionPayment(p.id, reason)
    sheet.value = null
    toast.success('Pago anulado')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

// ---- Histórico: por año, por mes y a quién se le pagó ----
const validPayments = computed(() => (data.value?.payments ?? []).filter((p) => p.status === 'vigente'))
const years = computed(() =>
  [...new Set(validPayments.value.map((p) => Number(dayKeyOf(p.paidAt).slice(0, 4))))].sort((a, b) => b - a),
)
const year = shallowRef<number | null>(null)
const activeYear = computed(() => year.value ?? years.value[0] ?? null)

const history = computed(() => {
  const inYear = validPayments.value.filter((p) => Number(dayKeyOf(p.paidAt).slice(0, 4)) === activeYear.value)
  const months = MONTHS.map((label) => ({ label, amount: 0, count: 0 }))
  const people = new Map<string, { name: string; amount: number; count: number }>()
  for (const p of inYear) {
    const m = months[Number(dayKeyOf(p.paidAt).slice(5, 7)) - 1]!
    m.amount = round(m.amount + p.amount)
    m.count += 1
    const key = p.bartenderId ?? ''
    const who = people.get(key) ?? { name: p.bartenderName || 'Pagos anteriores sin bartender', amount: 0, count: 0 }
    who.amount = round(who.amount + p.amount)
    who.count += 1
    people.set(key, who)
  }
  const total = round(inYear.reduce((s, p) => s + p.amount, 0))
  const ranking = [...people.values()].sort((a, b) => b.amount - a.amount)
  return {
    total,
    count: inYear.length,
    months: months.filter((m) => m.count),
    ranking,
    allTime: round(validPayments.value.reduce((s, p) => s + p.amount, 0)),
  }
})
</script>

<template>
  <section class="commissions panel" aria-labelledby="commissions-title">
    <header class="c-head">
      <div>
        <h2 id="commissions-title" class="panel-title">
          <i class="fa-solid fa-hand-holding-dollar" aria-hidden="true" /> Comisiones del bartender
        </h2>
        <p class="c-rule">
          10 % de las ventas del bar ÷ 1,21, para el bartender de cada crucero. No aplica a la directora ni a la tripulación.
          Ej.: venta de $10,00 → $1,00 ÷ 1,21 = <strong>$0,83</strong>.
        </p>
      </div>
    </header>

    <div v-if="loading && !data" class="c-skeleton">
      <SkeletonBlock height="96px" />
      <SkeletonBlock height="160px" />
    </div>

    <template v-else-if="data">
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
          <small>{{ validPayments.length }} pago(s)</small>
        </div>
        <div class="c-figure c-figure--due">
          <dt>Pendiente de pago</dt>
          <dd :class="{ zero: data.totals.pending <= 0 }">{{ formatMoney(data.totals.pending) }}</dd>
          <small>{{ data.totals.pending > 0 ? 'Elige abajo qué cruceros pagas' : 'Al día' }}</small>
        </div>
      </dl>

      <!-- Por bartender: cuánto se le debe a cada uno -->
      <h3 class="c-sub">Por bartender</h3>
      <div class="c-people">
        <article
          v-for="b in data.bartenders"
          :key="b.id ?? 'none'"
          class="c-person"
          :class="{ 'c-person--none': !b.id, 'c-person--on': filter === (b.id ?? NONE) }"
        >
          <button type="button" class="c-person-main" @click="filter = filter === (b.id ?? NONE) ? '' : (b.id ?? NONE)">
            <strong>{{ b.id ? b.name : 'Sin bartender asignado' }}</strong>
            <small>{{ b.cruises }} {{ b.cruises === 1 ? 'crucero' : 'cruceros' }} · pagado {{ formatMoney(b.paid) }}</small>
            <span class="c-person-due" :class="{ zero: b.pending <= 0 }">
              {{ b.pending > 0 ? `Pendiente ${formatMoney(b.pending)}` : 'Al día' }}
            </span>
          </button>
          <button v-if="b.id && b.pending > 0" type="button" class="btn-text c-person-all" @click="selectAllOf(b.id)">
            <i class="fa-solid fa-check-double" aria-hidden="true" /> Elegir todo lo pendiente
          </button>
          <small v-else-if="!b.id" class="c-person-hint">Asígnalo en cada crucero para poder pagarlo.</small>
        </article>
      </div>

      <!-- Por crucero, el más reciente arriba -->
      <h3 class="c-sub">
        Por crucero
        <button v-if="filter" type="button" class="btn-text c-clear" @click="filter = ''">
          <i class="fa-solid fa-xmark" aria-hidden="true" /> Ver todos
        </button>
      </h3>
      <p v-if="!visibleCruises.length" class="c-empty">Todavía no hay ventas del bar.</p>
      <div v-else class="c-table" role="table" aria-label="Comisión por crucero">
        <div class="c-row c-row--head" role="row">
          <span role="columnheader">Crucero y fechas</span>
          <span role="columnheader">Bartender</span>
          <span role="columnheader" class="num">Ventas del bar</span>
          <span role="columnheader" class="num">Comisión neta</span>
          <span role="columnheader">Estado</span>
        </div>
        <div
          v-for="c in visibleCruises"
          :key="c.id"
          class="c-row"
          :class="{ 'c-row--on': selected.has(c.id) }"
          role="row"
        >
          <label role="cell" class="c-cruise" :class="{ 'c-cruise--off': !selectable(c) && !selected.has(c.id) }">
            <input
              v-if="c.pending > 0"
              type="checkbox"
              :checked="selected.has(c.id)"
              :disabled="!selectable(c) && !selected.has(c.id)"
              :aria-label="`Pagar ${cruiseLabel(c)}`"
              @change="toggle(c)"
            />
            <span class="c-cruise-text">
              <strong>
                {{ cruiseLabel(c) }}
                <em v-if="c.status === 'abordo'" class="c-live">en curso</em>
              </strong>
              <small>
                {{ cruiseDates(c) }}<template v-if="c.routeFrom"> · {{ c.routeFrom }} → {{ c.routeTo }}</template>
              </small>
            </span>
          </label>
          <span role="cell" data-label="Bartender" class="c-who">
            <template v-if="c.bartenderId">{{ c.bartenderName }}</template>
            <BaseSelect
              v-else
              model-value=""
              :options="bartenderOptions"
              placeholder="Asignar…"
              @update:model-value="assign(c, $event)"
            />
          </span>
          <span role="cell" class="num" data-label="Ventas del bar">{{ formatMoney(c.sales) }}</span>
          <span role="cell" class="num c-strong" data-label="Comisión neta">{{ formatMoney(c.commission) }}</span>
          <span role="cell" data-label="Estado">
            <span class="c-state" :class="`c-state--${STATE[c.state].tone}`">{{ STATE[c.state].label }}</span>
            <small v-if="c.state === 'parcial'" class="c-left">falta {{ formatMoney(c.pending) }}</small>
          </span>
        </div>
      </div>
      <p v-if="data.cruises.some((c) => c.status === 'abordo')" class="c-note">
        El crucero en curso sigue sumando hasta que se finalice: págalo cuando termine.
      </p>

      <!-- Lo elegido para pagar -->
      <Transition name="fade">
        <div v-if="selectedRows.length" class="c-paybar" role="status">
          <span>
            <strong>{{ selectedRows.length }} {{ selectedRows.length === 1 ? 'crucero' : 'cruceros' }}</strong>
            de {{ selectedRows[0]!.bartenderName }} · {{ formatMoney(selectedTotal) }}
          </span>
          <button type="button" class="btn-text" @click="selected = new Set()">Quitar selección</button>
          <button type="button" class="btn btn-primary" :disabled="busy" @click="openPrefactura">
            <i class="fa-solid fa-file-invoice-dollar" aria-hidden="true" /> Ver prefactura y pagar
          </button>
        </div>
      </Transition>

      <!-- Histórico -->
      <h3 class="c-sub">Histórico de pagos</h3>
      <p v-if="!years.length" class="c-empty">Aún no se registran pagos.</p>
      <template v-else>
        <div class="c-years" role="radiogroup" aria-label="Año">
          <button
            v-for="y in years"
            :key="y"
            type="button"
            role="radio"
            class="c-year"
            :class="{ 'c-year--on': y === activeYear }"
            :aria-checked="y === activeYear"
            @click="year = y"
          >
            {{ y }}
          </button>
          <span class="c-alltime">Desde el inicio: <strong>{{ formatMoney(history.allTime) }}</strong></span>
        </div>
        <div class="c-history">
          <div class="c-history-block">
            <p class="c-history-total">
              <span>Pagado en {{ activeYear }}</span>
              <strong>{{ formatMoney(history.total) }}</strong>
              <small>{{ history.count }} pago(s)</small>
            </p>
            <ul class="c-list">
              <li v-for="m in history.months" :key="m.label">
                <span>{{ m.label }}</span>
                <small>{{ m.count }} pago(s)</small>
                <strong class="num">{{ formatMoney(m.amount) }}</strong>
              </li>
            </ul>
          </div>
          <div class="c-history-block">
            <p class="c-history-total"><span>A quién se le pagó en {{ activeYear }}</span></p>
            <ul class="c-list">
              <li v-for="(r, i) in history.ranking" :key="r.name">
                <span>{{ i + 1 }}. {{ r.name }}</span>
                <small>{{ history.total > 0 ? Math.round((r.amount / history.total) * 100) : 0 }} %</small>
                <strong class="num">{{ formatMoney(r.amount) }}</strong>
              </li>
            </ul>
          </div>
        </div>
      </template>

      <!-- Pagos registrados -->
      <h3 class="c-sub">Pagos registrados</h3>
      <p v-if="!data.payments.length" class="c-empty">Aún no se registran pagos.</p>
      <ul v-else class="c-payments">
        <li v-for="p in data.payments" :key="p.id" class="c-payment" :class="{ 'c-payment--void': p.status === 'anulado' }">
          <div class="c-payment-main">
            <strong>{{ formatMoney(p.amount) }}<template v-if="p.bartenderName"> · {{ p.bartenderName }}</template></strong>
            <span>
              Pagado el {{ formatDate(p.paidAt) }} · registró {{ p.by || '—' }}
              <template v-if="p.items.length"> · {{ p.items.map((i) => i.code).join(', ') }}</template>
              <template v-if="p.note"> · {{ p.note }}</template>
            </span>
            <small v-if="p.voided" class="c-void-why">
              Anulado {{ formatDateTime(p.voided.at) }} por {{ p.voided.by }}: {{ p.voided.reason }}
            </small>
          </div>
          <button v-if="p.items.length" type="button" class="btn-text" @click="sheet = { payment: p }">
            <i class="fa-solid fa-file-invoice-dollar" aria-hidden="true" /> Detalle
          </button>
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

    <!-- Prefactura: detalle de los cruceros que se pagan -->
    <BaseModal
      v-if="sheet && data"
      :title="sheet.payment ? 'Pago de comisión' : 'Prefactura de comisión'"
      :subtitle="`${sheetBartender} · 10 % de las ventas del bar ÷ 1,21`"
      size="lg"
      @close="sheet = null"
    >
      <div class="sheet">
        <p v-if="sheet.payment" class="sheet-meta">
          Pagado el {{ formatDate(sheet.payment.paidAt) }} · registró {{ sheet.payment.by }}
          <template v-if="sheet.payment.note"> · {{ sheet.payment.note }}</template>
          <span v-if="sheet.payment.status === 'anulado'" class="c-state c-state--void">Anulado</span>
        </p>
        <div class="c-table" role="table" aria-label="Cruceros del pago">
          <div class="c-row c-row--head sheet-row" role="row">
            <span role="columnheader">Crucero y fechas</span>
            <span role="columnheader" class="num">Ventas del bar</span>
            <span role="columnheader" class="num">Comisión neta</span>
            <span role="columnheader" class="num">Se paga</span>
          </div>
          <div v-for="r in sheetRows" :key="r.id" class="c-row sheet-row" role="row">
            <span role="cell" class="c-cruise">
              <span class="c-cruise-text">
                <strong>{{ r.label }}</strong>
                <small v-if="r.cruise">
                  {{ cruiseDates(r.cruise) }}<template v-if="r.cruise.routeFrom"> · {{ r.cruise.routeFrom }} → {{ r.cruise.routeTo }}</template>
                </small>
              </span>
            </span>
            <span role="cell" class="num" data-label="Ventas del bar">{{ formatMoney(r.sales) }}</span>
            <span role="cell" class="num" data-label="Comisión neta">{{ formatMoney(r.commission) }}</span>
            <span role="cell" class="num c-strong" data-label="Se paga">{{ formatMoney(r.amount) }}</span>
          </div>
        </div>
        <p class="sheet-total">
          <span>Total a pagar a {{ sheetBartender }}</span>
          <strong>{{ formatMoney(sheetTotal) }}</strong>
        </p>
        <form v-if="!sheet.payment" class="pay-form" @submit.prevent="savePayment">
          <div class="field">
            <label>Fecha del pago</label>
            <BaseDatePicker v-model="paidAt" placeholder="Elige la fecha" />
          </div>
          <div class="field">
            <label for="commission-note">Nota (opcional)</label>
            <input id="commission-note" v-model="note" type="text" maxlength="300" placeholder="Ej.: efectivo, transferencia" />
          </div>
          <p v-if="payError" class="campo-error">
            <i class="fa-solid fa-circle-exclamation" aria-hidden="true" /> {{ payError }}
          </p>
        </form>
      </div>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="sheet = null">{{ sheet.payment ? 'Cerrar' : 'Cancelar' }}</button>
        <button
          v-if="!sheet.payment"
          type="button"
          class="btn btn-primary"
          :disabled="Boolean(payError) || busy"
          @click="savePayment"
        >
          <i class="fa-solid" :class="busy ? 'fa-spinner fa-spin' : 'fa-check'" aria-hidden="true" />
          {{ busy ? 'Guardando…' : `Registrar pago de ${formatMoney(sheetTotal)}` }}
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
  align-items: center;
  gap: 0.65rem;
  min-width: 0;

  input {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    accent-color: var(--navy-800);
  }

  &--off {
    opacity: 0.6;
  }

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

.c-cruise-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.c-row--on {
  background: var(--powder-100);
}

.c-who {
  min-width: 0;
  color: var(--ink-600);
}

.c-clear {
  margin-left: 0.5rem;
  font-size: 0.875rem;
}

.c-people {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.6rem;

  @include tablet {
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  }
}

.c-person {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.75rem 0.9rem;
  border: 1.5px solid var(--line);
  border-radius: var(--radius-sm);
  transition:
    border-color 0.15s ease,
    background 0.15s ease;

  &--on {
    border-color: var(--navy-700);
    background: var(--powder-100);
  }

  &--none {
    border-style: dashed;
  }
}

.c-person-main {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;

  strong {
    color: var(--ink-900);
  }

  small {
    font-size: 0.875rem;
    color: var(--muted);
  }
}

.c-person-due {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--navy-800);

  &.zero {
    color: #1d6b43;
  }
}

.c-person-all {
  align-self: flex-start;
  font-size: 0.875rem;
}

.c-person-hint {
  font-size: 0.8125rem;
  color: var(--muted);
}

.c-paybar {
  position: sticky;
  bottom: 0.75rem;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
  margin-top: 0.75rem;
  padding: 0.7rem 0.9rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  box-shadow: 0 8px 24px rgba(27, 43, 37, 0.12);

  > span {
    flex: 1 1 200px;
    font-variant-numeric: tabular-nums;
  }
}

.c-years {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.75rem;
}

.c-year {
  min-height: 40px;
  padding: 0 0.9rem;
  border: 1.5px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;

  &--on {
    border-color: var(--navy-800);
    background: var(--navy-800);
    color: #fff;
  }
}

.c-alltime {
  margin-left: auto;
  font-size: 0.9375rem;
  color: var(--muted);

  strong {
    color: var(--ink-900);
    font-variant-numeric: tabular-nums;
  }
}

.c-history {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;

  @include tablet {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.c-history-total {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.6rem;
  margin: 0 0 0.4rem;
  color: var(--muted);

  strong {
    font-size: 1.35rem;
    color: var(--ink-900);
    font-variant-numeric: tabular-nums;
  }
}

.c-list {
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.5rem 0;
    border-top: 1px solid var(--line);

    span {
      color: var(--ink-900);
    }

    small {
      color: var(--muted);
    }

    strong {
      margin-left: auto;
      font-variant-numeric: tabular-nums;
    }
  }
}

.sheet {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.sheet-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  color: var(--ink-600);
}

.sheet-row {
  @include tablet {
    grid-template-columns: minmax(0, 2.2fr) repeat(3, minmax(0, 1fr));
  }
}

.sheet-total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin: 0;
  padding-top: 0.75rem;
  border-top: 2px solid var(--line-strong);

  strong {
    font-size: 1.5rem;
    color: var(--navy-800);
    font-variant-numeric: tabular-nums;
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
