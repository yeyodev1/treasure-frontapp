<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'
import OwnerBars from '@/components/owner/OwnerBars.vue'
import ColumnChart from '@/components/owner/ColumnChart.vue'
import ShipStopForm from '@/components/owner/ShipStopForm.vue'
import {
  MONTHS,
  countriesOf,
  cruiseStart,
  dayKey,
  daysBetween,
  legOf,
  loadCalendar,
  stopCruise,
  stopRange,
  topWithOthers,
} from '@/components/owner/insights'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { apiDeleteShipStop, apiOwnerPanel, type CruiseCalendarRow, type ShipStopRow } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney } from '@/utils/format'
import type { OwnerPanel } from '@/types'

/** Panorama del año: la unidad para evaluar el negocio (pedido del cliente, 21-nov-2026). */
const year = defineModel<number>('year', { required: true })
const emit = defineEmits<{ month: [key: string]; cruise: [id: string] }>()
const toast = useToastStore()

const rows = shallowRef<CruiseCalendarRow[]>([])
const stops = shallowRef<ShipStopRow[]>([])
const panel = shallowRef<OwnerPanel | null>(null)
const loading = shallowRef(true)

watch(
  year,
  async (y) => {
    loading.value = true
    try {
      const [cal, p] = await Promise.all([loadCalendar(), apiOwnerPanel({ from: `${y}-01-01`, to: `${y}-12-31` })])
      rows.value = cal.rows
      stops.value = cal.stops
      panel.value = p
    } catch (err) {
      toast.error(apiErrorMessage(err))
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const y = computed(() => String(year.value))
const cruises = computed(() => rows.value.filter((c) => cruiseStart(c).startsWith(y.value)))
const passengers = computed(() => cruises.value.reduce((s, c) => s + c.passengers, 0))
const countries = computed(() => countriesOf(cruises.value).filter((k) => k.country !== 'Sin país'))

const months = computed(() => {
  const totals = new Map<string, number>()
  for (const d of panel.value?.byDay ?? []) totals.set(d.date.slice(0, 7), (totals.get(d.date.slice(0, 7)) ?? 0) + d.total)
  return MONTHS.map((label, i) => {
    const key = `${y.value}-${String(i + 1).padStart(2, '0')}`
    return { key, label, value: totals.get(key) ?? null }
  })
})

const byCruise = computed(() =>
  [...cruises.value]
    .sort((a, b) => b.consumed - a.consumed)
    .map((c) => ({
      id: c.id,
      label: c.code,
      value: c.consumed,
      detail: `${c.passengers} pasajeros`,
    })),
)

const byLeg = computed(() => {
  const m = new Map<string, number>()
  for (const c of cruises.value) m.set(legOf(c), (m.get(legOf(c)) ?? 0) + c.passengers)
  return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([leg, n]) => ({ label: `Tipo ${leg}`, value: n }))
})

/** Paras y dique con sus días dentro del año. */
const yearStops = computed(() =>
  stops.value
    .filter((s) => dayKey(s.from) <= `${y.value}-12-31` && dayKey(s.to) >= `${y.value}-01-01`)
    .sort((a, b) => a.from.localeCompare(b.from)),
)
const down = computed(() => {
  const r = { para: 0, dique: 0 }
  for (const s of yearStops.value) {
    const from = dayKey(s.from) > `${y.value}-01-01` ? dayKey(s.from) : `${y.value}-01-01`
    const to = dayKey(s.to) < `${y.value}-12-31` ? dayKey(s.to) : `${y.value}-12-31`
    r[s.kind] += daysBetween(from, to)
  }
  return r
})

// Paras y dique se marcan aquí (antes en la pestaña «Registro», 23-nov-2026).
const confirm = useConfirmStore()
const formOpen = shallowRef(false)

async function reloadStops() {
  const cal = await loadCalendar(true)
  rows.value = cal.rows
  stops.value = cal.stops
}

async function onStopSaved(from: string) {
  formOpen.value = false
  year.value = Number(from.slice(0, 4))
  await reloadStops().catch((err) => toast.error(apiErrorMessage(err)))
}

async function removeStop(s: ShipStopRow) {
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
    await reloadStops()
    toast.success('Quitado')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

const money = (v: number) => formatMoney(v)
const count = (v: number) => String(v)
const short = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`)
</script>

<template>
  <div class="ins">
    <header class="ins-head">
      <div>
        <h2>Panorama de {{ year }}</h2>
        <p>Cuántos pasajeros, de dónde, cuánto consumieron y cuántos días operó el barco.</p>
      </div>
      <div class="ins-nav" role="group" aria-label="Año">
        <button type="button" class="icon-btn" aria-label="Año anterior" @click="year -= 1">
          <i class="fa-solid fa-chevron-left" aria-hidden="true" />
        </button>
        <strong aria-live="polite">{{ year }}</strong>
        <button type="button" class="icon-btn" aria-label="Año siguiente" @click="year += 1">
          <i class="fa-solid fa-chevron-right" aria-hidden="true" />
        </button>
      </div>
    </header>

    <SkeletonBlock v-if="loading" height="420px" />
    <template v-else>
      <dl class="ins-kpis">
        <div>
          <dt>Cruceros</dt>
          <dd>{{ cruises.length }}</dd>
          <small
            >{{ cruises.filter((c) => c.status === 'cerrado').length }}
            finalizados ·
            {{ cruises.filter((c) => c.status === 'abordo').length }} en curso</small
          >
        </div>
        <div>
          <dt>Pasajeros</dt>
          <dd>{{ passengers }}</dd>
          <small>{{ countries.length }} países</small>
        </div>
        <div>
          <dt>Consumo del bar</dt>
          <dd>{{ formatMoney(panel?.netConsumption ?? 0) }}</dd>
          <small>{{ passengers ? `${formatMoney((panel?.netConsumption ?? 0) / passengers)} por pasajero` : 'Sin pasajeros' }}</small>
        </div>
        <div>
          <dt>Cobrado</dt>
          <dd>{{ formatMoney(panel?.collected ?? 0) }}</dd>
          <small>pagos del año</small>
        </div>
      </dl>

      <div class="ins-grid">
        <section class="ins-card ins-card--wide" aria-labelledby="y-months">
          <h3 id="y-months">Consumo del bar mes a mes</h3>
          <p class="ins-sub">Toca un mes para ver sus cruceros. Una barra gris es un mes sin información, no $0.</p>
          <ColumnChart :columns="months" :format="short" pickable label="Consumo del bar por mes" @pick="emit('month', $event)" />
        </section>

        <section class="ins-card" aria-labelledby="y-cruises">
          <h3 id="y-cruises">Consumo por crucero</h3>
          <p class="ins-sub">Toca un crucero para ver su detalle.</p>
          <OwnerBars :rows="byCruise" :format="money" tone="main" :empty="`Sin cruceros en ${year}.`" @pick="emit('cruise', $event)" />
        </section>

        <section class="ins-card" aria-labelledby="y-legs">
          <h3 id="y-legs">Pasajeros por tipo de crucero</h3>
          <p class="ins-sub">{{ cruises.length }} cruceros, {{ passengers }} pasajeros.</p>
          <OwnerBars :rows="byLeg" :format="count" tone="main" />
        </section>

        <section class="ins-card" aria-labelledby="y-countries">
          <h3 id="y-countries">Nacionalidades</h3>
          <p class="ins-sub">Pasajeros por país en {{ year }}.</p>
          <OwnerBars
            :rows="
              topWithOthers(
                countries.map((k) => ({ label: k.country, value: k.count })),
                6,
              )
            "
            :format="count"
            tone="main"
          />
        </section>

        <section class="ins-card" aria-labelledby="y-stops">
          <div class="stops-head">
            <h3 id="y-stops">Paras y dique</h3>
            <button type="button" class="btn btn-secondary" @click="formOpen = true">
              <i class="fa-solid fa-circle-pause" aria-hidden="true" /> Marcar
            </button>
          </div>
          <p class="ins-sub">
            {{ down.para }} {{ down.para === 1 ? 'día' : 'días' }} de para · {{ down.dique }} de dique. Toca una para ver el detalle.
          </p>
          <ul v-if="yearStops.length" class="ins-stops">
            <li v-for="s in yearStops" :key="s.id">
              <details :class="s.kind">
                <summary>
                  <strong>{{ s.kind === 'para' ? 'Para' : 'Dique' }}</strong>
                  <small>{{ stopRange(s) }}</small>
                </summary>
                <p class="stop-body">
                  {{ stopCruise(s, rows) }}.<template v-if="s.note"> {{ s.note }}.</template> Marcado por
                  {{ s.createdByName || 'Gerencia' }}.
                  <button type="button" class="btn-text stop-del" @click="removeStop(s)">
                    <i class="fa-solid fa-trash" aria-hidden="true" /> Quitar
                  </button>
                </p>
              </details>
            </li>
          </ul>
          <p v-else class="ins-empty">No hay paras ni dique en {{ year }}.</p>
        </section>
      </div>
    </template>

    <ShipStopForm v-if="formOpen" @close="formOpen = false" @saved="onStopSaved" />
  </div>
</template>

<style scoped lang="scss">
@use '@/components/owner/insights';

.stops-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.stop-del {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 44px;
  margin-left: 0.5rem;
  color: var(--danger-ink);
}
</style>
