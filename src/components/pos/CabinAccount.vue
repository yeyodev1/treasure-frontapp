<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type { Cabin, CabinConsumption, CabinSummary } from '@/types'
import type { QueueEntry } from '@/composables/useConsumptionQueue'
import { formatMoney } from '@/utils/format'

/**
 * Cuenta de la cabina dentro del Bar (pedido del cliente, 31-oct-2026: "la
 * idea es mezclar bar y cuentas en una pantalla"). El bar ve todo lo que
 * lleva la cabina agrupado por bebida, con el total de hoy y el del viaje,
 * sin entrar a Cuentas (que muestra todas las cabinas). Cada línea tiene
 * − (retirar una unidad, con motivo) y + (sumar otra igual); Cortesía deja
 * la próxima bebida sin cobro. Lo que aún se está enviando aparece en su
 * línea como "enviando" para no tocar dos veces.
 */
const props = defineProps<{
  cabin: Cabin
  summary?: CabinSummary
  /** Envíos de esta tableta para la cabina que el servidor aún no confirma. */
  queued: QueueEntry[]
  /** Bebidas que se pueden volver a sumar con + (en la carta y disponibles). */
  canAdd: (productId: string) => boolean
  courtesyMode: string | null
  /** Consumo que se está corrigiendo (deshabilita las demás correcciones). */
  correcting: string
}>()

const emit = defineEmits<{
  add: [productId: string]
  retire: [item: CabinConsumption]
  courtesy: [item: CabinConsumption]
  toggleCourtesy: []
}>()

type Scope = 'viaje' | 'hoy'
const scope = shallowRef<Scope>('viaje')

/** Plegado en tableta vertical y celular; se recuerda en esta tableta. */
const COLLAPSE_KEY = 'treasure.bar.accountCollapsed'
const collapsed = shallowRef(localStorage.getItem(COLLAPSE_KEY) === '1')
watch(collapsed, (v) => localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'))

interface AccountLine {
  key: string
  productId: string
  name: string
  unitPrice: number
  courtesy: boolean
  agency: boolean
  qty: number
  pending: number
  total: number
  /** Consumos confirmados de la línea, el más nuevo primero. */
  items: CabinConsumption[]
  lastAt: number
}

const consumptions = computed(() => props.summary?.recent ?? [])

const lines = computed<AccountLine[]>(() => {
  const map = new Map<string, AccountLine>()
  const lineFor = (productId: string, name: string, unitPrice: number, courtesy: boolean, agency = false) => {
    const key = `${productId || name}|${courtesy ? (agency ? 'a' : 'c') : 'p'}|${unitPrice}`
    let line = map.get(key)
    if (!line) {
      line = { key, productId, name, unitPrice, courtesy, agency, qty: 0, pending: 0, total: 0, items: [], lastAt: 0 }
      map.set(key, line)
    }
    return line
  }
  for (const c of consumptions.value) {
    if (scope.value === 'hoy' && !c.today) continue
    if (c.qty <= 0) continue
    const unit = c.unitPrice ?? (c.qty ? c.total / c.qty : 0)
    const line = lineFor(c.productId ?? '', c.name, unit, c.courtesy, c.courtesyKind === 'agencia')
    line.qty += c.qty
    line.total += c.total
    line.items.push(c)
    line.lastAt = Math.max(line.lastAt, new Date(c.at).getTime())
  }
  // Lo que esta tableta aún envía es de hoy: suma a su línea como pendiente.
  for (const e of props.queued) {
    const line = lineFor(e.productId, e.productName, e.price, e.courtesy, e.courtesyKind === 'agencia')
    line.pending += 1
    line.lastAt = Math.max(line.lastAt, new Date(e.clientAt).getTime())
  }
  return [...map.values()].sort((a, b) => b.lastAt - a.lastAt)
})

const units = computed(() => lines.value.reduce((n, l) => n + l.qty + l.pending, 0))
const tripCount = computed(() => consumptions.value.reduce((n, c) => n + c.qty, 0) + props.queued.length)

const statusNote = computed(() => {
  if (props.summary?.accountStatus === 'aprobada') return 'Cuenta aprobada: las correcciones las hace Dirección de crucero.'
  if (props.summary?.accountStatus === 'cobrada') return 'Cuenta pagada: ya no se corrige aquí.'
  return ''
})

/** La unidad que retira −: la más reciente que se puede corregir. */
function retirable(line: AccountLine) {
  return line.items.find((c) => c.canUndo) ?? null
}

function bonifiable(line: AccountLine) {
  return line.courtesy ? null : (line.items.find((c) => c.canCourtesy) ?? null)
}

function minus(line: AccountLine) {
  const item = retirable(line)
  if (item) emit('retire', item)
}

function gift(line: AccountLine) {
  const item = bonifiable(line)
  if (item) emit('courtesy', item)
}

function names(c: Cabin) {
  return c.passengers.map((p) => p.name).join(', ')
}
</script>

<template>
  <section class="account" :aria-label="`Cuenta de la cabina ${cabin.number}`">
    <header class="account-head">
      <div class="account-who">
        <span class="account-label">Cargando a</span>
        <strong class="account-cabin">Cabina {{ cabin.number }}</strong>
        <span class="account-names">{{ names(cabin) }}</span>
      </div>
      <button
        type="button"
        class="courtesy-btn"
        :class="{ 'courtesy-btn--on': courtesyMode }"
        :aria-pressed="Boolean(courtesyMode)"
        @click="emit('toggleCourtesy')"
      >
        <i class="fa-solid" :class="courtesyMode ? 'fa-xmark' : 'fa-gift'" aria-hidden="true" />
        {{ courtesyMode ? 'Quitar cortesía' : 'Cortesía' }}
      </button>
    </header>

    <Transition name="fade">
      <p v-if="courtesyMode" class="courtesy-on">
        <i class="fa-solid fa-gift" aria-hidden="true" />
        La próxima bebida no se cobra · {{ courtesyMode }}
      </p>
    </Transition>

    <div class="account-bar">
      <div class="scope" role="tablist" aria-label="Consumos de">
        <button
          type="button"
          role="tab"
          class="scope-btn"
          :class="{ 'scope-btn--on': scope === 'viaje' }"
          :aria-selected="scope === 'viaje'"
          @click="scope = 'viaje'"
        >
          Todo el viaje
        </button>
        <button
          type="button"
          role="tab"
          class="scope-btn"
          :class="{ 'scope-btn--on': scope === 'hoy' }"
          :aria-selected="scope === 'hoy'"
          @click="scope = 'hoy'"
        >
          Hoy
        </button>
      </div>
      <button type="button" class="collapse-btn" :aria-expanded="!collapsed" @click="collapsed = !collapsed">
        {{ collapsed ? `Ver consumos (${tripCount})` : 'Ocultar' }}
        <i class="fa-solid fa-chevron-down" :class="{ 'collapse-icon--up': !collapsed }" aria-hidden="true" />
      </button>
    </div>

    <div class="account-body" :class="{ 'account-body--collapsed': collapsed }">
      <p v-if="statusNote" class="account-note">
        <i class="fa-solid fa-circle-info" aria-hidden="true" /> {{ statusNote }}
      </p>

      <p v-if="!summary && !queued.length" class="account-empty">Cargando consumos…</p>
      <p v-else-if="!lines.length" class="account-empty">
        {{ scope === 'hoy' ? 'Hoy todavía no hay consumos.' : 'Sin consumos todavía.' }} Toca una bebida para agregarla.
      </p>

      <TransitionGroup v-else name="list" tag="ul" class="lines">
        <li v-for="line in lines" :key="line.key" class="line" :class="{ 'line--courtesy': line.courtesy }">
          <span class="line-name">{{ line.name }}</span>
          <span class="line-meta">
              <template v-if="line.courtesy"><span class="tag" :class="{ 'tag--agency': line.agency }">{{ line.agency ? 'Cortesía agencia' : 'Cortesía casa' }}</span></template>
              <span v-else class="nowrap">{{ formatMoney(line.unitPrice) }} c/u</span>
              <span v-if="line.pending" class="line-pending">
                <i class="fa-solid fa-cloud-arrow-up" aria-hidden="true" /> {{ line.pending }} enviando
              </span>
          </span>
          <button
            v-if="bonifiable(line)"
            type="button"
            class="icon-btn icon-btn--gift"
            :disabled="Boolean(correcting)"
            :aria-label="`Marcar 1 ${line.name} como cortesía`"
            title="Marcar como cortesía"
            @click="gift(line)"
          >
            <i class="fa-solid fa-gift" aria-hidden="true" />
          </button>
          <div class="stepper">
            <button
              type="button"
              class="step"
              :disabled="!retirable(line) || Boolean(correcting)"
              :aria-label="`Retirar 1 ${line.name}`"
              @click="minus(line)"
            >
              <i
                class="fa-solid"
                :class="line.items.some((c) => c.orderId === correcting) ? 'fa-spinner fa-spin' : 'fa-minus'"
                aria-hidden="true"
              />
            </button>
            <span class="step-qty" aria-live="polite">{{ line.qty + line.pending }}</span>
            <button
              type="button"
              class="step"
              :disabled="line.courtesy || !line.productId || !canAdd(line.productId)"
              :aria-label="`Agregar 1 ${line.name}`"
              @click="emit('add', line.productId)"
            >
              <i class="fa-solid fa-plus" aria-hidden="true" />
            </button>
          </div>
          <span class="line-total">{{ line.courtesy ? '$0,00' : formatMoney(line.total + line.pending * line.unitPrice) }}</span>
        </li>
      </TransitionGroup>
    </div>

    <footer class="account-totals">
      <div>
        <span>Total de hoy</span>
        <strong :class="{ missing: !summary }">{{ summary ? formatMoney(summary.todayTotal) : '—' }}</strong>
      </div>
      <div class="account-trip">
        <span>Cuenta de la cabina<span v-if="units" class="trip-count"> · {{ tripCount }} consumos</span></span>
        <strong :class="{ missing: !summary }">{{ summary ? formatMoney(summary.tripTotal) : '—' }}</strong>
      </div>
    </footer>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.account {
  container: account / inline-size;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--surface);
  border: 1.5px solid var(--powder-200);
  border-radius: var(--radius);
  overflow: hidden;
}

.account-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem 1rem;
  padding: 0.7rem 0.9rem 0.6rem;
  background: var(--powder-100);
}

.account-who {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.1rem 0.6rem;
  min-width: 0;
}

.account-label {
  font-size: 0.8rem;
  color: var(--ink-600);
}

.account-cabin {
  font-family: var(--font-serif);
  font-size: 1.35rem;
  line-height: 1.1;
  color: var(--navy-800);
}

.account-names {
  min-width: 0;
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--ink-900);
  overflow-wrap: anywhere;
}

.courtesy-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 44px;
  padding: 0 0.9rem;
  border-radius: 12px;
  font-weight: 700;
  font-size: 0.86rem;
  border: 2px solid var(--navy-700);
  color: var(--navy-800);
  background: var(--surface);
  transition:
    background 0.15s ease,
    color 0.15s ease,
    transform 0.12s ease;

  &:active {
    transform: scale(0.97);
  }

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }
}

.courtesy-on {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  padding: 0.5rem 0.9rem;
  background: var(--navy-800);
  color: #fff;
  font-size: 0.88rem;
  font-weight: 600;
}

.account-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.9rem 0.4rem;
  border-bottom: 1px solid var(--line);
}

.scope {
  display: inline-flex;
  padding: 3px;
  border-radius: 999px;
  background: var(--cream-100);
}

.scope-btn {
  min-height: 40px;
  padding: 0 0.9rem;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--ink-600);
  transition:
    background 0.15s ease,
    color 0.15s ease;

  &--on {
    background: var(--surface);
    color: var(--navy-800);
    box-shadow: 0 1px 3px rgba(27, 43, 37, 0.12);
  }
}

.collapse-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 44px;
  padding: 0 0.6rem;
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--navy-700);

  i {
    transition: transform 0.2s ease;
  }

  .collapse-icon--up {
    transform: rotate(180deg);
  }

  // Con la cuenta al costado (escritorio y tableta horizontal) no se pliega.
  @include desktop {
    display: none;
  }
}

.account-body {
  min-height: 0;
  // Tableta vertical y celular: lista con su propio scroll para no tapar la carta.
  max-height: min(38vh, 320px);
  overflow-y: auto;
  overscroll-behavior: contain;
  transition: max-height 0.25s ease;

  &--collapsed {
    max-height: 0;
    overflow: hidden;
  }

  @include desktop {
    flex: 1 1 auto;
    max-height: none;

    &--collapsed {
      max-height: none;
      overflow-y: auto;
    }
  }
}

.account-note {
  display: flex;
  gap: 0.5rem;
  margin: 0.6rem 0.9rem 0;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--pill-info-bg);
  color: var(--pill-info-ink);
  font-size: 0.86rem;

  i {
    margin-top: 0.2rem;
  }
}

.account-empty {
  margin: 0;
  padding: 1rem 0.9rem;
  color: var(--ink-400);
  font-size: 0.9rem;
}

.lines {
  list-style: none;
  margin: 0;
  padding: 0.2rem 0.9rem 0.4rem;
}

// Cuenta ancha (tableta vertical): una fila por bebida. Angosta (al costado
// o en celular): el nombre arriba a lo ancho y los controles debajo.
.line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto 5.2rem;
  grid-template-areas:
    'name gift stepper total'
    'meta gift stepper total';
  align-items: center;
  column-gap: 0.4rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--line);

  &:last-child {
    border-bottom: none;
  }

  &--courtesy .line-name {
    color: var(--ink-600);
  }
}

@container account (max-width: 520px) {
  .line {
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    grid-template-areas:
      'name name name name'
      'meta gift stepper total';
    row-gap: 0.25rem;
  }

  .line-total {
    min-width: 4.6rem;
    text-align: right;
  }

  .trip-count {
    display: none;
  }
}

.nowrap {
  white-space: nowrap;
}

.line-name {
  grid-area: name;
  min-width: 0;
  font-weight: 600;
  line-height: 1.25;
  overflow-wrap: break-word;
}

.line-meta {
  grid-area: meta;
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem 0.5rem;
  min-width: 0;
  font-size: 0.8rem;
  color: var(--ink-400);
  font-variant-numeric: tabular-nums;
}

.tag {
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: var(--pill-ok-bg, var(--powder-100));
  color: var(--pill-ok-ink, var(--navy-800));
  font-weight: 700;
  font-size: 0.72rem;
}

.tag--agency {
  background: var(--pill-warn-bg);
  color: var(--pill-warn-ink);
}

.line-pending {
  color: var(--warning);
  font-weight: 600;
}

.icon-btn {
  grid-area: gift;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: var(--navy-700);
  transition:
    background 0.15s ease,
    opacity 0.15s ease,
    transform 0.12s ease;

  &:hover:not(:disabled) {
    background: var(--powder-100);
  }

  &:active:not(:disabled) {
    transform: scale(0.94);
  }

  &:disabled {
    opacity: 0.35;
  }
}

.stepper {
  grid-area: stepper;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.step {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  border: 1.5px solid var(--cream-200);
  background: var(--cream-100);
  color: var(--ink-900);
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease,
    transform 0.12s ease;

  &:hover:not(:disabled) {
    border-color: var(--navy-600);
  }

  &:active:not(:disabled) {
    transform: scale(0.94);
  }

  &:disabled {
    opacity: 0.35;
  }
}

.step-qty {
  min-width: 1.8rem;
  text-align: center;
  font-weight: 700;
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
}

.line-total {
  grid-area: total;
  justify-self: end;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ink-900);
}

.account-totals {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem 0.9rem;
  border-top: 1px solid var(--powder-200);
  background: var(--powder-100);

  div {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  span {
    white-space: nowrap;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-600);
  }

  strong {
    font-family: var(--font-serif);
    font-size: 1.45rem;
    line-height: 1.1;
    color: var(--navy-800);
    font-variant-numeric: tabular-nums;
  }

  .missing {
    color: var(--ink-400);
  }
}

.account-trip {
  align-items: flex-end;
  text-align: right;
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
