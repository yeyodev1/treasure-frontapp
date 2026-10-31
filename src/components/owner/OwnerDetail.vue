<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import BaseModal from '@/components/ui/BaseModal.vue'
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/utils/format'
import type { OwnerPanel } from '@/types'

export type DetailKind = 'consumo' | 'cortesias' | 'cobrado' | 'porCobrar' | 'costo' | 'margen' | 'compras'

/**
 * Detalle de una cifra del resumen: sus movimientos y un total que suma
 * exactamente lo mostrado (checklist 29-oct, 09).
 */
const props = defineProps<{ kind: DetailKind; data: OwnerPanel }>()
const emit = defineEmits<{ close: [] }>()
const router = useRouter()

const METHOD_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  online: 'Pago en línea',
}

const INVOICE_LABEL: Record<string, string> = {
  pendiente: 'Factura pendiente',
  emitiendo: 'Emitiendo factura',
  emitida: 'Factura emitida',
  error: 'Factura pendiente',
  no_aplica: 'Sin factura',
}

const TITLE: Record<DetailKind, string> = {
  consumo: 'Consumos del bar',
  cortesias: 'Cortesías',
  cobrado: 'Cobrado',
  porCobrar: 'Por cobrar',
  costo: 'Costo de lo servido',
  margen: 'Margen del bar',
  compras: 'Compras recibidas',
}

interface Row {
  key: string
  title: string
  meta: string
  amount: number | null
  tag?: string
  sub?: string[]
}

const rows = computed<Row[]>(() => {
  const d = props.data.details
  switch (props.kind) {
    case 'consumo':
    case 'cortesias':
      return [...(props.kind === 'consumo' ? d.consumption : d.courtesy)].reverse().map((l, i) => ({
        key: `${i}`,
        title: `${l.qty} × ${l.item}`,
        meta: `${formatDateTime(l.at)} · ${l.cruise} · cabina ${l.cabin}${l.by ? ` · ${l.by}` : ''}`,
        amount: l.amount,
      }))
    case 'cobrado':
      return [...d.payments].reverse().map((p, i) => ({
        key: `${i}`,
        title: `${p.cruise} · cabina ${p.cabin}`,
        meta: `${formatDateTime(p.at)} · ${METHOD_LABEL[p.method] ?? p.method} · ${INVOICE_LABEL[p.invoiceStatus] ?? p.invoiceStatus}`,
        amount: p.total,
      }))
    case 'porCobrar':
      return d.pending.map((p) => ({
        key: `${p.cruiseId}-${p.cabin}`,
        title: `${p.cruise} · cabina ${p.cabin}`,
        meta: `${p.orders} consumo(s) desde ${formatDate(p.oldest)}`,
        amount: p.amount,
        tag: p.previous ? 'Incluye saldo anterior' : undefined,
      }))
    case 'costo':
      return d.cost.map((c, i) => ({
        key: `${i}`,
        title: c.name,
        meta: `${formatNumber(c.qty)} servido(s)`,
        amount: c.cost,
        tag: c.cost === null ? 'Falta el costo' : undefined,
      }))
    case 'compras':
      return d.purchases.map((p) => ({
        key: p.code,
        title: `${p.code} · ${p.supplier}`,
        meta: `Doc. ${p.document} · ${formatDate(p.at)} · ${p.partial ? `recibida parcial (factura ${formatMoney(p.invoiceTotal)})` : 'recibida'}`,
        amount: p.amount,
        sub: p.lines.map(
          (l) => `${formatNumber(l.containers)} ${l.containers === 1 ? l.label : `${l.label}s`} · ${l.name} · ${formatMoney(l.amount)}`,
        ),
      }))
    case 'margen':
      return [
        { key: 'c', title: 'Consumos del bar', meta: 'Cargado a las cabinas', amount: props.data.netConsumption },
        {
          key: 'k',
          title: '− Costo de lo servido',
          meta: 'Insumos al costo histórico, incluidas cortesías',
          amount: props.data.consumedCost === null ? null : -props.data.consumedCost,
          tag: props.data.consumedCost === null ? 'No disponible: faltan costos' : undefined,
        },
      ]
  }
  return []
})

const total = computed<number | null>(() => {
  const d = props.data
  switch (props.kind) {
    case 'consumo':
      return d.netConsumption
    case 'cortesias':
      return d.courtesy
    case 'cobrado':
      return d.collected
    case 'porCobrar':
      return d.pendingCollection
    case 'costo':
      return d.consumedCost
    case 'margen':
      return d.margin
    case 'compras':
      return d.purchases
  }
  return null
})

const note = computed(() => {
  if (props.kind === 'costo' && props.data.consumedCost === null && props.data.missingCostCount) {
    return 'Un costo desconocido no vale cero: registra el costo de estos productos en sus compras para ver el total.'
  }
  if (props.kind === 'margen') return 'No es utilidad neta. No incluye mermas ni ajustes de inventario.'
  if (props.kind === 'porCobrar' && props.data.pendingFromBefore > 0) {
    return `${formatMoney(props.data.pendingFromPeriod)} de este periodo y ${formatMoney(props.data.pendingFromBefore)} de consumos anteriores aún sin pagar al corte.`
  }
  if (props.kind === 'compras') return 'Importe de lo recibido (envases × costo de la factura). Una recepción parcial cuenta solo lo que llegó.'
  if ((props.kind === 'consumo' || props.kind === 'cortesias') && props.data.details.truncated) {
    return 'Se muestran los consumos más recientes; el total incluye todos.'
  }
  return ''
})

function goAccounts() {
  emit('close')
  router.push('/cuentas')
}
</script>

<template>
  <BaseModal :title="TITLE[kind]" @close="emit('close')">
    <div class="detail-sheet">
      <p v-if="note" class="note">{{ note }}</p>

      <ul v-if="rows.length" class="rows">
        <li v-for="row in rows" :key="row.key" class="row">
          <div class="row-main">
            <span class="row-title">{{ row.title }}</span>
            <span class="row-meta">{{ row.meta }}</span>
            <span v-if="row.tag" class="row-tag">{{ row.tag }}</span>
            <ul v-if="row.sub?.length" class="row-sub">
              <li v-for="(s, i) in row.sub" :key="i">{{ s }}</li>
            </ul>
          </div>
          <span class="row-amount">{{ row.amount === null ? 'No disponible' : formatMoney(row.amount) }}</span>
        </li>
      </ul>
      <p v-else class="empty">Sin movimientos en este alcance.</p>

      <footer class="total">
        <span>Total</span>
        <strong>{{ total === null ? 'No disponible: faltan costos' : formatMoney(total) }}</strong>
      </footer>

      <button v-if="kind === 'porCobrar' && rows.length" type="button" class="btn btn-primary btn-go" @click="goAccounts">
        <i class="fa-solid fa-file-invoice-dollar" aria-hidden="true" /> Ir a Cuentas
      </button>
    </div>
  </BaseModal>
</template>

<style lang="scss">
// Detalle con más ancho en tableta; BaseModal no se toca.
@media (min-width: 640px) {
  .overlay .modal:has(> .modal-body > .detail-sheet) {
    max-width: 640px;
  }
}
</style>

<style scoped lang="scss">
.detail-sheet {
  --line: #dbe4eb;
  --muted: #55636d;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  font-size: 1rem;
}

.note {
  margin: 0;
  padding: 0.7rem 0.9rem;
  border-radius: var(--radius-sm);
  background: var(--powder-100);
  font-size: 0.9375rem;
  color: var(--navy-900);
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  padding: 0.7rem 0;
  border-bottom: 1px solid var(--line);
}

.row-main {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.row-title {
  font-weight: 500;
}

.row-meta {
  font-size: 0.875rem;
  color: var(--muted);
}

.row-tag {
  align-self: flex-start;
  margin-top: 0.2rem;
  padding: 0.1rem 0.55rem;
  border-radius: 999px;
  background: #f7ecdc;
  font-size: 0.8125rem;
  font-weight: 500;
  color: #6f4a16;
}

.row-sub {
  margin: 0.3rem 0 0;
  padding-left: 1rem;
  font-size: 0.875rem;
  color: var(--ink-600);
}

.row-amount {
  font-weight: 500;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.empty {
  margin: 0;
  padding: 0.9rem 1rem;
  border: 1px dashed #c3d1dc;
  border-radius: var(--radius-sm);
  color: var(--muted);
}

// El total queda a la vista mientras se recorre la lista.
.total {
  position: sticky;
  bottom: -1.25rem;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.75rem;
  margin: 0 -1.25rem;
  padding: 0.8rem 1.25rem 1.25rem;
  background: var(--surface);
  border-top: 1px solid #c3d1dc;
  font-weight: 500;

  strong {
    font-size: 1.375rem;
    font-weight: 600;
    color: var(--navy-800);
    font-variant-numeric: tabular-nums;
  }
}
</style>
