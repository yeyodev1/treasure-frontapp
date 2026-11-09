<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useUserStore } from '@/stores/user'
import type { Cabin, CabinConsumption, CabinSummary } from '@/types'
import type { QueueEntry } from '@/composables/useConsumptionQueue'
import { dayKeyOf, formatDayHeading, formatHour, formatMoney, formatTime, todayKey } from '@/utils/format'

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

/**
 * Se ve lo de hoy; todo el viaje solo si el pasajero lo pide (pedido del
 * cliente, 3-nov-2026). Al cambiar de cabina vuelve a Hoy.
 */
type Scope = 'viaje' | 'hoy'
const scope = shallowRef<Scope>('hoy')
watch(
  () => props.cabin.number,
  () => (scope.value = 'hoy'),
)

/** Dirección y Gerencia saltan a la cuenta de la cabina para aprobar y cobrar. */
const userStore = useUserStore()

/**
 * Guía 4 perfiles (4-nov-2026): resumen compacto (cabina, último registro y
 * saldo) en cualquier tamaño; los consumos se abren al tocar. Se recuerda en
 * esta tableta.
 */
const COLLAPSE_KEY = 'treasure.bar.accountCollapsed'
const collapsed = shallowRef(localStorage.getItem(COLLAPSE_KEY) !== '0')
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
  /** Día de registro (Galápagos): la misma bebida en otro día es otra línea (7-nov-2026). */
  day: string
  fromCruise: string
}

const consumptions = computed(() => props.summary?.recent ?? [])

const lines = computed<AccountLine[]>(() => {
  const map = new Map<string, AccountLine>()
  const today = todayKey()
  const lineFor = (
    productId: string,
    name: string,
    unitPrice: number,
    courtesy: boolean,
    agency = false,
    day = today,
    fromCruise = '',
  ) => {
    const key = `${day}|${fromCruise}|${productId}|${name}|${courtesy ? (agency ? 'a' : 'c') : 'p'}|${unitPrice}`
    let line = map.get(key)
    if (!line) {
      line = { key, productId, name, unitPrice, courtesy, agency, qty: 0, pending: 0, total: 0, items: [], lastAt: 0, day, fromCruise }
      map.set(key, line)
    }
    return line
  }
  for (const c of consumptions.value) {
    if (scope.value === 'hoy' && !c.today) continue
    if (c.qty <= 0) continue
    const unit = c.unitPrice ?? (c.qty ? c.total / c.qty : 0)
    const line = lineFor(c.productId ?? '', c.name, unit, c.courtesy, c.courtesyKind === 'agencia', dayKeyOf(c.at), c.fromCruise ?? '')
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

/** Líneas con un encabezado por día de registro, el más reciente primero. */
const rows = computed(() => {
  const sorted = [...lines.value].sort((a, b) => b.day.localeCompare(a.day) || b.lastAt - a.lastAt)
  return sorted.flatMap((line, i) =>
    i && sorted[i - 1]!.day === line.day ? [line] : [{ key: `d-${line.day}`, day: line.day, heading: true as const }, line],
  )
})

/** Consumos de días anteriores: en "Hoy" no se ven y se volvían a cargar (7-nov-2026). */
const earlier = computed(() => consumptions.value.filter((c) => !c.today).reduce((n, c) => n + c.qty, 0))

/** "Ayer · 20:12:53" o la fecha: solo la hora hacía creer que era de hoy. */
function whenOf(at: string) {
  const day = dayKeyOf(at)
  return day === todayKey() ? formatTime(at) : `${dayLabel(day)} · ${formatHour(at)}`
}

function dayLabel(day: string) {
  const heading = formatDayHeading(day)
  if (day === todayKey()) return `Hoy · ${heading}`
  if (day === dayKeyOf(new Date(Date.now() - 86_400_000))) return `Ayer · ${heading}`
  return heading
}

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
          :class="{ 'scope-btn--on': scope === 'hoy' }"
          :aria-selected="scope === 'hoy'"
          @click="scope = 'hoy'"
        >
          Hoy
        </button>
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
      </div>
      <button type="button" class="collapse-btn" :aria-expanded="!collapsed" @click="collapsed = !collapsed">
        {{ collapsed ? `Ver consumos (${tripCount})` : 'Ocultar' }}
        <i class="fa-solid fa-chevron-down" :class="{ 'collapse-icon--up': !collapsed }" aria-hidden="true" />
      </button>
    </div>

    <p v-if="collapsed" class="account-last">
      <template v-if="summary?.last">
        Último registro: <strong>{{ summary.last.qty }} × {{ summary.last.name }}</strong> · {{ whenOf(summary.last.at) }}
      </template>
      <template v-else-if="summary">Sin consumos todavía. Toca una bebida para agregarla.</template>
    </p>

    <div class="account-body" :class="{ 'account-body--collapsed': collapsed }">
      <p v-if="statusNote" class="account-note">
        <i class="fa-solid fa-circle-info" aria-hidden="true" /> {{ statusNote }}
      </p>

      <p v-if="!summary && !queued.length" class="account-empty">Cargando consumos…</p>
      <p v-else-if="!lines.length && scope === 'hoy' && earlier" class="account-empty">
        Hoy todavía no hay consumos, pero la cabina tiene {{ earlier }} de días anteriores: revísalos antes de volver a cargar algo.
        <button type="button" class="see-trip" @click="scope = 'viaje'">Ver todo el viaje</button>
      </p>
      <p v-else-if="!lines.length" class="account-empty">
        {{ scope === 'hoy' ? 'Hoy todavía no hay consumos.' : 'Sin consumos todavía.' }} Toca una bebida para agregarla.
      </p>

      <TransitionGroup v-else name="list" tag="ul" class="lines">
        <template v-for="line in rows" :key="line.key">
        <li v-if="'heading' in line" class="day">{{ dayLabel(line.day) }}</li>
        <li v-else class="line" :class="{ 'line--courtesy': line.courtesy }">
          <span class="line-name">{{ line.name }}</span>
          <span class="line-meta">
              <template v-if="line.courtesy"><span class="tag" :class="{ 'tag--agency': line.agency }">{{ line.agency ? 'Cortesía agencia' : 'Cortesía casa' }}</span></template>
              <span v-else class="nowrap">{{ formatMoney(line.unitPrice) }} c/u</span>
              <span v-if="line.lastAt" class="nowrap">{{ formatHour(new Date(line.lastAt)) }}</span>
              <span v-if="line.fromCruise" class="tag tag--origin">Crucero {{ line.fromCruise }}</span>
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
        </template>
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
      <RouterLink
        v-if="userStore.isDirector"
        :to="{ path: '/cuentas', query: { cabina: String(cabin.number) } }"
        class="go-account"
      >
        <i class="fa-solid fa-file-invoice-dollar" aria-hidden="true" /> Ir a cuenta
        <i class="fa-solid fa-arrow-right" aria-hidden="true" />
      </RouterLink>
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
  color: var(--navy-ink, var(--navy-800));
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
  color: var(--navy-ink, var(--navy-800));
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
    color: var(--navy-ink, var(--navy-800));
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
  color: var(--navy-ink, var(--navy-700));

  i {
    transition: transform 0.2s ease;
  }

  .collapse-icon--up {
    transform: rotate(180deg);
  }

}

.account-last {
  margin: 0;
  padding: 0.5rem 0.9rem;
  font-size: 0.95rem;
  color: var(--ink-600);
  border-top: 1px solid var(--powder-200);
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
      flex: 0 0 auto;
      max-height: 0;
      overflow: hidden;
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

.see-trip {
  display: block;
  min-height: 44px;
  margin-top: 0.5rem;
  padding: 0 1rem;
  border-radius: var(--radius-sm);
  background: var(--navy-800);
  color: #fff;
  font-weight: 600;
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

.tag--origin {
  background: var(--cream-100);
  color: var(--ink-600);
}

.day {
  padding: 0.6rem 0 0.2rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--navy-ink, var(--navy-700));
  border-bottom: 1px solid var(--line);
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
  color: var(--navy-ink, var(--navy-700));
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
  // Al faltar ancho los importes bajan de línea en vez de montarse (guía 4 perfiles).
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
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
    color: var(--navy-ink, var(--navy-800));
    font-variant-numeric: tabular-nums;
  }

  .missing {
    color: var(--ink-400);
  }
}

.account-trip {
  align-items: flex-end;
  text-align: right;
  margin-left: auto;
}

// "Ir a cuenta": Dirección pasa de la cabina a aprobar y cobrar.
.go-account {
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 48px;
  padding: 0 1rem;
  border-radius: var(--radius-sm);
  background: var(--navy-800);
  color: #fff;
  font-weight: 600;
  font-size: 0.92rem;
  white-space: nowrap;
  text-decoration: none;
  transition:
    background 0.15s ease,
    transform 0.12s ease;

  &:hover {
    background: var(--navy-700);
  }

  &:active {
    transform: scale(0.97);
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

// Columna angosta (tableta horizontal): importes más chicos y uno debajo del otro.
@container account (max-width: 340px) {
  .account-totals strong {
    font-size: 1.15rem;
  }

  .account-trip {
    align-items: flex-start;
    text-align: left;
    margin-left: 0;
  }
}
</style>
