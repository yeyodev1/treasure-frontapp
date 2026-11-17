<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseDatePicker from '@/components/ui/BaseDatePicker.vue'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import {
  apiCreateShipStop,
  apiCruiseCalendar,
  apiDeleteShipStop,
  apiShipStops,
  type CruiseCalendarRow,
  type ShipStopRow,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { TIMEZONE, todayKey } from '@/utils/format'

/**
 * Registro de cruceros (pedido de Gerencia, 16-nov-2026): mes a mes, cada
 * salida con sus fechas, cuántos pasajeros y de qué países. Desde el
 * 17-nov-2026 también las paras (no sale el crucero) y el dique (arreglo del
 * barco), con un resumen del año arriba.
 */
const toast = useToastStore()
const confirm = useConfirmStore()
const rows = shallowRef<CruiseCalendarRow[]>([])
const stops = shallowRef<ShipStopRow[]>([])
const loading = shallowRef(true)
const month = shallowRef(todayKey().slice(0, 7))
const year = shallowRef(Number(todayKey().slice(0, 4)))

const STOP = {
  para: { label: 'Para', icon: 'fa-circle-pause' },
  dique: { label: 'Dique', icon: 'fa-screwdriver-wrench' },
} as const

const STATUS: Record<CruiseCalendarRow['status'], string> = {
  planificado: 'Programado',
  abordo: 'En curso',
  cerrado: 'Finalizado',
}

onMounted(async () => {
  try {
    ;[rows.value, stops.value] = await Promise.all([apiCruiseCalendar(), apiShipStops()])
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
})

/** AAAA-MM-DD en Galápagos (las salidas se guardan a mediodía UTC). */
const dayKey = (d: string) => new Date(d).toLocaleDateString('en-CA', { timeZone: TIMEZONE })

function shift(delta: number) {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1))
  month.value = d.toISOString().slice(0, 7)
}

const monthLabel = computed(() => {
  const label = new Date(`${month.value}-15T12:00:00Z`).toLocaleDateString('es-EC', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return label.charAt(0).toUpperCase() + label.slice(1)
})

/** Salidas que tocan el mes (empiezan, terminan o lo cruzan). */
const inMonth = computed(() =>
  rows.value.filter((c) => {
    const start = dayKey(c.startDate).slice(0, 7)
    const end = dayKey(c.endDate ?? c.startDate).slice(0, 7)
    return start <= month.value && end >= month.value
  }),
)

const totals = computed(() => {
  const countries = new Map<string, number>()
  let passengers = 0
  for (const c of inMonth.value) {
    passengers += c.passengers
    for (const k of c.countries) countries.set(k.country, (countries.get(k.country) ?? 0) + k.count)
  }
  return {
    passengers,
    countries: [...countries].map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count),
  }
})

/** Días entre dos AAAA-MM-DD, ambos incluidos. */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1

/** Paras y dique que tocan el mes. */
const stopsInMonth = computed(() =>
  stops.value.filter((s) => dayKey(s.from).slice(0, 7) <= month.value && dayKey(s.to).slice(0, 7) >= month.value),
)

/** Resumen del año: cruceros por fecha de salida; paras y dique solo con sus días dentro del año. */
const yearSummary = computed(() => {
  const y = String(year.value)
  const cruises = rows.value.filter((c) => dayKey(c.startDate).startsWith(y))
  const legs = new Map<string, number>([['A', 0], ['B', 0], ['C', 0]])
  const countries = new Map<string, number>()
  let passengers = 0
  for (const c of cruises) {
    passengers += c.passengers
    // El código empieza con la letra del tramo: «C-003» es tipo C.
    const leg = (c.code.charAt(0) || c.leg || '?').toUpperCase()
    legs.set(leg, (legs.get(leg) ?? 0) + c.passengers)
    for (const k of c.countries) countries.set(k.country, (countries.get(k.country) ?? 0) + k.count)
  }
  const down = { para: { count: 0, days: 0 }, dique: { count: 0, days: 0 } }
  for (const s of stops.value) {
    const from = dayKey(s.from) > `${y}-01-01` ? dayKey(s.from) : `${y}-01-01`
    const to = dayKey(s.to) < `${y}-12-31` ? dayKey(s.to) : `${y}-12-31`
    if (from > to) continue
    down[s.kind].count += 1
    down[s.kind].days += daysBetween(from, to)
  }
  return {
    cruises: cruises.length,
    passengers,
    legs: [...legs].sort(([a], [b]) => a.localeCompare(b)),
    countries: [...countries].sort((a, b) => b[1] - a[1]),
    down,
  }
})

function stopRange(s: ShipStopRow) {
  const days = daysBetween(dayKey(s.from), dayKey(s.to))
  const start = fmt(s.from, { day: 'numeric', month: 'short' })
  const end = fmt(s.to, { day: 'numeric', month: 'short', year: 'numeric' })
  return `${days === 1 ? end : `${start} – ${end}`} · ${days} ${days === 1 ? 'día' : 'días'}`
}

// Formulario «Marcar para o dique»
const formOpen = shallowRef(false)
const kind = shallowRef<ShipStopRow['kind'] | ''>('')
const from = shallowRef('')
const to = shallowRef('')
const note = shallowRef('')
const tried = shallowRef(false)
const saving = shallowRef(false)

// Una para suele ser de un solo día: «hasta» toma el mismo día si queda vacío o antes.
watch(from, (v) => {
  if (v && (!to.value || to.value < v)) to.value = v
})

const formError = computed(() => {
  if (!kind.value) return 'Elige si es para o dique'
  if (!from.value || !to.value) return 'Elige los días desde y hasta'
  if (to.value < from.value) return '«Hasta» no puede ser antes de «Desde»'
  if (daysBetween(from.value, to.value) > 367) return 'Máximo un año por registro'
  return ''
})

function openForm() {
  kind.value = ''
  from.value = ''
  to.value = ''
  note.value = ''
  tried.value = false
  formOpen.value = true
}

async function save() {
  tried.value = true
  if (formError.value || !kind.value || saving.value) return
  saving.value = true
  try {
    await apiCreateShipStop({ kind: kind.value, from: from.value, to: to.value, note: note.value.trim() })
    stops.value = await apiShipStops()
    month.value = from.value.slice(0, 7)
    year.value = Number(from.value.slice(0, 4))
    formOpen.value = false
    toast.success('Listo, quedó marcado en el registro')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}

async function remove(s: ShipStopRow) {
  const ok = await confirm.ask({
    title: s.kind === 'para' ? '¿Quitar esta para?' : '¿Quitar este dique?',
    message: `${stopRange(s)}. Deja de contar en el resumen del año.`,
    confirmLabel: 'Quitar',
    danger: true,
    icon: 'fa-trash',
  })
  if (!ok) return
  try {
    await apiDeleteShipStop(s.id)
    stops.value = stops.value.filter((x) => x.id !== s.id)
    toast.success('Quitado del registro')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(d).toLocaleDateString('es-EC', { ...opts, timeZone: TIMEZONE })
function range(c: CruiseCalendarRow) {
  const start = fmt(c.startDate, { day: 'numeric', month: 'short' })
  return c.endDate ? `${start} – ${fmt(c.endDate, { day: 'numeric', month: 'short' })}` : start
}
</script>

<template>
  <section class="calendar panel" aria-labelledby="calendar-title">
    <header class="c-head">
      <div>
        <h2 id="calendar-title" class="panel-title">
          <i class="fa-solid fa-calendar-days" aria-hidden="true" /> Registro de cruceros
        </h2>
        <p class="c-rule">Cada salida con sus fechas, cuántos pasajeros y de qué país. También las paras y el dique.</p>
      </div>
      <button type="button" class="btn btn-secondary" @click="openForm">
        <i class="fa-solid fa-circle-pause" aria-hidden="true" /> Marcar para o dique
      </button>
    </header>

    <div v-if="loading" class="c-list">
      <SkeletonBlock height="90px" />
      <SkeletonBlock height="90px" />
    </div>

    <template v-else>
      <section class="c-block" aria-labelledby="year-title">
        <div class="c-subhead">
          <h3 id="year-title">Resumen del año</h3>
          <div class="c-nav" role="group" aria-label="Año">
            <button type="button" class="icon-btn" aria-label="Año anterior" @click="year -= 1">
              <i class="fa-solid fa-chevron-left" aria-hidden="true" />
            </button>
            <strong aria-live="polite">{{ year }}</strong>
            <button type="button" class="icon-btn" aria-label="Año siguiente" @click="year += 1">
              <i class="fa-solid fa-chevron-right" aria-hidden="true" />
            </button>
          </div>
        </div>
        <dl class="c-figures">
          <div>
            <dt>Cruceros</dt>
            <dd>{{ yearSummary.cruises }}</dd>
          </div>
          <div>
            <dt>Pasajeros</dt>
            <dd>{{ yearSummary.passengers }}</dd>
          </div>
          <div>
            <dt>Paras</dt>
            <dd>
              {{ yearSummary.down.para.count }}
              <small>{{ yearSummary.down.para.days }} {{ yearSummary.down.para.days === 1 ? 'día' : 'días' }}</small>
            </dd>
          </div>
          <div>
            <dt>Dique</dt>
            <dd>
              {{ yearSummary.down.dique.count }}
              <small>{{ yearSummary.down.dique.days }} {{ yearSummary.down.dique.days === 1 ? 'día' : 'días' }}</small>
            </dd>
          </div>
        </dl>
        <p class="c-label">Pasajeros por tipo de crucero</p>
        <ul class="c-countries" aria-label="Pasajeros por tipo de crucero">
          <li v-for="[leg, count] in yearSummary.legs" :key="leg">
            Tipo {{ leg }} <strong>{{ count }}</strong>
          </li>
        </ul>
        <p class="c-label">Pasajeros por país</p>
        <ul v-if="yearSummary.countries.length" class="c-countries" aria-label="Pasajeros por país">
          <li v-for="[country, count] in yearSummary.countries" :key="country">
            {{ country }} <strong>{{ count }}</strong>
          </li>
        </ul>
        <p v-else class="c-empty">Sin pasajeros en {{ year }}.</p>
      </section>

      <div class="c-subhead">
        <h3>Mes a mes</h3>
        <div class="c-nav" role="group" aria-label="Mes">
          <button type="button" class="icon-btn" aria-label="Mes anterior" @click="shift(-1)">
            <i class="fa-solid fa-chevron-left" aria-hidden="true" />
          </button>
          <strong aria-live="polite">{{ monthLabel }}</strong>
          <button type="button" class="icon-btn" aria-label="Mes siguiente" @click="shift(1)">
            <i class="fa-solid fa-chevron-right" aria-hidden="true" />
          </button>
        </div>
      </div>

      <dl class="c-figures">
        <div>
          <dt>Cruceros</dt>
          <dd>{{ inMonth.length }}</dd>
        </div>
        <div>
          <dt>Pasajeros</dt>
          <dd>{{ totals.passengers }}</dd>
        </div>
        <div>
          <dt>Países</dt>
          <dd>{{ totals.countries.filter((k) => k.country !== 'Sin país').length }}</dd>
        </div>
      </dl>

      <ul v-if="stopsInMonth.length" class="c-list c-stops" aria-label="Paras y dique del mes">
        <li v-for="st in stopsInMonth" :key="st.id" class="c-stop" :class="`c-stop--${st.kind}`">
          <i class="fa-solid c-stop-icon" :class="STOP[st.kind].icon" aria-hidden="true" />
          <div class="c-body">
            <p class="c-title"><strong>{{ STOP[st.kind].label }}</strong></p>
            <p class="c-meta">{{ stopRange(st) }}<template v-if="st.note"> · {{ st.note }}</template></p>
          </div>
          <button type="button" class="btn-text c-stop-del" @click="remove(st)">
            <i class="fa-solid fa-trash" aria-hidden="true" /> Quitar
          </button>
        </li>
      </ul>

      <p v-if="!inMonth.length" class="c-empty">No hay cruceros en {{ monthLabel.toLowerCase() }}.</p>

      <ol v-else class="c-list">
        <li v-for="c in inMonth" :key="c.id" class="c-row">
          <div class="c-date">
            <strong>{{ fmt(c.startDate, { day: 'numeric' }) }}</strong>
            <span>{{ fmt(c.startDate, { month: 'short' }) }}</span>
          </div>
          <div class="c-body">
            <p class="c-title">
              <strong>{{ c.code ? `Crucero ${c.code}` : c.name }}</strong>
              <span class="c-status" :class="`c-status--${c.status}`">{{ STATUS[c.status] }}</span>
            </p>
            <p class="c-meta">
              {{ range(c) }}<template v-if="c.route"> · {{ c.route }}</template>
            </p>
            <ul v-if="c.countries.length" class="c-countries" :aria-label="`Países del crucero ${c.code}`">
              <li v-for="k in c.countries" :key="k.country">
                {{ k.country }} <strong>{{ k.count }}</strong>
              </li>
            </ul>
          </div>
          <p class="c-pax">
            <strong>{{ c.passengers }}</strong>
            <span>{{ c.passengers === 1 ? 'pasajero' : 'pasajeros' }}</span>
          </p>
        </li>
      </ol>
    </template>

    <BaseModal
      v-if="formOpen"
      title="Marcar para o dique"
      subtitle="Días en que el barco no sale. Se suma al resumen del año."
      @close="formOpen = false"
    >
      <form id="ship-stop-form" class="stop-form" novalidate @submit.prevent="save">
        <fieldset class="stop-kind">
          <legend>¿Qué pasó?</legend>
          <label class="stop-kind-opt">
            <input v-model="kind" type="radio" name="ship-stop-kind" value="para" />
            <i class="fa-solid fa-circle-pause" aria-hidden="true" />
            <strong>Para</strong>
            <span>No sale el crucero</span>
          </label>
          <label class="stop-kind-opt">
            <input v-model="kind" type="radio" name="ship-stop-kind" value="dique" />
            <i class="fa-solid fa-screwdriver-wrench" aria-hidden="true" />
            <strong>Dique</strong>
            <span>Arreglo del barco</span>
          </label>
        </fieldset>
        <div class="stop-dates">
          <div class="field">
            <label>Desde</label>
            <BaseDatePicker v-model="from" placeholder="Elige el día" />
          </div>
          <div class="field">
            <label>Hasta</label>
            <BaseDatePicker v-model="to" placeholder="Elige el día" />
          </div>
        </div>
        <p v-if="from && to && to >= from" class="field-hint">
          Son {{ daysBetween(from, to) }} {{ daysBetween(from, to) === 1 ? 'día' : 'días' }}.
        </p>
        <div class="field">
          <label for="ship-stop-note">Nota (opcional)</label>
          <input id="ship-stop-note" v-model="note" type="text" maxlength="200" placeholder="Ej.: mal tiempo, mantenimiento" />
        </div>
        <p v-if="tried && formError" class="campo-error" role="alert">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true" /> {{ formError }}
        </p>
      </form>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="formOpen = false">Cancelar</button>
        <button type="submit" form="ship-stop-form" class="btn btn-primary" :disabled="saving">
          <i class="fa-solid" :class="saving ? 'fa-spinner fa-spin' : 'fa-check'" aria-hidden="true" />
          {{ saving ? 'Guardando…' : 'Guardar' }}
        </button>
      </template>
    </BaseModal>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.calendar {
  margin-top: 1.5rem;
}

.c-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  margin-bottom: 1rem;
}

.c-rule {
  margin: 0.25rem 0 0;
  color: var(--ink-600);
  font-size: 0.95rem;
}

.c-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;

  strong {
    min-width: 9.5rem;
    text-align: center;
    color: var(--navy-900);
  }
}

.icon-btn {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--navy-800);
}

.c-figures {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 0 0 1rem;

  div {
    flex: 1 1 140px;
    padding: 0.7rem 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  dt {
    font-size: 0.8rem;
    color: var(--ink-600);
  }

  dd {
    margin: 0.1rem 0 0;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--navy-900);
    font-variant-numeric: tabular-nums;
  }

  small {
    margin-left: 0.3rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink-600);
  }
}

.c-block {
  margin-bottom: 1.5rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid var(--line);
}

.c-subhead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin-bottom: 0.75rem;

  h3 {
    margin: 0;
    font-size: 1.05rem;
    color: var(--navy-900);
  }
}

.c-label {
  margin: 0.75rem 0 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink-600);
}

.c-stops {
  margin-bottom: 0.6rem;
}

/* Barco parado: banda apagada con rayas, distinta de las salidas. */
.c-stop {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.6rem 0.8rem;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-sm);
  background: repeating-linear-gradient(-45deg, var(--pill-neutral-bg) 0 10px, var(--surface) 10px 20px);

  &--dique {
    background: repeating-linear-gradient(-45deg, var(--pill-warn-bg) 0 10px, var(--surface) 10px 20px);
  }
}

.c-stop-icon {
  flex-shrink: 0;
  width: 3.4rem;
  font-size: 1.4rem;
  text-align: center;
  color: var(--ink-600);

  .c-stop--dique & {
    color: var(--pill-warn-ink);
  }
}

.c-stop-del {
  @include touch-target;
  flex-shrink: 0;
  color: var(--danger-ink);
}

.stop-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.stop-kind {
  display: flex;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  border: 0;

  legend {
    margin-bottom: 0.4rem;
    padding: 0;
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--ink-600);
  }
}

.stop-kind-opt {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  min-height: 96px;
  padding: 0.85rem 0.5rem;
  border: 2px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--navy-900);
  text-align: center;
  cursor: pointer;

  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  i {
    font-size: 1.5rem;
    color: var(--navy-600);
  }

  strong {
    font-size: 1.1rem;
  }

  span {
    font-size: 0.85rem;
    color: var(--ink-600);
  }

  &:has(input:checked) {
    border-color: var(--navy-800);
    background: var(--navy-800);
    color: #fff;

    i,
    span {
      color: var(--powder-300);
    }
  }

  &:has(input:focus-visible) {
    box-shadow: var(--focus-ring);
  }
}

.stop-dates {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;

  .field {
    flex: 1 1 180px;
  }
}

.c-empty {
  margin: 0;
  color: var(--ink-600);
}

.c-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.c-row {
  display: flex;
  align-items: flex-start;
  gap: 0.9rem;
  padding: 0.8rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.c-date {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  width: 3.4rem;
  padding: 0.35rem 0;
  border-radius: var(--radius-sm);
  background: var(--navy-800);
  color: #fff;

  strong {
    font-size: 1.35rem;
    line-height: 1.1;
  }

  span {
    font-size: 0.75rem;
    text-transform: uppercase;
  }
}

.c-body {
  flex: 1;
  min-width: 0;
}

.c-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.6rem;
  margin: 0;
  color: var(--navy-900);
}

.c-status {
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  background: var(--cream-100);
  color: var(--ink-600);

  &--abordo {
    background: var(--pill-ok-bg, var(--powder-100));
    color: var(--pill-ok-ink, var(--navy-800));
  }
}

.c-meta {
  margin: 0.15rem 0 0;
  font-size: 0.85rem;
  color: var(--ink-600);
}

.c-countries {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0.5rem 0 0;
  padding: 0;
  list-style: none;

  li {
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    background: var(--powder-100, var(--cream-100));
    font-size: 0.8rem;
    color: var(--ink-900);
  }
}

.c-pax {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex-shrink: 0;
  margin: 0;

  strong {
    font-size: 1.4rem;
    color: var(--navy-900);
    font-variant-numeric: tabular-nums;
  }

  span {
    font-size: 0.75rem;
    color: var(--ink-600);
  }
}
</style>
