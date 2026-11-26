<script setup lang="ts">
import { legStyle } from '@/utils/cruiseLook'
import { computed, shallowRef, watch } from 'vue'
import { addDays, daysBetween, dayKey, fmt, monthTitle } from '@/components/owner/insights'
import { todayKey } from '@/utils/format'
import type { Cruise } from '@/types'

/**
 * Mes en calendario con cada crucero como una barra sobre sus días (pedido
 * de Gerencia, 23-nov-2026): tocar la barra elige el crucero.
 */
const props = defineProps<{ cruises: Cruise[] }>()
const selected = defineModel<string>({ required: true })

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const today = todayKey()

const start = (c: Cruise) => dayKey(c.startDate)
const end = (c: Cruise) => dayKey(c.endDate ?? c.startDate)

const month = shallowRef(today.slice(0, 7))
// Abre en el mes del crucero elegido (y lo sigue si cambia desde fuera).
watch(
  () => props.cruises.find((c) => c._id === selected.value),
  (c) => {
    if (c && !(start(c).slice(0, 7) <= month.value && end(c).slice(0, 7) >= month.value)) month.value = start(c).slice(0, 7)
  },
  { immediate: true },
)

function shift(delta: number) {
  const [y, m] = month.value.split('-').map(Number)
  month.value = new Date(Date.UTC(y!, m! - 1 + delta, 1)).toISOString().slice(0, 7)
}

interface Segment {
  cruise: Cruise
  col: number
  span: number
  lane: number
  /** El crucero empezó en una semana anterior. */
  continues: boolean
}

const weeks = computed(() => {
  const first = `${month.value}-01`
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7
  const out: Array<{ days: string[]; segments: Segment[]; lanes: number }> = []
  for (let weekStart = addDays(first, -lead); weekStart.slice(0, 7) <= month.value; weekStart = addDays(weekStart, 7)) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    const weekEnd = days[6]!
    const laneEnds: number[] = []
    const segments = props.cruises
      .filter((c) => start(c) <= weekEnd && end(c) >= weekStart)
      .sort((a, b) => start(a).localeCompare(start(b)))
      .map((cruise) => {
        const col = start(cruise) > weekStart ? daysBetween(weekStart, start(cruise)) : 1
        const last = end(cruise) < weekEnd ? daysBetween(weekStart, end(cruise)) : 7
        // Un crucero que sale el día que llega otro va en otra fila.
        let lane = laneEnds.findIndex((e) => e < col)
        if (lane === -1) lane = laneEnds.length
        laneEnds[lane] = last
        return { cruise, col, span: last - col + 1, lane, continues: start(cruise) < weekStart }
      })
    out.push({ days, segments, lanes: Math.max(1, laneEnds.length) })
  }
  return out
})

const range = (c: Cruise) =>
  `${fmt(c.startDate, { day: 'numeric', month: 'short' })}${c.endDate ? ` – ${fmt(c.endDate, { day: 'numeric', month: 'short' })}` : ''}`
</script>

<template>
  <section class="cal" aria-label="Cruceros del mes">
    <div class="cal-nav">
      <button type="button" class="icon-btn" aria-label="Mes anterior" @click="shift(-1)">
        <i class="fa-solid fa-chevron-left" aria-hidden="true" />
      </button>
      <strong aria-live="polite">{{ monthTitle(month) }}</strong>
      <button type="button" class="icon-btn" aria-label="Mes siguiente" @click="shift(1)">
        <i class="fa-solid fa-chevron-right" aria-hidden="true" />
      </button>
    </div>

    <div class="cal-weekdays" aria-hidden="true">
      <span v-for="d in WEEKDAYS" :key="d">{{ d }}</span>
    </div>

    <div v-for="week in weeks" :key="week.days[0]" class="cal-week" :style="{ '--lanes': week.lanes }">
      <span
        v-for="(d, i) in week.days"
        :key="d"
        class="cal-day"
        :class="{ 'cal-day--out': d.slice(0, 7) !== month, 'cal-day--today': d === today }"
        :style="{ gridColumn: i + 1 }"
        aria-hidden="true"
      >
        {{ Number(d.slice(8)) }}
      </span>
      <button
        v-for="s in week.segments"
        :key="s.cruise._id"
        type="button"
        class="cal-bar"
        :class="[`cal-bar--${s.cruise.status}`, { 'cal-bar--on': s.cruise._id === selected, 'cal-bar--cont': s.continues }]"
        :style="{ gridColumn: `${s.col} / span ${s.span}`, gridRow: s.lane + 2, ...legStyle(s.cruise.code) }"
        :aria-pressed="s.cruise._id === selected"
        :aria-label="`Crucero ${s.cruise.code}, ${range(s.cruise)}`"
        @click="selected = s.cruise._id"
      >
        <i v-if="s.cruise._id === selected" class="fa-solid fa-check" aria-hidden="true" />
        {{ s.cruise.code || s.cruise.name }}
      </button>
    </div>

    <p v-if="!weeks.some((w) => w.segments.length)" class="cal-empty">No hay cruceros en {{ monthTitle(month).toLowerCase() }}.</p>
  </section>
</template>

<style scoped lang="scss">
.cal {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.cal-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;

  strong {
    min-width: 10rem;
    text-align: center;
    font-size: 1.05rem;
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

.cal-weekdays,
.cal-week {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.cal-weekdays span {
  padding-block: 0.25rem;
  font-size: 0.8rem;
  font-weight: 600;
  text-align: center;
  color: var(--ink-600);
}

/* Fila 1: número del día; debajo, una fila por crucero que se cruza en la semana. */
.cal-week {
  grid-template-rows: 1.6rem repeat(var(--lanes), 2.5rem);
  row-gap: 0.2rem;
  padding-bottom: 0.35rem;
  border-top: 1px solid var(--line);
}

.cal-day {
  grid-row: 1 / -1;
  padding: 0.2rem 0.35rem;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-900);

  &--out {
    color: var(--ink-600);
    opacity: 0.5;
  }

  &--today {
    font-weight: 700;
    color: var(--navy-800);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
}

.cal-bar {
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  margin-inline: 2px;
  padding: 0 0.6rem;
  border: 2px solid var(--navy-700);
  border-radius: 999px;
  background: var(--powder-100);
  color: var(--navy-900);
  font-size: 0.9rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: clip;
  text-overflow: ellipsis;
  transition:
    background 0.15s ease,
    transform 0.12s ease;

  &--cont {
    border-start-start-radius: 0;
    border-end-start-radius: 0;
  }

  &--planificado {
    border-style: dashed;
    background: var(--surface);
  }

  &--abordo {
    background: var(--pill-ok-bg, var(--powder-100));
  }

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }

  &:active {
    transform: scale(0.98);
  }
}

.cal-empty {
  margin: 0.5rem 0 0;
  text-align: center;
  color: var(--ink-600);
}
</style>
