<script setup lang="ts">
import { computed, nextTick, onMounted, shallowRef } from 'vue'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { apiAgencyBilling, apiCreateAgencyInvoice, apiVoidAgencyInvoice } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDate, formatDateTime, formatMoney, todayKey } from '@/utils/format'
import { EMAIL_RE } from '@/components/accounts/payLines'
import type { AgencyBilling, AgencyCruise, AgencyInvoiceRow } from '@/types'

/**
 * Factura mensual a la agencia (pedido de Gerencia, 4-nov-2026): igual que
 * las comisiones del bar, se eligen los cruceros, se registra y se le envía a
 * la agencia el detalle por crucero. La factura electrónica se emite aparte en
 * Contífico. Desde el día 28 la app avisa que toca facturar.
 */
const toast = useToastStore()
const confirmStore = useConfirmStore()

const data = shallowRef<AgencyBilling | null>(null)
const loading = shallowRef(true)
const busy = shallowRef(false)
const selected = shallowRef<Set<string>>(new Set())
const month = shallowRef(todayKey().slice(0, 7))
const email = shallowRef('')
const invoiceNumber = shallowRef('')

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? m} ${m.slice(0, 4)}`
const STATE: Record<AgencyCruise['state'], { label: string; tone: string }> = {
  facturada: { label: 'Facturada', tone: 'ok' },
  parcial: { label: 'Falta una parte', tone: 'warn' },
  pendiente: { label: 'Por facturar', tone: 'due' },
}
const cruiseLabel = (c: { code: string; name?: string }) => (c.code ? `Crucero ${c.code}` : (c.name ?? ''))

async function load() {
  loading.value = true
  try {
    data.value = await apiAgencyBilling()
    if (!email.value) email.value = data.value.lastEmail
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  await load()
  // Viene del aviso o de Cuentas (/#agencia): baja hasta esta sección.
  if (location.hash === '#agencia') void nextTick(() => document.getElementById('agencia')?.scrollIntoView({ behavior: 'smooth' }))
})

function toggle(c: AgencyCruise) {
  const next = new Set(selected.value)
  if (next.has(c.id)) next.delete(c.id)
  else next.add(c.id)
  selected.value = next
}

function selectAllPending() {
  selected.value = new Set((data.value?.cruises ?? []).filter((c) => c.pending > 0).map((c) => c.id))
}

const selectedRows = computed(() => (data.value?.cruises ?? []).filter((c) => selected.value.has(c.id)))
const selectedTotal = computed(() => Math.round(selectedRows.value.reduce((s, c) => s + c.pending, 0) * 100) / 100)
const emailBad = computed(() => Boolean(email.value.trim()) && !EMAIL_RE.test(email.value.trim()))

async function register() {
  if (!selectedRows.value.length || emailBad.value || busy.value) return
  const to = email.value.trim()
  const ok = await confirmStore.ask({
    title: `¿Registrar la factura de ${monthName(month.value)} por ${formatMoney(selectedTotal.value)}?`,
    message: `${selectedRows.value.map((c) => `${cruiseLabel(c)} (${formatMoney(c.pending)})`).join(', ')}. ${
      to ? `Se le envía el detalle por crucero a ${to}.` : 'Sin correo: no se envía nada, solo queda registrada.'
    } Después emite la factura en Contífico por ese total.`,
    confirmLabel: to ? 'Registrar y enviar' : 'Registrar',
    icon: 'fa-file-invoice-dollar',
  })
  if (!ok) return
  busy.value = true
  try {
    const result = await apiCreateAgencyInvoice({
      cruiseIds: [...selected.value],
      month: month.value,
      to,
      invoiceNumber: invoiceNumber.value.trim(),
      note: '',
    })
    data.value = result
    selected.value = new Set()
    invoiceNumber.value = ''
    toast.success(`Factura de ${monthName(month.value)} registrada`)
    if (result.email?.status === 'enviado') toast.push(`Detalle enviado a ${result.email.to}`, 'info')
    else if (result.email?.status === 'error') toast.push(`Correo no enviado: ${result.email.error}`, 'error')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

async function voidInvoice(inv: AgencyInvoiceRow) {
  const reason = await confirmStore.askReason({
    title: `¿Anular la factura de ${monthName(inv.month)} (${formatMoney(inv.amount)})?`,
    message: 'Sus cruceros vuelven a quedar por facturar. Queda en el histórico como anulada, con el motivo.',
    confirmLabel: 'Anular',
    danger: true,
    icon: 'fa-rotate-left',
    reason: { label: 'Motivo (obligatorio)', suggestions: ['Monto equivocado', 'Registrada dos veces'] },
  })
  if (!reason) return
  busy.value = true
  try {
    data.value = await apiVoidAgencyInvoice(inv.id, reason)
    toast.success('Factura anulada')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

/** Histórico por mes facturado, lo más reciente arriba. */
const history = computed(() => {
  const groups = new Map<string, AgencyInvoiceRow[]>()
  for (const inv of data.value?.invoices ?? []) groups.set(inv.month, [...(groups.get(inv.month) ?? []), inv])
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))
})
</script>

<template>
  <section id="agencia" class="agency panel" aria-labelledby="agency-title">
    <header>
      <h2 id="agency-title" class="panel-title">
        <i class="fa-solid fa-handshake" aria-hidden="true" /> Factura mensual a la agencia
      </h2>
      <p class="a-rule">
        Las cortesías de agencia no se cobran a la cabina (sí descuentan inventario). Cada mes:
        <strong>1)</strong> marca los cruceros que le facturas, <strong>2)</strong> toca «Registrar y enviar»: le llega el detalle por crucero a su correo,
        <strong>3)</strong> emite la factura en Contífico por ese total. Desde el día {{ data?.reminderDay ?? 28 }} la app te avisa.
      </p>
    </header>

    <div v-if="loading && !data" class="a-skeleton">
      <SkeletonBlock height="80px" />
      <SkeletonBlock height="140px" />
    </div>

    <template v-else-if="data">
      <div v-if="data.reminder" class="a-reminder" role="status">
        <i class="fa-solid fa-bell" aria-hidden="true" />
        Toca facturar a la agencia: {{ formatMoney(data.reminder.amount) }} de {{ data.reminder.cruises }}
        {{ data.reminder.cruises === 1 ? 'crucero' : 'cruceros' }}.
      </div>

      <dl class="a-figures">
        <div>
          <dt>Por facturar</dt>
          <dd :class="{ zero: data.totals.pending <= 0 }">{{ formatMoney(data.totals.pending) }}</dd>
        </div>
        <div>
          <dt>Ya facturado</dt>
          <dd>{{ formatMoney(data.totals.invoiced) }}</dd>
        </div>
      </dl>

      <h3 class="a-sub">
        Por crucero
        <button v-if="data.totals.pending > 0" type="button" class="btn-text" @click="selectAllPending">
          <i class="fa-solid fa-check-double" aria-hidden="true" /> Elegir todo lo pendiente
        </button>
      </h3>
      <p v-if="!data.cruises.length" class="a-empty">Aún no hay cortesías de agencia.</p>
      <ul v-else class="a-list">
        <li v-for="c in data.cruises" :key="c.id" class="a-row" :class="{ 'a-row--on': selected.has(c.id) }">
          <label class="a-cruise">
            <input
              v-if="c.pending > 0"
              type="checkbox"
              :checked="selected.has(c.id)"
              :aria-label="`Facturar ${cruiseLabel(c)}`"
              @change="toggle(c)"
            />
            <span>
              <strong>{{ cruiseLabel(c) }}</strong>
              <small>
                {{ formatDate(c.startDate) }}<template v-if="c.routeFrom"> · {{ c.routeFrom }} → {{ c.routeTo }}</template>
                · {{ c.count }} {{ c.count === 1 ? 'cortesía' : 'cortesías' }}
              </small>
            </span>
          </label>
          <span class="a-amount">
            <strong>{{ formatMoney(c.pending > 0 ? c.pending : c.total) }}</strong>
            <span class="a-state" :class="`a-state--${STATE[c.state].tone}`">{{ STATE[c.state].label }}</span>
          </span>
          <details class="a-detail">
            <summary>Ver detalle</summary>
            <ul>
              <li v-for="i in c.items" :key="`${i.orderId}-${i.name}`">
                Cabina {{ i.cabinNumber }} · {{ i.qty }} × {{ i.name }} · {{ formatMoney(i.total) }}
                <small>{{ formatDateTime(i.at) }}<template v-if="i.reason"> · {{ i.reason }}</template></small>
              </li>
            </ul>
          </details>
        </li>
      </ul>

      <Transition name="fade">
        <div v-if="selectedRows.length" class="a-send">
          <p class="a-send-total">
            <strong>{{ selectedRows.length }} {{ selectedRows.length === 1 ? 'crucero' : 'cruceros' }}</strong>
            · {{ formatMoney(selectedTotal) }}
          </p>
          <div class="a-fields">
            <div class="field">
              <label for="agency-month">Mes que facturas</label>
              <input id="agency-month" v-model="month" type="month" />
            </div>
            <div class="field">
              <label for="agency-email">Correo de la agencia</label>
              <input
                id="agency-email"
                v-model="email"
                type="email"
                inputmode="email"
                autocomplete="off"
                placeholder="correo@agencia.com"
                :aria-invalid="emailBad"
              />
              <small v-if="emailBad" class="field-error">Revisa el correo. Ejemplo: nombre@dominio.com.</small>
            </div>
            <div class="field">
              <label for="agency-number">N.º de factura Contífico <small>(opcional)</small></label>
              <input id="agency-number" v-model="invoiceNumber" type="text" autocomplete="off" placeholder="001-001-000000123" />
            </div>
          </div>
          <div class="a-actions">
            <button type="button" class="btn-text" @click="selected = new Set()">Quitar selección</button>
            <button type="button" class="btn btn-primary" :disabled="busy || emailBad" @click="register">
              <i class="fa-solid" :class="busy ? 'fa-spinner fa-spin' : 'fa-paper-plane'" aria-hidden="true" />
              {{ email.trim() ? 'Registrar y enviar a la agencia' : 'Registrar sin enviar' }}
            </button>
          </div>
        </div>
      </Transition>

      <h3 class="a-sub">Histórico de facturas</h3>
      <p v-if="!history.length" class="a-empty">Aún no se registran facturas a la agencia.</p>
      <div v-for="[m, list] in history" :key="m" class="a-month">
        <h4>{{ monthName(m) }}</h4>
        <ul class="a-list">
          <li v-for="inv in list" :key="inv.id" class="a-row" :class="{ 'a-row--void': inv.status === 'anulada' }">
            <span class="a-cruise">
              <span>
                <strong>{{ inv.items.map((i) => i.code).join(', ') }}</strong>
                <small>
                  {{ formatDateTime(inv.createdAt) }} · {{ inv.by }}
                  <template v-if="inv.invoiceNumber"> · Factura {{ inv.invoiceNumber }}</template>
                  <template v-if="inv.sentTo"> · enviada a {{ inv.sentTo }}</template>
                  <template v-else> · sin enviar</template>
                </small>
                <small v-if="inv.voided" class="a-void">Anulada: {{ inv.voided.reason }} ({{ inv.voided.by }})</small>
              </span>
            </span>
            <span class="a-amount">
              <strong>{{ formatMoney(inv.amount) }}</strong>
              <button v-if="inv.status === 'vigente'" type="button" class="btn-text" :disabled="busy" @click="voidInvoice(inv)">
                Anular
              </button>
            </span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>

<style scoped lang="scss">
.agency {
  margin-top: 1.5rem;
  scroll-margin-top: 5rem;
}

.a-rule {
  margin: 0.25rem 0 1rem;
  color: var(--ink-600);
  font-size: 0.95rem;
  line-height: 1.5;
}

.a-skeleton {
  display: grid;
  gap: 0.75rem;
}

.a-reminder {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1rem;
  padding: 0.8rem 1rem;
  border-radius: var(--radius-sm);
  background: var(--pill-warn-bg);
  color: var(--pill-warn-ink);
  font-weight: 600;
}

.a-figures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
  margin: 0 0 1rem;

  div {
    padding: 0.8rem 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  dt {
    font-size: 0.85rem;
    color: var(--ink-400);
  }

  dd {
    margin: 0.2rem 0 0;
    font-family: var(--font-serif);
    font-size: 1.6rem;
    font-variant-numeric: tabular-nums;

    &.zero {
      color: var(--ink-400);
    }
  }
}

.a-sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 1.25rem 0 0.5rem;
  font-size: 1rem;
}

.a-empty {
  margin: 0;
  color: var(--ink-400);
}

.a-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.a-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.25rem 1rem;
  padding: 0.7rem 0.5rem;
  border-bottom: 1px solid var(--line);

  &--on {
    background: var(--surface-2, rgba(0, 0, 0, 0.03));
  }

  &--void {
    opacity: 0.6;

    strong {
      text-decoration: line-through;
    }
  }
}

.a-cruise {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  cursor: pointer;

  input {
    width: 22px;
    height: 22px;
    margin-top: 0.1rem;
  }

  small {
    display: block;
    color: var(--ink-400);
    font-size: 0.82rem;
  }
}

.a-void {
  color: var(--danger, #b42318) !important;
}

.a-amount {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.2rem;
  font-variant-numeric: tabular-nums;
}

.a-state {
  font-size: 0.78rem;
  font-weight: 600;

  &--ok {
    color: var(--pill-ok-ink, #1f7a4d);
  }

  &--warn,
  &--due {
    color: var(--pill-warn-ink);
  }
}

.a-detail {
  grid-column: 1 / -1;
  font-size: 0.88rem;

  summary {
    cursor: pointer;
    color: var(--ink-600);
  }

  ul {
    margin: 0.4rem 0 0;
    padding-left: 1.1rem;
  }

  small {
    display: block;
    color: var(--ink-400);
  }
}

.a-send {
  margin-top: 1rem;
  padding: 1rem;
  border: 1.5px solid var(--line);
  border-radius: var(--radius-sm);
}

.a-send-total {
  margin: 0 0 0.75rem;
  font-size: 1.05rem;
}

.a-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;

  input {
    width: 100%;
    min-height: 44px;
  }
}

.a-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.9rem;
}

.a-month h4 {
  margin: 0.9rem 0 0.2rem;
  font-size: 0.9rem;
  color: var(--ink-600);
}
</style>
