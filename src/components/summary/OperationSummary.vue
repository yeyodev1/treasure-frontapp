<script setup lang="ts">
import CruiseTag from '@/components/cruises/CruiseTag.vue'
import { legStyle } from '@/utils/cruiseLook'
import { computed } from 'vue'
import type { OperationSummary, SummaryPeriodKind } from '@/services/api'
import { MONTHS, fmt } from '@/components/owner/insights'
import { TIMEZONE } from '@/utils/format'

/**
 * Vista Operación del Resumen (especificación del 24-nov-2026): pasajeros,
 * ocupación, nacionalidades y días operados, sin montos de dinero. Gerencia la
 * exporta en PDF para los socios.
 */
const props = defineProps<{ data: OperationSummary }>()
const emit = defineEmits<{ period: [kind: SummaryPeriodKind, value: string] }>()

const kind = computed(() => props.data.period.kind)
const f = computed(() => props.data.figures)
const monthShort = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1] ?? key
const day = (key: string) => fmt(key, { day: 'numeric', month: 'short' })
const time = (iso: string) => new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE })

const compareText = computed(() =>
  f.value.compare.map((c) => (c.pax ? `${c.label}: ${c.pax} pasajeros` : `${c.label}: sin datos`)).join(' · '),
)
const legsText = computed(() => props.data.legs.map((l) => `${l.leg} ${l.pax}`).join(' · '))
const paxMax = computed(() => Math.max(1, ...props.data.months.map((m) => m.passengers)))
const activeMonths = computed(() => props.data.months.filter((m) => m.active))
const countryMax = computed(() => Math.max(1, ...props.data.countries.rows.map((r) => r.count)))
const yearMax = computed(() => Math.max(1, ...props.data.years.map((y) => y.passengers)))

const STATE_LABEL = { navegando: 'Navegando', para: 'Para (sin crucero)', dique: 'Dique', por_venir: 'Por venir', sin_registro: 'Sin registro' } as const
</script>

<template>
  <div class="ins op-view">
    <p v-if="data.cruise" class="cruise-line">
      {{ data.cruise.route }}<template v-if="data.cruise.route"> · </template>tipo {{ data.cruise.leg }} · {{ day(data.cruise.start) }}–{{ day(data.cruise.end) }} ·
      {{ data.cruise.status === 'abordo' ? 'En curso' : data.cruise.status === 'cerrado' ? 'Finalizado' : 'Programado' }}
    </p>
    <p v-if="data.partial" class="partial"><i class="fa-solid fa-circle-info" aria-hidden="true" /> {{ data.partial.label }}</p>

    <!-- 1. Cuatro cifras -->
    <dl v-if="kind !== 'crucero'" class="ins-kpis">
      <div>
        <dt>Cruceros</dt>
        <dd>{{ f.cruises }}</dd>
        <small>{{ f.finished }} finalizado{{ f.finished === 1 ? '' : 's' }}, {{ f.running }} en curso</small>
      </div>
      <div>
        <dt>Pasajeros</dt>
        <dd>{{ f.passengers }}</dd>
        <small>de {{ f.seats }} plazas<template v-if="compareText"> · {{ compareText }}</template></small>
      </div>
      <div>
        <dt>Ocupación</dt>
        <dd>{{ f.occupancy === null ? '—' : `${f.occupancy} %` }}</dd>
        <small>capacidad {{ data.capacity }} por crucero</small>
      </div>
      <div>
        <dt>Días operados</dt>
        <dd>{{ f.operatedDays }}</dd>
        <small>{{ f.paraDays }} para · {{ f.diqueDays }} dique<template v-if="kind === 'ano' && f.since"> · desde {{ monthShort(f.since).toLowerCase() }}</template><template v-else-if="f.upcomingDays"> · {{ f.upcomingDays }} por venir</template></small>
      </div>
    </dl>
    <dl v-else-if="data.cruise" class="ins-kpis">
      <div>
        <dt>Pasajeros</dt>
        <dd>{{ f.passengers }}</dd>
        <small>de {{ data.capacity }} plazas</small>
      </div>
      <div>
        <dt>Ocupación</dt>
        <dd>{{ f.occupancy === null ? '—' : `${f.occupancy} %` }}</dd>
        <small>{{ data.cruise.usedCabins }} de {{ data.cruise.cabinCount }} cabinas</small>
      </div>
      <div>
        <dt>Países</dt>
        <dd>{{ data.countries.total }}</dd>
      </div>
      <div>
        <dt>Días operados</dt>
        <dd>{{ data.cruise.nights }}</dd>
        <small>noches con pasajeros abordo</small>
      </div>
    </dl>

    <!-- Gráfico «Años»: desde que hay dos años con datos -->
    <section v-if="kind === 'ano' && data.years.length" class="ins-card" aria-labelledby="o-years">
      <h3 id="o-years">Años</h3>
      <ul class="hbars">
        <li v-for="y in data.years" :key="y.year">
          <span>{{ y.year }}</span>
          <span class="hbar"><span class="hbar-fill" :style="{ width: `${(y.passengers / yearMax) * 100}%` }" /></span>
          <strong>{{ y.passengers }} pax · {{ y.occupancy ?? '—' }} % · {{ y.nights }} noches</strong>
        </li>
      </ul>
    </section>

    <!-- 3. Pasajeros mes a mes (solo Año) -->
    <section v-if="kind === 'ano'" class="ins-card" aria-labelledby="o-months">
      <h3 id="o-months">Pasajeros mes a mes</h3>
      <p v-if="!activeMonths.length" class="ins-empty">Sin operación en {{ data.period.label }}.</p>
      <div v-else class="cols">
        <button
          v-for="m in activeMonths"
          :key="m.month"
          type="button"
          class="col"
          :aria-label="`${monthShort(m.month)}: ${m.passengers} pasajeros`"
          @click="emit('period', 'mes', m.month)"
        >
          <span class="col-plot" aria-hidden="true">
            <span class="col-value">{{ m.passengers || '' }}</span>
            <span class="col-bar" :style="{ height: `${(m.passengers / paxMax) * 100}%` }" />
          </span>
          <span class="col-label">{{ monthShort(m.month) }}</span>
        </button>
      </div>
      <p class="ins-sub">Empieza en el primer mes con operación. Al tocar un mes se abre la pestaña Mes.</p>
    </section>

    <div class="ins-grid">
      <!-- 2. Ocupación por crucero / Cabinas -->
      <section v-if="kind !== 'crucero'" class="ins-card" aria-labelledby="o-occ">
        <h3 id="o-occ">Ocupación por crucero</h3>
        <p v-if="!data.occupancy.length" class="ins-empty">Sin cruceros en este período.</p>
        <ul v-else class="hbars">
          <li v-for="c in data.occupancy" :key="c.id">
            <button type="button" class="ins-link" @click="emit('period', 'crucero', c.id)"><CruiseTag :code="c.code" /></button>
            <span class="hbar"><span class="hbar-fill hbar-fill--green" :style="{ width: `${(c.pax / c.capacity) * 100}%` }" /></span>
            <strong>{{ c.pax }}/{{ c.capacity }}</strong>
          </li>
        </ul>
        <p v-if="legsText" class="ins-sub">Por tipo: {{ legsText }}</p>
      </section>
      <section v-else-if="data.cruise" class="ins-card" aria-labelledby="o-cabins">
        <h3 id="o-cabins">Cabinas</h3>
        <div class="ins-table">
          <table>
            <thead>
              <tr><th scope="col">Cabina</th><th scope="col">Titular</th><th scope="col" class="num">Pax</th></tr>
            </thead>
            <tbody>
              <tr v-for="c in data.cruise.cabins" :key="c.number" :class="{ empty: !c.pax }">
                <td>{{ c.number }}</td>
                <td>{{ c.holder || 'Sin pasajeros' }}</td>
                <td class="num">{{ c.pax || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 4. Nacionalidades -->
      <section class="ins-card" aria-labelledby="o-countries">
        <h3 id="o-countries">Nacionalidades<template v-if="data.countries.total"> · {{ data.countries.total }} países</template></h3>
        <p v-if="!data.countries.rows.length" class="ins-empty">Sin pasajeros registrados.</p>
        <ul v-else class="hbars hbars--wide">
          <li v-for="r in data.countries.rows" :key="r.country">
            <span>{{ r.country }}</span>
            <span class="hbar"><span class="hbar-fill hbar-fill--green" :class="{ 'hbar-fill--muted': r.country.startsWith('Otros') }" :style="{ width: `${(r.count / countryMax) * 100}%` }" /></span>
            <strong>{{ r.count }} · {{ r.pct }} %</strong>
          </li>
        </ul>
      </section>
    </div>

    <!-- 5. Calendario del barco -->
    <section class="ins-card" aria-labelledby="o-cal">
      <h3 id="o-cal">{{ kind === 'crucero' ? 'Días del crucero' : kind === 'mes' ? `Calendario del barco · ${fmt(`${data.period.value}-15`, { month: 'long' })}` : 'Calendario del barco · días por mes' }}</h3>

      <div v-if="kind === 'ano'" class="year-cal">
        <div v-for="m in data.months" :key="m.month" class="ym" :class="{ 'ym--none': !m.active }">
          <span class="ym-bar" :aria-label="`${monthShort(m.month)}: ${m.navegando} navegando, ${m.para} para, ${m.dique} dique, ${m.porVenir} por venir`">
            <template v-if="m.active">
              <span class="seg seg--por_venir" :style="{ flexGrow: m.porVenir }" />
              <span class="seg seg--dique" :style="{ flexGrow: m.dique }" />
              <span class="seg seg--para" :style="{ flexGrow: m.para }" />
              <span class="seg seg--navegando" :style="{ flexGrow: m.navegando }" />
            </template>
          </span>
          <span class="ym-label">{{ monthShort(m.month) }}</span>
          <small>{{ !m.active ? 'sin registro' : m.navegando + m.para + m.dique ? `${m.navegando} nav · ${m.para} para` : 'por venir' }}</small>
        </div>
      </div>

      <div v-else-if="kind === 'mes'" class="month-cal" role="list">
        <span
          v-for="d in data.days"
          :key="d.day"
          role="listitem"
          class="md"
          :class="[`md--${d.state}`, { 'md--today': d.today }]"
          :aria-label="`${day(d.day)}: ${STATE_LABEL[d.state]}${d.code ? ` · ${d.code}` : ''}`"
        >
          <span v-if="d.departs || d.today" class="md-tag" :style="d.today ? undefined : legStyle(d.code)">{{ d.today ? 'Hoy' : d.code }}</span>
          <span class="md-num">{{ Number(d.day.slice(8)) }}</span>
        </span>
      </div>

      <div v-else-if="data.cruise" class="cruise-days">
        <span v-for="(d, i) in data.days.filter((x) => x.day >= data.cruise!.start && x.day <= data.cruise!.end)" :key="d.day" class="cd cd--navegando">
          <strong>{{ i === 0 ? `Zarpe ${time(data.cruise.startTime)}` : d.day === data.cruise.end ? 'Llegada' : '' }}</strong>
          <small>{{ day(d.day) }}</small>
        </span>
      </div>

      <p class="legend">
        <span><i class="sw sw--navegando" /> Navegando</span>
        <span><i class="sw sw--para" /> Para (sin crucero)</span>
        <span><i class="sw sw--dique" /> Dique</span>
        <span><i class="sw sw--por_venir" /> Por venir</span>
        <span><i class="sw sw--sin_registro" /> Sin registro</span>
      </p>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use '@/components/owner/insights';

.cruise-line,
.partial {
  margin: 0;
  color: var(--ink-600);
}

.partial {
  font-weight: 600;
  color: var(--warning-ink);
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

  &--wide li {
    grid-template-columns: minmax(6rem, 9rem) minmax(0, 1fr) auto;
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

  &--green {
    background: var(--nav-green, #1fa97a);
  }

  &--muted {
    background: var(--line-strong);
  }
}

.cols {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  min-height: 170px;
}

.col {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-width: 50%;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.col-plot {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  height: 140px;
  border-bottom: 1px solid var(--line);
}

.col-value {
  font-size: 0.85rem;
  font-weight: 600;
  text-align: center;
}

.col-bar {
  display: block;
  border-radius: 4px 4px 0 0;
  background: #1fa97a;
}

.col-label {
  font-size: 0.8rem;
  text-align: center;
  color: var(--ink-600);
}

tr.empty td {
  color: var(--ink-400);
}

/* Colores del calendario: navegando verde, para gris, dique rojo, por venir punteado, sin registro rayado. */
.seg,
.md,
.cd,
.sw {
  &--navegando {
    background: #1fa97a;
    color: #fff;
  }

  &--para {
    background: #8c8a80;
    color: #fff;
  }

  &--dique {
    background: #d9534f;
    color: #fff;
  }

  &--por_venir {
    border: 1px dashed var(--line-strong);
    background: var(--surface);
  }

  &--sin_registro {
    background: repeating-linear-gradient(-45deg, var(--cream-100) 0 6px, var(--surface) 6px 12px);
    color: var(--ink-400);
  }
}

.year-cal {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.6rem 0.5rem;
  margin-top: 0.75rem;

  @media (min-width: 900px) {
    grid-template-columns: repeat(12, minmax(0, 1fr));
  }
}

.ym {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  text-align: center;

  small {
    font-size: 0.7rem;
    color: var(--ink-600);
  }
}

.ym-bar {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 40px;
  overflow: clip;
  border-radius: 4px;
  border: 1px dashed var(--line-strong);

  .ym--none & {
    background: repeating-linear-gradient(-45deg, var(--cream-100) 0 6px, var(--surface) 6px 12px);
  }
}

.seg {
  flex-basis: 0;
}

.ym-label {
  font-size: 0.8rem;
  font-weight: 600;
}

.month-cal {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
  margin-top: 0.75rem;

  @media (min-width: 900px) {
    grid-template-columns: repeat(31, minmax(0, 1fr));
  }
}

.md {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 46px;
  padding: 2px 3px;
  border-radius: 4px;
  font-size: 0.7rem;

  &--today {
    outline: 2px solid var(--navy-800);
    outline-offset: 1px;
  }
}

.md-tag {
  font-size: 0.62rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: clip;
}

.md-num {
  align-self: flex-end;
}

.cruise-days {
  display: flex;
  gap: 4px;
  margin-top: 0.75rem;
}

.cd {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  padding: 0.5rem 0.25rem;
  border-radius: 4px;
  text-align: center;

  small {
    opacity: 0.9;
  }
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
  margin: 0.75rem 0 0;
  font-size: 0.82rem;
  color: var(--ink-600);

  span {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
}

.sw {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
</style>
