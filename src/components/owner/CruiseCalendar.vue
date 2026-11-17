<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'
import { useToastStore } from '@/stores/toast'
import { apiCruiseCalendar, type CruiseCalendarRow } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { TIMEZONE, todayKey } from '@/utils/format'

/**
 * Registro de cruceros (pedido de Gerencia, 16-nov-2026): mes a mes, cada
 * salida con sus fechas, cuántos pasajeros y de qué países. Solo informativo.
 */
const toast = useToastStore()
const rows = shallowRef<CruiseCalendarRow[]>([])
const loading = shallowRef(true)
const month = shallowRef(todayKey().slice(0, 7))

const STATUS: Record<CruiseCalendarRow['status'], string> = {
  planificado: 'Programado',
  abordo: 'En curso',
  cerrado: 'Finalizado',
}

onMounted(async () => {
  try {
    rows.value = await apiCruiseCalendar()
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
        <p class="c-rule">Cada salida con sus fechas, cuántos pasajeros y de qué país. Solo informativo.</p>
      </div>
      <div class="c-nav" role="group" aria-label="Mes">
        <button type="button" class="icon-btn" aria-label="Mes anterior" @click="shift(-1)">
          <i class="fa-solid fa-chevron-left" aria-hidden="true" />
        </button>
        <strong aria-live="polite">{{ monthLabel }}</strong>
        <button type="button" class="icon-btn" aria-label="Mes siguiente" @click="shift(1)">
          <i class="fa-solid fa-chevron-right" aria-hidden="true" />
        </button>
      </div>
    </header>

    <div v-if="loading" class="c-list">
      <SkeletonBlock height="90px" />
      <SkeletonBlock height="90px" />
    </div>

    <template v-else>
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
  </section>
</template>

<style scoped lang="scss">
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
