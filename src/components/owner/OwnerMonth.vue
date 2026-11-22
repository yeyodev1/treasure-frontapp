<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'
import OwnerBars from '@/components/owner/OwnerBars.vue'
import ColumnChart from '@/components/owner/ColumnChart.vue'
import {
  STATUS_LABEL,
  countriesOf,
  cruiseEnd,
  cruiseRange,
  cruiseStart,
  legOf,
  loadCalendar,
  monthTitle,
  topWithOthers,
} from '@/components/owner/insights'
import { useToastStore } from '@/stores/toast'
import { apiOwnerPanel, type CruiseCalendarRow } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney } from '@/utils/format'
import type { OwnerPanel } from '@/types'

/** Un mes: sus cruceros, el consumo día por día y quiénes viajaron. */
const month = defineModel<string>('month', { required: true })
const emit = defineEmits<{ cruise: [id: string] }>()
const toast = useToastStore()

const rows = shallowRef<CruiseCalendarRow[]>([])
const panel = shallowRef<OwnerPanel | null>(null)
const loading = shallowRef(true)

const lastDay = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y!, mo!, 0)).getUTCDate()
}

watch(
  month,
  async (m) => {
    loading.value = true
    try {
      const [cal, p] = await Promise.all([loadCalendar(), apiOwnerPanel({ from: `${m}-01`, to: `${m}-${lastDay(m)}` })])
      rows.value = cal.rows
      panel.value = p
    } catch (err) {
      toast.error(apiErrorMessage(err))
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

function shift(delta: number) {
  const [y, m] = month.value.split('-').map(Number)
  month.value = new Date(Date.UTC(y!, m! - 1 + delta, 1)).toISOString().slice(0, 7)
}

/** Salidas que tocan el mes (empiezan, terminan o lo cruzan). */
const cruises = computed(() =>
  rows.value
    .filter((c) => cruiseStart(c).slice(0, 7) <= month.value && cruiseEnd(c).slice(0, 7) >= month.value)
    .sort((a, b) => a.startDate.localeCompare(b.startDate)),
)
const passengers = computed(() => cruises.value.reduce((s, c) => s + c.passengers, 0))
const consumed = computed(() => panel.value?.netConsumption ?? 0)

const days = computed(() => {
  const totals = new Map((panel.value?.byDay ?? []).map((d) => [d.date, d]))
  return Array.from({ length: lastDay(month.value) }, (_, i) => {
    const key = `${month.value}-${String(i + 1).padStart(2, '0')}`
    const d = totals.get(key)
    return {
      key,
      label: String(i + 1),
      value: d?.total ?? null,
      detail: d ? `${d.orders} consumos` : undefined,
    }
  })
})

const byCruise = computed(() =>
  [...cruises.value]
    .sort((a, b) => b.consumed - a.consumed)
    .map((c) => ({
      id: c.id,
      label: c.code,
      value: c.consumed,
      detail: cruiseRange(c),
    })),
)
const top = computed(() =>
  topWithOthers(
    (panel.value?.topProducts ?? []).map((p) => ({
      label: p.name,
      value: p.qty,
    })),
    7,
  ),
)
const byLeg = computed(() => {
  const m = new Map<string, number>()
  for (const c of cruises.value) m.set(legOf(c), (m.get(legOf(c)) ?? 0) + c.passengers)
  return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([leg, n]) => ({ label: `Tipo ${leg}`, value: n }))
})
const countries = computed(() => countriesOf(cruises.value).filter((k) => k.country !== 'Sin país'))

const money = (v: number) => formatMoney(v)
const count = (v: number) => String(v)
const short = (v: number) => `$${Math.round(v)}`
</script>

<template>
  <div class="ins">
    <header class="ins-head">
      <div>
        <h2>{{ monthTitle(month) }}</h2>
        <p>Los cruceros del mes y cómo se movió el bar día por día.</p>
      </div>
      <div class="ins-nav" role="group" aria-label="Mes">
        <button type="button" class="icon-btn" aria-label="Mes anterior" @click="shift(-1)">
          <i class="fa-solid fa-chevron-left" aria-hidden="true" />
        </button>
        <strong aria-live="polite">{{ monthTitle(month) }}</strong>
        <button type="button" class="icon-btn" aria-label="Mes siguiente" @click="shift(1)">
          <i class="fa-solid fa-chevron-right" aria-hidden="true" />
        </button>
      </div>
    </header>

    <SkeletonBlock v-if="loading" height="420px" />
    <template v-else>
      <dl class="ins-kpis">
        <div>
          <dt>Cruceros del mes</dt>
          <dd>{{ cruises.length }}</dd>
          <small>{{ cruises.map((c) => c.code).join(' · ') || 'Ninguno' }}</small>
        </div>
        <div>
          <dt>Pasajeros</dt>
          <dd>{{ passengers }}</dd>
          <small>{{ byLeg.map((l) => `${l.label.replace('Tipo ', '')} ${l.value}`).join(' · ') }}</small>
        </div>
        <div>
          <dt>Consumo del bar</dt>
          <dd>{{ formatMoney(consumed) }}</dd>
          <small>consumido en el mes</small>
        </div>
        <div>
          <dt>Por pasajero</dt>
          <dd>{{ passengers ? formatMoney(consumed / passengers) : '—' }}</dd>
          <small>consumo / pasajeros</small>
        </div>
        <div>
          <dt>Cobrado</dt>
          <dd>{{ formatMoney(panel?.collected ?? 0) }}</dd>
          <small>pagos del mes</small>
        </div>
      </dl>

      <div class="ins-grid">
        <section class="ins-card ins-card--wide" aria-labelledby="m-days">
          <h3 id="m-days">Consumo día por día</h3>
          <p class="ins-sub">Pasa o toca una barra para ver el monto del día. Gris = día sin consumos.</p>
          <ColumnChart :columns="days" :format="short" label="Consumo del bar por día" />
        </section>

        <section class="ins-card" aria-labelledby="m-cruises">
          <h3 id="m-cruises">¿Qué crucero consumió más?</h3>
          <p class="ins-sub">Consumo total de cada crucero. Toca uno para abrirlo.</p>
          <OwnerBars :rows="byCruise" :format="money" tone="main" empty="Sin cruceros este mes." @pick="emit('cruise', $event)" />
        </section>

        <section class="ins-card ins-card--wide" aria-labelledby="m-table">
          <h3 id="m-table">Cruceros del mes</h3>
          <p class="ins-sub">Toca el código para ver el crucero completo.</p>
          <div v-if="cruises.length" class="ins-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Crucero</th>
                  <th scope="col">Fechas</th>
                  <th scope="col">Ruta</th>
                  <th scope="col" class="num">Pasajeros</th>
                  <th scope="col" class="num">Bar</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in cruises" :key="c.id">
                  <th scope="row">
                    <button type="button" class="ins-link" @click="emit('cruise', c.id)">
                      {{ c.code }}
                    </button>
                  </th>
                  <td>{{ cruiseRange(c) }}</td>
                  <td>{{ c.route || '—' }}</td>
                  <td class="num">{{ c.passengers }}</td>
                  <td class="num">{{ formatMoney(c.consumed) }}</td>
                  <td>{{ STATUS_LABEL[c.status] }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="ins-empty">No hay cruceros en {{ monthTitle(month).toLowerCase() }}.</p>
        </section>

        <section class="ins-card" aria-labelledby="m-products">
          <h3 id="m-products">Lo más vendido</h3>
          <p class="ins-sub">Unidades servidas en el mes.</p>
          <OwnerBars :rows="top" :format="count" tone="main" empty="Sin consumos este mes." />
        </section>

        <section class="ins-card" aria-labelledby="m-countries">
          <h3 id="m-countries">Nacionalidades</h3>
          <p class="ins-sub">{{ passengers }} pasajeros de {{ countries.length }} países.</p>
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
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use '@/components/owner/insights';
</style>
