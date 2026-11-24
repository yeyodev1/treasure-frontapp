<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import OwnerBars from '@/components/owner/OwnerBars.vue'
import ColumnChart from '@/components/owner/ColumnChart.vue'
import {
  apiAgencyInvoicePayment,
  apiCommissionReceipt,
  apiCreateAgencyInvoice,
  apiCreateCommissionPayment,
  apiVoidAgencyInvoice,
  apiVoidCommissionPayment,
  type BarSummary,
  type SummaryAction,
  type SummaryPeriodKind,
  type Tone,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'
import { formatMoney, todayKey } from '@/utils/format'
import { MONTHS, fmt } from '@/components/owner/insights'

/**
 * Vista Bar del Resumen (solo Gerencia; especificación del 24-nov-2026).
 * Cada bloque responde qué pasó, si está bien o mal (verde, amarillo, rojo) y
 * qué hacer, con un botón a donde se resuelve. Comisiones y factura a la
 * agencia se operan aquí mismo.
 */
const props = defineProps<{ data: BarSummary }>()
const emit = defineEmits<{ reload: []; period: [kind: SummaryPeriodKind, value: string] }>()

const router = useRouter()
const toast = useToastStore()
const confirm = useConfirmStore()
const { play } = useSound()

const kind = computed(() => props.data.period.kind)
const f = computed(() => props.data.figures)
const money = (v: number) => formatMoney(v)
const short = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`)
const count = (v: number) => String(v)
const monthShort = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1] ?? key
const monthLong = (key: string) => fmt(`${key}-15`, { month: 'long' })
const day = (key: string) => fmt(key, { day: 'numeric', month: 'short' })
const TONE_LABEL: Record<Tone, string> = { rojo: 'Rojo', amarillo: 'Amarillo', verde: 'Verde', gris: '' }

/* ── 1. Frase de estado ── */
function compareText(list: Array<{ label: string; value: number | null }>, now: number) {
  return list
    .map((c) => {
      if (c.value === null) return `${c.label}: sin datos`
      if (!c.value) return `${c.label}: $0`
      const pct = Math.round(((now - c.value) / c.value) * 100)
      return `${pct >= 0 ? '+' : ''}${pct} % vs ${c.label}`
    })
    .join(' · ')
}
const todo = computed(() => props.data.actions.length)
const todoText = computed(() => (todo.value ? `Hay ${todo.value} ${todo.value === 1 ? 'cosa' : 'cosas'} por hacer.` : 'Nada pendiente.'))
const sentence = computed(() => {
  const d = props.data
  const sold = `el bar vendió ${money(f.value.bar)} y los wetsuits ${money(f.value.wetsuits)}`
  if (kind.value === 'ano') {
    const prev = f.value.compare[0]
    const cmp = !prev || prev.value === null ? 'No hay año anterior para comparar.' : `Frente a ${prev.label}: ${compareText([prev], f.value.bar)}.`
    const pct = f.value.collectedPct === null ? '' : ` Se cobró el ${f.value.collectedPct} %.`
    return `En ${d.period.label} ${sold}.${pct} ${cmp} ${todoText.value}`
  }
  if (kind.value === 'mes') {
    const n = d.cruises.length
    const closing = d.cruises.find((c) => c.status === 'abordo' && c.end === todayKey())
    const closingText =
      closing && f.value.pendingCollection > 0 ? ` ${closing.code} cierra hoy con ${money(f.value.pendingCollection)} por cobrar.` : ''
    return `En ${monthLong(d.period.value)} ${sold} en ${n} ${n === 1 ? 'crucero' : 'cruceros'}.${closingText} ${todoText.value}`
  }
  const c = d.cruise!
  const base = `${c.code} vendió ${money(f.value.bar)} en bar y ${money(f.value.wetsuits)} en wetsuits.`
  if (c.status === 'abordo' && c.end === todayKey()) {
    return `${base} Termina hoy${f.value.pendingCabins ? ` con las ${f.value.pendingCabins} cuentas sin aprobar ni cobrar` : ' con todo cobrado'}.`
  }
  if (c.status === 'abordo') return `${base} En curso hasta el ${day(c.end)}.`
  return `${base} ${f.value.pendingCollection > 0 ? `Quedan ${money(f.value.pendingCollection)} por cobrar.` : 'Todo cobrado.'}`
})

/* ── 2. Qué hacer ── */
function go(a: SummaryAction) {
  if (a.to.startsWith('#')) {
    document.getElementById(a.to.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  void router.push(a.to)
}

/* ── 3. Cuatro cifras ── */
const barHint = computed(() => {
  if (kind.value === 'crucero') {
    const c = f.value.compare[0]
    return c ? `vs ${c.label}: ${c.value === null ? '—' : money(c.value)}` : 'sin wetsuits'
  }
  return compareText(f.value.compare, f.value.bar) || 'sin wetsuits'
})
const pendingHint = computed(() => {
  if (kind.value === 'crucero') return f.value.pendingCabins ? `${f.value.pendingCabins} cabinas` : 'todo cobrado'
  const open = f.value.openCruises
  if (!open.length) return 'nada pendiente'
  const closing = props.data.cruises.find((c) => c.status === 'abordo' && c.end === todayKey())
  if (kind.value === 'mes' && closing) return `${closing.code}, cierra hoy`
  return `${open.length} crucero${open.length === 1 ? '' : 's'} abierto${open.length === 1 ? '' : 's'}`
})

/* ── Gráfico de tiempo ── */
const monthMax = computed(() => Math.max(1, ...props.data.byMonth.map((m) => m.bar + m.wetsuits)))
const dayColumns = computed(() => props.data.byDay.map((d) => ({ key: d.day, label: day(d.day), value: d.total })))

/* ── 4. ¿Se cobró todo? ── */
const collectMax = computed(() => Math.max(1, ...props.data.collectedRows.map((r) => Math.max(r.consumed, r.collected))))
function collectTag(r: BarSummary['collectedRows'][number]) {
  if (r.status === 'abordo') return 'En curso'
  if (Math.abs(r.diff) > 0.005) return `${r.diff > 0 ? '+' : '−'}${money(Math.abs(r.diff))}`
  if (r.noInvoice > 0) return `${money(r.noInvoice)} sin factura`
  return 'Cuadra'
}
const CABIN_STATUS: Record<string, string> = { abierta: 'por aprobar', en_revision: 'por aprobar', aprobada: 'aprobada', cobrada: 'pagada' }
const cabinRows = computed(() =>
  props.data.cabins.map((c) => ({ label: `Cab ${c.cabin}`, value: c.consumed, detail: c.due > 0.005 ? `${CABIN_STATUS[c.status] ?? c.status} · debe ${money(c.due)}` : 'pagada' })),
)

/* ── 6. Comisiones: marcar y pagar en un paso ── */
const STATE_LABEL: Record<string, string> = {
  retenida: 'Asignar persona',
  pendiente: 'Por pagar',
  parcial: 'Por pagar (parte)',
  en_curso: 'En curso',
  pagada: 'Pagada',
}
const STATE_TONE: Record<string, Tone> = { retenida: 'rojo', pendiente: 'amarillo', parcial: 'amarillo', en_curso: 'gris', pagada: 'verde' }
const picked = shallowRef<Set<string>>(new Set())
const payable = (r: BarSummary['commissions']['rows'][number]) => (r.state === 'pendiente' || r.state === 'parcial') && r.pending > 0
const pickedRows = computed(() => props.data.commissions.rows.filter((r) => picked.value.has(r.id)))
const pickedTotal = computed(() => Math.round(pickedRows.value.reduce((s, r) => s + r.pending, 0) * 100) / 100)
function togglePick(id: string) {
  const row = props.data.commissions.rows.find((r) => r.id === id)!
  const next = new Set(picked.value)
  if (next.has(id)) next.delete(id)
  else {
    // Un pago es de un solo bartender.
    for (const other of pickedRows.value) if (other.bartenderId !== row.bartenderId) next.delete(other.id)
    next.add(id)
  }
  picked.value = next
}
const payForm = reactive({ open: false, method: 'transferencia' as 'transferencia' | 'efectivo', reference: '', saving: false })
async function openReceipt(id: string) {
  try {
    const blob = await apiCommissionReceipt(id)
    window.open(URL.createObjectURL(blob), '_blank', 'noopener')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}
async function pay() {
  if (payForm.saving || !pickedRows.value.length) return
  payForm.saving = true
  try {
    const result = await apiCreateCommissionPayment({
      cruiseIds: pickedRows.value.map((r) => r.id),
      paidAt: todayKey(),
      note: '',
      method: payForm.method,
      reference: payForm.reference.trim(),
    })
    play('cash')
    toast.success(`Comisión pagada: ${money(pickedTotal.value)}`)
    picked.value = new Set()
    payForm.open = false
    payForm.reference = ''
    void openReceipt(result.paymentId)
    emit('reload')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    payForm.saving = false
  }
}
const historyOpen = shallowRef(false)
async function voidCommission(id: string, amount: number) {
  const reason = await confirm.askReason({
    title: '¿Anular este pago de comisión?',
    message: `${money(amount)} · sus cruceros vuelven a quedar por pagar.`,
    confirmLabel: 'Anular pago',
    danger: true,
    icon: 'fa-ban',
    reason: { label: 'Motivo (obligatorio)', suggestions: ['Monto equivocado', 'Bartender equivocado'] },
  })
  if (!reason) return
  try {
    await apiVoidCommissionPayment(id, reason)
    toast.success('Pago anulado')
    emit('reload')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

/* ── 7. Factura a la agencia: facturar y registrar cobro ── */
const agencyPicked = shallowRef<Set<string>>(new Set())
const invoiceable = computed(() => props.data.agency.rows.filter((r) => r.status === 'cerrado' && r.pending > 0))
const agencyPickedRows = computed(() => invoiceable.value.filter((r) => agencyPicked.value.has(r.id)))
const agencyTotal = computed(() => Math.round(agencyPickedRows.value.reduce((s, r) => s + r.pending, 0) * 100) / 100)
function toggleAgency(id: string) {
  const row = invoiceable.value.find((r) => r.id === id)!
  const next = new Set(agencyPicked.value)
  if (next.has(id)) next.delete(id)
  else {
    // Solo se juntan cruceros de la misma agencia.
    for (const other of agencyPickedRows.value) if (other.agency !== row.agency) next.delete(other.id)
    next.add(id)
  }
  agencyPicked.value = next
}
const invoiceForm = reactive({ open: false, number: '', saving: false })
async function invoiceAgency() {
  const rows = agencyPickedRows.value
  if (invoiceForm.saving || !rows.length) return
  if (!rows[0]!.agency) {
    toast.error(`Pon la agencia de ${rows[0]!.code} en Cruceros antes de facturar`)
    return
  }
  if (!invoiceForm.number.trim()) {
    toast.error('Escribe el número de la factura emitida en Contífico')
    return
  }
  invoiceForm.saving = true
  try {
    const result = await apiCreateAgencyInvoice({
      cruiseIds: rows.map((r) => r.id),
      month: todayKey().slice(0, 7),
      to: rows[0]!.agencyEmail,
      invoiceNumber: invoiceForm.number.trim(),
      note: '',
    })
    play('success')
    toast.success(
      result.email?.status === 'enviado'
        ? `Factura registrada y detalle enviado a ${result.email.to}`
        : result.email?.status === 'error'
          ? `Factura registrada. El correo no salió: ${result.email.error}`
          : 'Factura registrada',
    )
    agencyPicked.value = new Set()
    invoiceForm.open = false
    invoiceForm.number = ''
    emit('reload')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    invoiceForm.saving = false
  }
}
const collectFor = shallowRef('')
const collectForm = reactive({ amount: '', date: todayKey(), reference: '', saving: false })
function openCollect(inv: BarSummary['agency']['invoices'][number]) {
  collectFor.value = collectFor.value === inv.id ? '' : inv.id
  collectForm.amount = inv.due.toFixed(2)
  collectForm.date = todayKey()
  collectForm.reference = ''
}
async function registerAgencyPayment(id: string) {
  if (collectForm.saving) return
  const amount = Number(collectForm.amount.replace(',', '.'))
  if (!(amount > 0)) {
    toast.error('Indica el monto cobrado')
    return
  }
  collectForm.saving = true
  try {
    await apiAgencyInvoicePayment(id, { amount, date: collectForm.date, reference: collectForm.reference.trim() })
    play('cash')
    toast.success(`Cobro registrado: ${money(amount)}`)
    collectFor.value = ''
    emit('reload')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    collectForm.saving = false
  }
}
async function voidInvoice(inv: BarSummary['agency']['invoices'][number]) {
  const reason = await confirm.askReason({
    title: '¿Anular esta prefactura a la agencia?',
    message: `${inv.cruises.join(', ')} · ${money(inv.amount)}. Si esos cruceros ya no existen, no hay nada que facturar.`,
    confirmLabel: 'Anular',
    danger: true,
    icon: 'fa-ban',
    reason: { label: 'Motivo (obligatorio)', suggestions: ['Los cruceros ya no existen', 'Registrada por error'] },
  })
  if (!reason) return
  try {
    await apiVoidAgencyInvoice(inv.id, reason)
    toast.success('Prefactura anulada')
    emit('reload')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}
const unpaidInvoices = computed(() => props.data.agency.invoices.filter((i) => i.due > 0.005 && !i.orphan))
const orphanInvoices = computed(() => props.data.agency.invoices.filter((i) => i.orphan))

/* ── 9. Consumo por pasajero por día ── */
const paxRows = computed(() => {
  const p = props.data.perPaxDay
  if (kind.value === 'ano') return p.perMonth.map((m) => ({ label: monthShort(m.month), value: m.value ?? 0, tone: m.tone }))
  return p.perCruise.map((c) => ({ label: c.code, value: c.value ?? 0, tone: c.tone }))
})
const paxMax = computed(() => Math.max(1, ...paxRows.value.map((r) => r.value), props.data.perPaxDay.goal ?? 0))
const paxNote = computed(() => {
  const p = props.data.perPaxDay
  if (p.goal !== null) return `Meta: ${money(p.goal)} por pasajero por día.`
  return kind.value === 'mes' ? 'Sin meta: se compara entre cruceros.' : 'Sin meta ni año anterior.'
})

/* ── Lo servido ── */
const servedAll = shallowRef(false)
const served = computed(() => (servedAll.value ? props.data.served : props.data.served.slice(0, 5)))

const METHOD_LABEL: Record<string, string> = { tarjeta: 'Tarjeta', efectivo: 'Efectivo', transferencia: 'Transferencia', online: 'Pago en línea' }
</script>

<template>
  <div class="ins bar-view">
    <p v-if="data.cruise" class="cruise-line">
      {{ data.cruise.route }}<template v-if="data.cruise.route"> · </template>{{ day(data.cruise.start) }}–{{ day(data.cruise.end) }} · tipo
      {{ data.cruise.leg }} · {{ data.cruise.status === 'abordo' ? 'En curso' : data.cruise.status === 'cerrado' ? 'Finalizado' : 'Programado' }} ·
      Bartender: {{ data.cruise.bartender || '—' }} · Agencia: {{ data.cruise.agency || '—' }}
    </p>

    <!-- 1. Frase de estado -->
    <p class="state">{{ sentence }}</p>

    <!-- 2. Qué hacer -->
    <section class="ins-card todo" :class="{ 'todo--clear': !data.actions.length }" aria-labelledby="todo-title">
      <h3 id="todo-title">Qué hacer</h3>
      <p v-if="!data.actions.length" class="ins-empty"><i class="fa-solid fa-circle-check" aria-hidden="true" /> Nada pendiente.</p>
      <ul v-else class="todo-list">
        <li v-for="(a, i) in data.actions" :key="i">
          <span class="tone" :class="`tone--${a.tone}`">{{ TONE_LABEL[a.tone] }}</span>
          <span class="todo-text">{{ a.text }}</span>
          <strong class="todo-amount">{{ a.amount !== undefined ? money(a.amount) : a.count ?? '' }}</strong>
          <button type="button" class="todo-go" @click="go(a)">{{ a.label }} <i class="fa-solid fa-arrow-right" aria-hidden="true" /></button>
        </li>
      </ul>
    </section>

    <!-- 3. Cuatro cifras -->
    <dl class="ins-kpis">
      <div>
        <dt>Vendido bar</dt>
        <dd>{{ money(f.bar) }}</dd>
        <small>{{ barHint }}</small>
      </div>
      <div>
        <dt>Cobrado</dt>
        <dd>{{ money(f.collected) }}</dd>
        <small>{{ f.collectedPct === null ? 'sin consumos' : `${f.collectedPct} % de lo consumido` }}</small>
      </div>
      <div>
        <dt>Por cobrar</dt>
        <dd :class="{ 'dd--warn': f.pendingCollection > 0 }">{{ money(f.pendingCollection) }}</dd>
        <small>{{ pendingHint }}</small>
      </div>
      <div>
        <dt>Margen</dt>
        <dd :class="`dd--${f.marginTone}`">{{ f.margin === null ? '—' : money(f.margin) }}</dd>
        <small v-if="f.margin === null">
          faltan costos de {{ f.productsWithoutCost }} productos ·
          <RouterLink to="/admin/productos">Cargar costo de {{ f.productsWithoutCost }} productos</RouterLink>
        </small>
        <small v-else>{{ f.marginPct }} % de lo vendido · menos comisiones y merma</small>
      </div>
    </dl>

    <!-- Gráfico de tiempo: vendido mes a mes (año) o consumo por día (crucero) -->
    <section v-if="kind === 'ano' && data.byMonth.length" class="ins-card" aria-labelledby="t-months">
      <h3 id="t-months">Vendido mes a mes</h3>
      <p class="ins-sub"><span class="key key--bar" /> Bar <span class="key key--wet" /> Wetsuits · Toca un mes para abrirlo.</p>
      <div class="stack" role="group" aria-label="Vendido por mes, bar y wetsuits">
        <button
          v-for="m in data.byMonth"
          :key="m.month"
          type="button"
          class="stack-col"
          :aria-label="`${monthLong(m.month)}: bar ${money(m.bar)}, wetsuits ${money(m.wetsuits)}`"
          @click="emit('period', 'mes', m.month)"
        >
          <span class="stack-plot" aria-hidden="true">
            <span class="stack-value">{{ short(m.bar + m.wetsuits) }}</span>
            <span class="stack-seg stack-seg--wet" :style="{ height: `${(m.wetsuits / monthMax) * 100}%` }" />
            <span class="stack-seg stack-seg--bar" :style="{ height: `${(m.bar / monthMax) * 100}%` }" />
          </span>
          <span class="stack-label">{{ monthShort(m.month) }}</span>
        </button>
      </div>
      <p class="ins-note" v-if="data.partial">{{ data.partial.label }}: el gráfico empieza en el primer mes con operación.</p>
    </section>

    <div class="ins-grid">
      <!-- 4. ¿Se cobró todo? / Cuentas por cabina -->
      <section v-if="kind !== 'crucero'" class="ins-card ins-card--wide" aria-labelledby="b-collected">
        <h3 id="b-collected">¿Se cobró todo lo consumido?<template v-if="kind === 'ano'"> · cruceros del año</template></h3>
        <p class="ins-sub"><span class="key key--consumed" /> Consumido <span class="key key--bar" /> Cobrado</p>
        <p v-if="!data.collectedRows.length" class="ins-empty">Sin cruceros en este período.</p>
        <ul v-else class="pairs">
          <li v-for="r in data.collectedRows" :key="r.id">
            <button type="button" class="ins-link" @click="emit('period', 'crucero', r.id)">{{ r.code }}</button>
            <span class="pair-bars" :aria-label="`Consumido ${money(r.consumed)}, cobrado ${money(r.collected)}`">
              <span class="pair pair--consumed" :style="{ width: `${(r.consumed / collectMax) * 100}%` }" />
              <span class="pair pair--collected" :style="{ width: `${(r.collected / collectMax) * 100}%` }" />
            </span>
            <span class="tone" :class="`tone--${r.tone}`">{{ collectTag(r) }}</span>
          </li>
        </ul>
      </section>
      <section v-else class="ins-card" aria-labelledby="b-cabins">
        <h3 id="b-cabins">Cuentas por cabina</h3>
        <p class="ins-sub">{{ f.pendingCabins ? `${f.pendingCabins} con saldo · ${money(f.pendingCollection)}` : 'Todo cobrado.' }}</p>
        <OwnerBars :rows="cabinRows" :format="money" tone="main" empty="Sin consumos." />
      </section>

      <section v-if="kind === 'crucero'" class="ins-card" aria-labelledby="b-days">
        <h3 id="b-days">Consumo por día</h3>
        <p class="ins-sub">Bar y wetsuits, sin cortesías.</p>
        <ColumnChart :columns="dayColumns" :format="short" label="Consumo por día del crucero" />
      </section>

      <!-- 5. Wetsuits -->
      <section id="wetsuits" class="ins-card" :class="{ 'ins-card--wide': kind === 'mes' }" aria-labelledby="b-wet">
        <h3 id="b-wet">{{ kind === 'ano' ? 'Wetsuits del año' : kind === 'crucero' ? 'Wetsuits del crucero' : 'Wetsuits' }}</h3>
        <p class="ins-sub">Aparte del bar: no suman al vendido bar ni a la comisión.</p>
        <template v-if="kind !== 'mes'">
          <dl class="lines">
            <div><dt>Ingresos</dt><dd>{{ money(data.wetsuits.income) }}</dd></div>
            <div>
              <dt>Alquilados</dt>
              <dd>{{ data.wetsuits.rented }}<template v-if="kind === 'crucero'"> de {{ data.wetsuits.passengers }} pasajeros</template></dd>
            </div>
            <div v-if="kind === 'ano'"><dt>Pasajeros que alquilan</dt><dd>{{ data.wetsuits.rentPct ?? 0 }} %</dd></div>
            <div v-if="kind === 'crucero'"><dt>Paga</dt><dd>{{ data.wetsuits.rows[0]?.payer === 'Cabina' ? `Cabina ${data.wetsuits.rows[0]?.payerCabins.join(', ')}` : data.wetsuits.rows[0]?.payer ?? '—' }}</dd></div>
            <div><dt>Sin factura</dt><dd :class="{ 'dd--rojo': data.wetsuits.noInvoice > 0 }">{{ money(data.wetsuits.noInvoice) }}</dd></div>
          </dl>
          <p v-for="o in data.wetsuits.rows[0]?.overCabins ?? []" v-show="kind === 'crucero'" :key="o.cabin" class="tone tone--amarillo tone--block">
            {{ o.rented }} wetsuits para {{ o.pax }} pasajeros en cabina {{ o.cabin }}: revisar
          </p>
        </template>
        <template v-else>
          <dl class="ins-kpis ins-kpis--inner">
            <div><dt>Ingresos</dt><dd>{{ money(data.wetsuits.income) }}</dd><small>aparte del bar</small></div>
            <div><dt>Alquilados</dt><dd>{{ data.wetsuits.rented }}</dd><small>wetsuits</small></div>
            <div><dt>Pasajeros que alquilan</dt><dd>{{ data.wetsuits.rentPct ?? 0 }} %</dd></div>
            <div>
              <dt>Precio promedio</dt>
              <dd>{{ data.wetsuits.avgPrice === null ? '—' : money(data.wetsuits.avgPrice) }}</dd>
              <small>tarifa {{ money(data.wetsuits.rates.ab ?? 0) }} A/B · {{ money(data.wetsuits.rates.c ?? 0) }} C</small>
            </div>
          </dl>
          <div class="ins-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Crucero</th>
                  <th scope="col" class="num">Alquilados</th>
                  <th scope="col" class="num">Pasajeros</th>
                  <th scope="col" class="num">Ingreso</th>
                  <th scope="col">Paga</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="w in data.wetsuits.rows" :key="w.id">
                  <th scope="row">{{ w.code }}</th>
                  <td class="num">{{ w.rented }}</td>
                  <td class="num">{{ w.passengers }}</td>
                  <td class="num">{{ money(w.income) }}</td>
                  <td>{{ w.payer }}</td>
                  <td>
                    <span class="tone" :class="`tone--${w.tone}`">
                      {{ w.state }}<template v-for="o in w.overCabins" :key="o.cabin"> · revisar {{ o.rented }} para {{ o.pax }} pax</template
                      ><template v-if="w.offRate"> · precio fuera de tarifa</template>
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>

      <!-- 6. Comisiones -->
      <section id="comisiones" class="ins-card" :class="{ 'ins-card--wide': kind === 'mes' }" aria-labelledby="b-com">
        <div class="card-head">
          <h3 id="b-com">{{ kind === 'ano' ? 'Comisiones del año' : kind === 'crucero' ? 'Comisión del crucero' : 'Comisiones del bartender' }}</h3>
          <button v-if="kind !== 'crucero'" type="button" class="btn-text" @click="historyOpen = !historyOpen">
            {{ historyOpen ? 'Ocultar historial' : 'Ver historial de pagos' }}
          </button>
        </div>
        <template v-if="kind === 'ano'">
          <dl class="lines">
            <div><dt>Generadas</dt><dd>{{ money(data.commissions.generated) }}</dd></div>
            <div><dt>Pagadas</dt><dd>{{ money(data.commissions.paid) }}</dd></div>
            <div><dt>Por pagar</dt><dd :class="{ 'dd--amarillo': data.commissions.pending > 0 }">{{ money(data.commissions.pending) }}</dd></div>
            <div><dt>Retenidas (sin persona)</dt><dd :class="{ 'dd--rojo': data.commissions.retained > 0 }">{{ money(data.commissions.retained) }}</dd></div>
          </dl>
          <p v-if="data.commissions.projected" class="ins-sub">
            + {{ money(data.commissions.projected) }} proyectada de {{ data.commissions.projectedFrom.join(', ') }}, en curso
          </p>
        </template>
        <template v-else-if="kind === 'crucero'">
          <p v-if="!data.commissionCruise" class="ins-empty">Sin ventas de bar en este crucero.</p>
          <template v-else>
            <dl class="lines">
              <div>
                <dt>{{ data.commissionCruise.bartenderName || 'Sin bartender' }}</dt>
                <dd>{{ money(data.commissionCruise.state === 'en_curso' ? data.commissionCruise.projected : data.commissionCruise.commission) }}</dd>
              </div>
            </dl>
            <p class="ins-sub">
              <template v-if="data.commissionCruise.state === 'en_curso'">
                Proyectada sobre {{ money(data.commissionCruise.salesAll) }} de bar. Se puede pagar cuando el crucero se finalice y se cobren sus cuentas.
              </template>
              <template v-else>{{ STATE_LABEL[data.commissionCruise.state] }} · sobre {{ money(data.commissionCruise.sales) }} de bar cobrado.</template>
            </p>
          </template>
          <dl class="lines">
            <div><dt>Cortesías para la agencia</dt><dd>{{ money(data.agencyCruise ?? 0) }}</dd></div>
          </dl>
        </template>
        <template v-else>
          <div class="ins-table">
            <table>
              <thead>
                <tr>
                  <th scope="col"><span class="sr-only">Marcar</span></th>
                  <th scope="col">Crucero</th>
                  <th scope="col">Bartender</th>
                  <th scope="col" class="num">Ventas bar cobradas</th>
                  <th scope="col" class="num">Comisión</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in data.commissions.rows" :key="r.id">
                  <td>
                    <input
                      v-if="payable(r)"
                      type="checkbox"
                      class="check"
                      :checked="picked.has(r.id)"
                      :aria-label="`Pagar ${r.code}`"
                      @change="togglePick(r.id)"
                    />
                  </td>
                  <th scope="row">{{ r.code }}</th>
                  <td><span :class="{ 'tone tone--rojo': r.generic }">{{ r.generic ? `«${r.bartenderName || 'Sin bartender'}» genérico` : r.bartenderName }}</span></td>
                  <td class="num">{{ r.state === 'en_curso' ? `${money(r.sales)} de ${money(r.salesAll)}` : money(r.sales) }}</td>
                  <td class="num">{{ r.state === 'en_curso' ? `${money(r.projected)} proyectada` : money(r.commission) }}</td>
                  <td><span class="tone" :class="`tone--${STATE_TONE[r.state]}`">{{ STATE_LABEL[r.state] }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!data.commissions.rows.length" class="ins-empty">Sin ventas de bar en este período.</p>
          <div class="card-foot">
            <small>{{ Math.round(data.commissions.rate * 100) }} % de ventas de bar cobradas ÷ {{ data.commissions.divisor }} · sin wetsuits ni servicios. Pagado en el año: {{ money(data.commissions.paidInYear) }}</small>
            <button v-if="pickedRows.length && !payForm.open" type="button" class="btn btn-primary" @click="payForm.open = true">
              Pagar · {{ pickedRows.length }} crucero{{ pickedRows.length === 1 ? '' : 's' }} · {{ money(pickedTotal) }}
            </button>
          </div>
          <div v-if="payForm.open && pickedRows.length" class="confirm-box">
            <p class="confirm-title">
              <strong>Confirmar pago</strong>
              <span>{{ pickedRows[0]!.bartenderName }} · {{ pickedRows.map((r) => r.code).join(', ') }}</span>
              <strong>{{ money(pickedTotal) }}</strong>
            </p>
            <div class="confirm-row">
              <div class="seg" role="radiogroup" aria-label="Método">
                <button type="button" role="radio" :aria-checked="payForm.method === 'transferencia'" :class="{ on: payForm.method === 'transferencia' }" @click="payForm.method = 'transferencia'">Transferencia</button>
                <button type="button" role="radio" :aria-checked="payForm.method === 'efectivo'" :class="{ on: payForm.method === 'efectivo' }" @click="payForm.method = 'efectivo'">Efectivo</button>
              </div>
              <input v-model="payForm.reference" type="text" maxlength="80" class="ref" aria-label="Referencia" placeholder="Nº de comprobante (opcional)" />
            </div>
            <div class="confirm-row confirm-row--end">
              <small>Fecha: hoy. Al confirmar se genera el recibo en PDF para firma.</small>
              <button type="button" class="btn btn-secondary" @click="payForm.open = false">Cancelar</button>
              <button type="button" class="btn btn-primary" :disabled="payForm.saving" @click="pay">
                <i class="fa-solid" :class="payForm.saving ? 'fa-spinner fa-spin' : 'fa-check'" aria-hidden="true" /> Confirmar pago
              </button>
            </div>
          </div>
        </template>
        <ul v-if="historyOpen" class="history">
          <li v-if="!data.commissions.payments.length" class="ins-empty">Sin pagos registrados.</li>
          <li v-for="p in data.commissions.payments" :key="p.id" :class="{ voided: p.status !== 'vigente' }">
            <span>
              <strong>{{ money(p.amount) }}</strong> · {{ p.bartenderName }} · {{ p.items.map((i) => i.code).join(', ') }} ·
              {{ fmt(p.paidAt, { day: 'numeric', month: 'short', year: 'numeric' }) }}<template v-if="p.method"> · {{ METHOD_LABEL[p.method] }}</template>
              <template v-if="p.voided"> · anulado: {{ p.voided.reason }}</template>
            </span>
            <span class="history-actions">
              <button type="button" class="btn-text" @click="openReceipt(p.id)"><i class="fa-solid fa-file-pdf" aria-hidden="true" /> Recibo</button>
              <button v-if="p.status === 'vigente'" type="button" class="btn-text danger" @click="voidCommission(p.id, p.amount)">Anular</button>
            </span>
          </li>
        </ul>
      </section>

      <!-- 7. Factura a la agencia -->
      <section v-if="kind !== 'crucero'" id="agencia" class="ins-card" :class="{ 'ins-card--wide': kind === 'mes' }" aria-labelledby="b-agency">
        <h3 id="b-agency">{{ kind === 'ano' ? 'Agencia del año' : 'Factura a la agencia' }}</h3>
        <p class="ins-sub">Cortesías de bar y wetsuits que paga la agencia. A precio de venta; descuentan inventario.</p>
        <dl v-if="kind === 'ano'" class="lines">
          <div><dt>Por facturar</dt><dd>{{ money(data.agency.toInvoice) }}</dd></div>
          <div><dt>Facturado sin cobrar</dt><dd>{{ money(data.agency.invoicedUnpaid) }}</dd></div>
          <div><dt>Cobrado</dt><dd>{{ money(data.agency.collected) }}</dd></div>
          <div v-for="inv in orphanInvoices" :key="inv.id">
            <dt>Prefactura por anular</dt>
            <dd class="dd--rojo">{{ money(inv.amount) }}</dd>
          </div>
        </dl>
        <template v-else>
          <div class="stages">
            <div class="stage stage--todo"><span>Por facturar</span><strong>{{ money(data.agency.toInvoice) }}</strong></div>
            <div class="stage stage--sent"><span>Facturado sin cobrar</span><strong>{{ money(data.agency.invoicedUnpaid) }}</strong></div>
            <div class="stage stage--done"><span>Cobrado</span><strong>{{ money(data.agency.collected) }}</strong></div>
          </div>
        </template>
        <div v-for="inv in orphanInvoices" :key="inv.id" class="orphan">
          <span class="tone tone--rojo">Prefactura antigua del {{ fmt(inv.createdAt, { day: '2-digit', month: 'short' }) }} · {{ inv.cruises.join(', ') }} · {{ money(inv.amount) }} · esos cruceros no existen</span>
          <button type="button" class="btn btn-secondary" @click="voidInvoice(inv)">Anular con motivo</button>
        </div>
        <template v-if="kind === 'mes'">
          <h4 class="step">Paso 1 · Marcar cruceros y facturar</h4>
          <p v-if="!invoiceable.length" class="ins-empty">Sin cortesías de agencia por facturar. Cuando haya, se marcan los cruceros y se toca «Facturar».</p>
          <div v-else class="ins-table">
            <table>
              <thead>
                <tr>
                  <th scope="col"><span class="sr-only">Marcar</span></th>
                  <th scope="col">Crucero</th>
                  <th scope="col">Fechas</th>
                  <th scope="col">Agencia</th>
                  <th scope="col" class="num">Cortesías bar</th>
                  <th scope="col" class="num">Wetsuits que paga la agencia</th>
                  <th scope="col" class="num">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in invoiceable" :key="r.id">
                  <td><input type="checkbox" class="check" :checked="agencyPicked.has(r.id)" :aria-label="`Facturar ${r.code}`" @change="toggleAgency(r.id)" /></td>
                  <th scope="row">{{ r.code }}</th>
                  <td>{{ day(r.start) }}<template v-if="r.end">–{{ day(r.end) }}</template></td>
                  <td>{{ r.agency || 'Sin agencia' }}</td>
                  <td class="num">{{ money(r.bar) }}</td>
                  <td class="num">{{ money(r.wetsuits) }}</td>
                  <td class="num"><strong>{{ money(r.pending) }}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="invoiceable.length" class="card-foot">
            <small>Solo se juntan cruceros finalizados de la misma agencia.</small>
            <button v-if="agencyPickedRows.length && !invoiceForm.open" type="button" class="btn btn-primary" @click="invoiceForm.open = true">
              Facturar · {{ agencyPickedRows.length }} crucero{{ agencyPickedRows.length === 1 ? '' : 's' }} · {{ money(agencyTotal) }}
            </button>
          </div>
          <div v-if="invoiceForm.open && agencyPickedRows.length" class="confirm-box">
            <p class="confirm-title">
              <strong>Confirmar factura</strong>
              <span>{{ agencyPickedRows[0]!.agency || 'Sin agencia' }}<template v-if="agencyPickedRows[0]!.agencyRuc"> · RUC {{ agencyPickedRows[0]!.agencyRuc }}</template><template v-if="agencyPickedRows[0]!.agencyEmail"> · {{ agencyPickedRows[0]!.agencyEmail }}</template></span>
            </p>
            <div class="ins-table">
              <table>
                <thead>
                  <tr><th scope="col">Detalle</th><th scope="col" class="num">Cant.</th><th scope="col" class="num">Importe</th></tr>
                </thead>
                <tbody>
                  <template v-for="r in agencyPickedRows" :key="r.id">
                    <tr v-if="r.bar"><td>{{ r.code }} · Cortesías de bar</td><td class="num">{{ r.barCount }}</td><td class="num">{{ money(r.bar) }}</td></tr>
                    <tr v-if="r.wetsuits"><td>{{ r.code }} · Wetsuits</td><td class="num">{{ r.wetsuitCount }}</td><td class="num">{{ money(r.wetsuits) }}</td></tr>
                  </template>
                </tbody>
                <tfoot>
                  <tr><td>Total (IVA incluido)</td><td /><td class="num">{{ money(agencyTotal) }}</td></tr>
                </tfoot>
              </table>
            </div>
            <div class="confirm-row">
              <label class="ref-label" for="agency-invoice-number">Nº de la factura emitida en Contífico</label>
              <input id="agency-invoice-number" v-model="invoiceForm.number" type="text" maxlength="60" class="ref" placeholder="001-100-000000830" />
            </div>
            <div class="confirm-row confirm-row--end">
              <small>Al confirmar, la agencia recibe por correo el detalle por crucero.</small>
              <button type="button" class="btn btn-secondary" @click="invoiceForm.open = false">Cancelar</button>
              <button type="button" class="btn btn-primary" :disabled="invoiceForm.saving" @click="invoiceAgency">
                <i class="fa-solid" :class="invoiceForm.saving ? 'fa-spinner fa-spin' : 'fa-paper-plane'" aria-hidden="true" /> Confirmar y enviar
              </button>
            </div>
          </div>

          <h4 class="step">Paso 2 · Facturado sin cobrar</h4>
          <p v-if="!unpaidInvoices.length" class="ins-empty">No hay facturas a la agencia por cobrar.</p>
          <ul v-else class="invoices">
            <li v-for="inv in unpaidInvoices" :key="inv.id">
              <div class="invoice-row">
                <span><strong>{{ inv.number || inv.month }}</strong> · {{ inv.agency || 'Agencia' }} · {{ inv.cruises.join(', ') }}</span>
                <span class="num">{{ money(inv.amount) }} · cobrado {{ money(inv.paid) }}</span>
                <span class="tone" :class="inv.days > data.agency.maxDays ? 'tone--rojo' : 'tone--gris'">{{ inv.days }} días</span>
                <button type="button" class="btn btn-secondary" @click="openCollect(inv)">Registrar cobro</button>
              </div>
              <div v-if="collectFor === inv.id" class="confirm-row">
                <input v-model="collectForm.date" type="date" class="ref" aria-label="Fecha del cobro" :max="todayKey()" />
                <input v-model="collectForm.amount" type="text" inputmode="decimal" class="ref" aria-label="Monto cobrado" />
                <input v-model="collectForm.reference" type="text" maxlength="80" class="ref" aria-label="Referencia" placeholder="Referencia" />
                <button type="button" class="btn btn-primary" :disabled="collectForm.saving" @click="registerAgencyPayment(inv.id)">Guardar</button>
              </div>
            </li>
          </ul>
          <p class="ins-sub">Registrar cobro pide fecha, monto (acepta parcial) y referencia. En rojo desde {{ data.agency.maxDays }} días sin cobrar.</p>
        </template>
      </section>

      <!-- 8. Dónde está la plata -->
      <section v-if="kind !== 'crucero'" class="ins-card" aria-labelledby="b-money">
        <h3 id="b-money">Dónde está la plata</h3>
        <dl class="lines">
          <div v-for="m in data.money.methods" :key="m.method">
            <dt>{{ METHOD_LABEL[m.method] ?? m.method }} · {{ m.count }} cobro{{ m.count === 1 ? '' : 's' }}</dt>
            <dd>{{ money(m.total) }}</dd>
          </div>
        </dl>
        <p v-if="!data.money.methods.length" class="ins-empty">Sin cobros en este período.</p>
        <p class="ins-sub">
          <template v-if="data.money.cashUndeposited.count">
            <span class="tone tone--block" :class="`tone--${data.money.tone === 'rojo' ? 'rojo' : 'amarillo'}`">
              Efectivo sin depositar: {{ money(data.money.cashUndeposited.total) }} ({{ data.money.cashUndeposited.count }}), el más antiguo de hace {{ data.money.cashUndeposited.oldestDays }} días
            </span>
            <RouterLink to="/admin/pagos?metodo=efectivo" class="inline-link">Registrar depósito</RouterLink>
          </template>
          <template v-else>Depósito del efectivo: {{ data.money.depositsRegistered ? 'al día' : 'no registrado' }}.</template>
        </p>
      </section>

      <!-- 9. Consumo por pasajero por día -->
      <section class="ins-card" aria-labelledby="b-pax">
        <h3 id="b-pax">Consumo por pasajero por día<template v-if="kind === 'ano'">, mes a mes</template></h3>
        <template v-if="kind === 'crucero'">
          <p class="big" :class="`dd--${data.perPaxDay.tone}`">{{ data.perPaxDay.value === null ? '—' : money(data.perPaxDay.value) }}</p>
          <p class="ins-sub">
            <template v-if="data.perPaxDay.compare">{{ data.perPaxDay.compare.label }}: {{ data.perPaxDay.compare.value === null ? '—' : money(data.perPaxDay.compare.value) }}.</template>
            <template v-else>Primer crucero tipo {{ data.cruise?.leg }}: sin crucero anterior para comparar.</template>
            <template v-if="data.perPaxDay.goal !== null"> Meta {{ money(data.perPaxDay.goal) }}.</template>
          </p>
        </template>
        <template v-else>
          <ul class="hbars">
            <li v-for="r in paxRows" :key="r.label">
              <span>{{ r.label }}</span>
              <span class="hbar"><span :class="`hbar-fill hbar-fill--${r.tone}`" :style="{ width: `${(r.value / paxMax) * 100}%` }" /></span>
              <strong>{{ money(r.value) }}</strong>
            </li>
          </ul>
          <p class="ins-sub">{{ paxNote }}</p>
        </template>
      </section>

      <!-- 10. Merma -->
      <section class="ins-card" aria-labelledby="b-waste">
        <h3 id="b-waste">Merma{{ kind === 'ano' ? ' del año' : kind === 'mes' ? '' : '' }}</h3>
        <template v-if="data.waste.value !== null">
          <p class="big" :class="`dd--${data.waste.tone}`">{{ money(data.waste.value) }}<small v-if="data.waste.pct !== null"> · {{ data.waste.pct }} % de lo vendido</small></p>
        </template>
        <p v-else class="big dd--rojo">{{ kind === 'crucero' ? 'Sin conteo' : 'Sin dato' }}</p>
        <p class="ins-sub">
          <template v-if="kind === 'crucero'">Se calcula al finalizar con el conteo del bar.</template>
          <template v-else>
            {{ data.waste.counted }} de {{ data.waste.finished }} cruceros finalizados se cerraron con conteo.<template v-if="data.waste.missingCost"> Faltan costos para valorarla.</template>
            <template v-if="data.waste.lastCount"> Último conteo: {{ fmt(data.waste.lastCount, { day: 'numeric', month: 'short' }) }}.</template>
          </template>
        </p>
        <span v-if="data.waste.belowZero" class="tone tone--rojo" :title="data.waste.belowZeroNames.join(', ')">{{ data.waste.belowZero }} productos bajo cero</span>
      </section>

      <!-- 11. Por tipo de crucero (Mes) -->
      <section v-if="kind === 'mes'" class="ins-card" aria-labelledby="b-legs">
        <h3 id="b-legs">Por tipo de crucero</h3>
        <OwnerBars :rows="data.perPaxDay.byLeg.map((l) => ({ label: `Tipo ${l.leg}`, value: l.value ?? 0 }))" :format="money" tone="main" empty="Sin cruceros." />
        <p class="ins-sub">Consumo bar por pasajero por día.</p>
      </section>

      <!-- Lo servido (Crucero) -->
      <section v-if="kind === 'crucero'" class="ins-card ins-card--wide" aria-labelledby="b-served">
        <h3 id="b-served">Lo servido · top 5</h3>
        <div v-if="served.length" class="ins-table">
          <table>
            <thead>
              <tr><th scope="col">Producto</th><th scope="col" class="num">Unid.</th><th scope="col" class="num">Importe</th></tr>
            </thead>
            <tbody>
              <tr v-for="p in served" :key="p.name">
                <td>{{ p.name }}</td>
                <td class="num">{{ p.qty }}</td>
                <td class="num">{{ money(p.amount) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="ins-empty">No se sirvió nada.</p>
        <button v-if="data.served.length > 5" type="button" class="btn-text" @click="servedAll = !servedAll">
          {{ servedAll ? 'Ver menos' : `Ver todo (${data.served.length} productos)` }}
        </button>
      </section>
    </div>

    <!-- 12. Equipo (Año y Mes) -->
    <section v-if="kind !== 'crucero'" class="ins-card" aria-labelledby="b-team">
      <h3 id="b-team">Equipo · {{ data.period.label }}</h3>
      <div v-if="data.team.length" class="ins-table">
        <table>
          <thead>
            <tr>
              <th scope="col">Persona</th>
              <th scope="col" class="num">Vendió bar</th>
              <th scope="col" class="num">Anulaciones</th>
              <th scope="col" class="num">Cuentas sin aprobar</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in data.team" :key="t.id">
              <td><span :class="{ 'tone tone--rojo': t.generic }">{{ t.generic ? `«${t.name}» genérico` : t.name }}</span></td>
              <td class="num">{{ t.bar ? money(t.bar) : t.wetsuits ? `${money(t.wetsuits)} wetsuits` : money(0) }}<template v-if="t.bar && t.wetsuits"> + {{ money(t.wetsuits) }} wetsuits</template></td>
              <td class="num" :class="{ 'dd--rojo': t.tone === 'rojo' && !t.generic }">{{ t.annulments ?? '—' }}</td>
              <td class="num">{{ t.unapproved }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="ins-empty">Sin ventas en este período.</p>
      <p class="ins-sub">La comisión de cada persona está en el bloque Comisiones.</p>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use '@/components/owner/insights';

.cruise-line {
  margin: 0;
  color: var(--ink-600);
  font-size: 0.95rem;
}

.state {
  margin: 0;
  font-size: 1.1rem;
  line-height: 1.5;
  color: var(--ink-900);
  text-wrap: pretty;
}

.todo {
  border-color: var(--pill-danger-bg);

  &--clear {
    border-color: var(--pill-ok-bg);
  }
}

.todo-list {
  display: flex;
  flex-direction: column;
  margin: 0.6rem 0 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.75rem;
    padding: 0.45rem 0;
    border-top: 1px solid var(--line);

    &:first-child {
      border-top: 0;
    }
  }
}

.todo-text {
  flex: 1 1 260px;
  min-width: 0;
}

.todo-amount {
  font-variant-numeric: tabular-nums;
}

.todo-go {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 44px;
  padding: 0 0.85rem;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--navy-800);
  font-size: 0.9rem;
  font-weight: 600;
}

.tone {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  background: var(--pill-neutral-bg);
  color: var(--pill-neutral-ink);

  &--rojo {
    background: var(--pill-danger-bg);
    color: var(--pill-danger-ink);
  }

  &--amarillo {
    background: var(--pill-warn-bg);
    color: var(--pill-warn-ink);
  }

  &--verde {
    background: var(--pill-ok-bg);
    color: var(--pill-ok-ink);
  }

  &--block {
    margin: 0.5rem 0 0;
    white-space: normal;
  }
}

.dd--rojo {
  color: var(--danger-ink) !important;
}

.dd--amarillo,
.dd--warn {
  color: var(--warning-ink) !important;
}

.dd--verde {
  color: var(--success-ink) !important;
}

.dd--gris {
  color: var(--ink-400) !important;
}

.ins-kpis small a {
  color: var(--navy-700);
  font-weight: 600;
}

.ins-kpis--inner {
  margin-bottom: 0.75rem;

  > div {
    background: var(--cream-100);
  }
}

.key {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin: 0 0.25rem 0 0.5rem;
  border-radius: 2px;

  &--bar {
    background: var(--navy-600);
  }

  &--wet {
    background: var(--gold-500);
  }

  &--consumed {
    background: var(--line-strong);
  }
}

.stack {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  min-height: 190px;
}

.stack-col {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.3rem;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.stack-plot {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  height: 160px;
  border-bottom: 1px solid var(--line);
}

.stack-value {
  font-size: 0.8rem;
  font-weight: 600;
  text-align: center;
  color: var(--ink-600);
}

.stack-seg {
  display: block;

  &--bar {
    background: var(--navy-600);
  }

  &--wet {
    background: var(--gold-500);
    border-radius: 4px 4px 0 0;
  }
}

.stack-label {
  font-size: 0.8rem;
  text-align: center;
  color: var(--ink-600);
}

.pairs {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
}

.pair-bars {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.pair {
  display: block;
  height: 10px;
  min-width: 2px;
  border-radius: 999px;

  &--consumed {
    background: var(--line-strong);
  }

  &--collected {
    background: var(--navy-600);
  }
}

.lines {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0;

  > div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }

  dt {
    color: var(--ink-600);
  }

  dd {
    margin: 0;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
}

.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.6rem;

  h3 {
    margin: 0;
    font-size: 1.05rem;
  }
}

.card-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin-top: 0.6rem;

  small {
    color: var(--ink-400);
  }
}

.check {
  width: 22px;
  height: 22px;
  accent-color: var(--navy-700);
}

.confirm-box {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-top: 0.75rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--cream-100);
}

.confirm-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.3rem 0.75rem;
  margin: 0;

  span {
    flex: 1;
    color: var(--ink-600);
  }
}

.confirm-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;

  &--end {
    justify-content: flex-end;

    small {
      flex: 1 1 220px;
      color: var(--ink-400);
    }
  }
}

.ref-label {
  font-size: 0.9rem;
  color: var(--ink-600);
}

.ref {
  flex: 1 1 180px;
  min-height: 44px;
  padding: 0 0.75rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: 1rem;
}

.seg {
  display: inline-flex;
  padding: 3px;
  border-radius: 999px;
  background: var(--powder-100);

  button {
    min-height: 40px;
    padding: 0 0.9rem;
    border: 0;
    border-radius: 999px;
    background: none;
    font-weight: 600;
    color: var(--ink-600);

    &.on {
      background: var(--navy-800);
      color: #fff;
    }
  }
}

.history {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    padding: 0.45rem 0;
    border-top: 1px solid var(--line);
    font-size: 0.92rem;
  }

  .voided {
    opacity: 0.55;
    text-decoration: line-through;
  }
}

.history-actions {
  display: flex;
  gap: 0.75rem;

  .btn-text {
    min-height: 44px;
  }

  .danger {
    color: var(--danger-ink);
  }
}

.stages {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.stage {
  flex: 1 1 150px;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.6rem 0.8rem;
  border-top: 4px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--cream-100);

  span {
    font-size: 0.85rem;
    color: var(--ink-600);
  }

  strong {
    font-size: 1.25rem;
    font-variant-numeric: tabular-nums;
  }

  &--sent {
    border-top-color: var(--navy-600);
  }

  &--done {
    border-top-color: var(--success);
  }
}

.orphan {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.75rem;

  .tone {
    white-space: normal;
  }
}

.step {
  margin: 1rem 0 0.5rem;
  font-size: 0.95rem;
  color: var(--ink-900);
}

.invoices {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.invoice-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.75rem;

  > span:first-child {
    flex: 1 1 220px;
  }
}

.inline-link {
  margin-left: 0.5rem;
  font-weight: 600;
  color: var(--navy-700);
}

.big {
  margin: 0.25rem 0;
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--ink-900);
  font-variant-numeric: tabular-nums;

  small {
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--ink-600);
  }
}

.hbars {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0.5rem 0 0;
  padding: 0;
  list-style: none;

  li {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.6rem;
    font-variant-numeric: tabular-nums;
  }
}

.hbar {
  height: 12px;
  border-radius: 999px;
  background: var(--cream-100);
}

.hbar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--navy-600);

  &--rojo {
    background: var(--danger);
  }

  &--amarillo {
    background: var(--warning);
  }

  &--verde {
    background: var(--success);
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
