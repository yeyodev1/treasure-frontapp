<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'
import OwnerBars from '@/components/owner/OwnerBars.vue'
import ColumnChart from '@/components/owner/ColumnChart.vue'
import {
  STATUS_LABEL,
  addDays,
  cruiseEnd,
  cruiseRange,
  cruiseStart,
  fmt,
  legOf,
  loadCalendar,
  topWithOthers,
} from '@/components/owner/insights'
import { useToastStore } from '@/stores/toast'
import { apiOwnerPanel, type CruiseCalendarRow } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { dayKeyOf, formatMoney, todayKey } from '@/utils/format'
import type { OwnerPanel } from '@/types'

/**
 * Un crucero, la unidad central de información (pedido del cliente,
 * 21-nov-2026): pasajeros, consumo día por día, lo cobrado y lo que falta.
 * Tocar un día muestra lo que se sirvió ese día.
 */
const cruiseId = defineModel<string>('cruise', { required: true })
const toast = useToastStore()

const rows = shallowRef<CruiseCalendarRow[]>([])
const panel = shallowRef<OwnerPanel | null>(null)
const loading = shallowRef(true)
const day = shallowRef('')

const sorted = computed(() => [...rows.value].sort((a, b) => b.startDate.localeCompare(a.startDate)))
const cruise = computed(() => rows.value.find((c) => c.id === cruiseId.value) ?? null)

watch(
  cruiseId,
  async (id) => {
    loading.value = true
    day.value = ''
    try {
      const cal = await loadCalendar()
      rows.value = cal.rows
      // Sin elegir: el crucero en curso o el más reciente.
      const pick =
        id || (cal.rows.find((c) => c.status === 'abordo') ?? [...cal.rows].sort((a, b) => b.startDate.localeCompare(a.startDate))[0])?.id
      if (!pick) {
        panel.value = null
        return
      }
      if (pick !== id) {
        cruiseId.value = pick
        return
      }
      panel.value = await apiOwnerPanel({ cruiseId: pick })
    } catch (err) {
      toast.error(apiErrorMessage(err))
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const days = computed(() => {
  const c = cruise.value
  if (!c) return []
  const totals = new Map((panel.value?.byDay ?? []).map((d) => [d.date, d]))
  // También los días con consumo fuera de las fechas del crucero: la suma debe dar el total.
  const dates = [...totals.keys()].sort()
  const first = dates[0] && dates[0] < cruiseStart(c) ? dates[0] : cruiseStart(c)
  const planned = c.endDate ? cruiseEnd(c) : todayKey()
  const end = dates.at(-1) && dates.at(-1)! > planned ? dates.at(-1)! : planned
  const list = []
  for (let k = first, i = 0; k <= end && i < 60; k = addDays(k, 1), i++) {
    const d = totals.get(k)
    list.push({
      key: k,
      label: fmt(k, { day: 'numeric', month: 'short' }),
      value: d?.total ?? (k > todayKey() ? null : 0),
      detail: d ? `${d.orders} consumos` : undefined,
    })
  }
  return list
})

/** Lo servido el día elegido (o en todo el crucero), por producto. */
const served = computed(() => {
  const m = new Map<string, { qty: number; amount: number }>()
  for (const l of panel.value?.details.consumption ?? []) {
    if (day.value && dayKeyOf(l.at) !== day.value) continue
    const e = m.get(l.item) ?? { qty: 0, amount: 0 }
    e.qty += l.qty
    e.amount += l.amount
    m.set(l.item, e)
  }
  return [...m].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty)
})
const servedTotal = computed(() =>
  served.value.reduce((s, p) => ({ qty: s.qty + p.qty, amount: s.amount + p.amount }), { qty: 0, amount: 0 }),
)

const money = (v: number) => formatMoney(v)
const count = (v: number) => String(v)
const short = (v: number) => `$${Math.round(v)}`
</script>

<template>
  <div class="ins">
    <header class="ins-head">
      <div>
        <h2>{{ cruise ? `Crucero ${cruise.code}` : 'Crucero' }}</h2>
        <p v-if="cruise">
          {{ cruiseRange(cruise) }}<template v-if="cruise.route"> · {{ cruise.route }}</template> · tipo {{ legOf(cruise) }} ·
          {{ STATUS_LABEL[cruise.status] }}
        </p>
      </div>
      <div class="ins-nav">
        <select v-model="cruiseId" aria-label="Elegir crucero">
          <option v-for="c in sorted" :key="c.id" :value="c.id">{{ c.code }} · {{ cruiseRange(c) }}</option>
        </select>
      </div>
    </header>

    <SkeletonBlock v-if="loading" height="420px" />
    <p v-else-if="!cruise || !panel" class="ins-empty">Todavía no hay cruceros registrados.</p>
    <template v-else>
      <dl class="ins-kpis">
        <div>
          <dt>Pasajeros</dt>
          <dd>{{ cruise.passengers }}</dd>
          <small>{{ cruise.countries.length }} países</small>
        </div>
        <div>
          <dt>Consumo del bar</dt>
          <dd>{{ formatMoney(panel.netConsumption) }}</dd>
          <small>{{ cruise.passengers ? `${formatMoney(panel.netConsumption / cruise.passengers)} por pasajero` : '' }}</small>
        </div>
        <div>
          <dt>Cobrado</dt>
          <dd>{{ formatMoney(panel.collected) }}</dd>
          <small>pagos del crucero</small>
        </div>
        <div>
          <dt>Por cobrar</dt>
          <dd>{{ formatMoney(panel.pendingCollection) }}</dd>
          <small>{{ panel.details.pending.length }} cuenta(s) abierta(s)</small>
        </div>
        <div>
          <dt>Cortesías</dt>
          <dd>{{ formatMoney(panel.courtesy) }}</dd>
          <small>{{ panel.heldConsumptions }} retenido(s)</small>
        </div>
      </dl>

      <div class="ins-grid">
        <section class="ins-card ins-card--wide" aria-labelledby="c-days">
          <h3 id="c-days">Consumo durante el crucero</h3>
          <p class="ins-sub">Toca un día para ver qué se sirvió. Tócalo otra vez para volver a todo el crucero.</p>
          <ColumnChart
            :columns="days"
            :format="short"
            :selected="day"
            pickable
            label="Consumo del bar por día del crucero"
            @pick="day = day === $event ? '' : $event"
          />
        </section>

        <section class="ins-card" aria-labelledby="c-countries">
          <h3 id="c-countries">Países de los pasajeros</h3>
          <p class="ins-sub">{{ cruise.passengers }} pasajeros.</p>
          <OwnerBars
            :rows="
              topWithOthers(
                cruise.countries.map((k) => ({
                  label: k.country,
                  value: k.count,
                })),
                6,
              )
            "
            :format="count"
            tone="main"
            empty="Sin pasajeros registrados."
          />
        </section>

        <section class="ins-card ins-card--wide" aria-labelledby="c-served">
          <h3 id="c-served">
            {{ day ? `Lo servido el ${fmt(day, { day: 'numeric', month: 'long' })}` : 'Lo servido en el crucero' }}
          </h3>
          <p class="ins-sub">
            {{ served.length }} productos · {{ servedTotal.qty }} unidades ·
            {{ formatMoney(servedTotal.amount) }}
          </p>
          <div v-if="served.length" class="ins-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col" class="num">Unidades</th>
                  <th scope="col" class="num">Importe</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in served" :key="p.name">
                  <td>{{ p.name }}</td>
                  <td class="num">{{ p.qty }}</td>
                  <td class="num">{{ formatMoney(p.amount) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td class="num">{{ servedTotal.qty }}</td>
                  <td class="num">{{ formatMoney(servedTotal.amount) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p v-else class="ins-empty">No se sirvió nada {{ day ? 'ese día' : 'en este crucero' }}.</p>
          <p v-if="panel.details.truncated" class="ins-note">Crucero muy largo: el detalle muestra los últimos consumos.</p>
        </section>

        <section class="ins-card" aria-labelledby="c-top">
          <h3 id="c-top">Distribución por unidades</h3>
          <p class="ins-sub">{{ day ? 'Ese día' : 'Todo el crucero' }}.</p>
          <OwnerBars
            :rows="
              topWithOthers(
                served.map((p) => ({ label: p.name, value: p.qty })),
                7,
              )
            "
            :format="count"
            tone="main"
          />
        </section>

        <section class="ins-card" aria-labelledby="c-control">
          <h3 id="c-control">Control del viaje</h3>
          <p class="ins-sub">Lo que hay que revisar de este crucero.</p>
          <OwnerBars
            :rows="[
              { label: 'Cobrado', value: panel.collected },
              { label: 'Por cobrar', value: panel.pendingCollection },
              { label: 'Cortesías', value: panel.courtesy },
              { label: 'Compras recibidas', value: panel.purchases },
            ]"
            :format="money"
          />
          <p v-if="panel.missingCostCount" class="ins-note">
            {{ panel.missingCostCount }} producto(s) sin costo: el margen no se calcula hasta cargarlos.
          </p>
          <p v-if="panel.byBartender.length" class="ins-note">
            Atendió:
            {{ panel.byBartender.map((b) => `${b.name} (${formatMoney(b.total)})`).join(' · ') }}
          </p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use '@/components/owner/insights';
</style>
