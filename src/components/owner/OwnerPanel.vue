<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseDatePicker from '@/components/ui/BaseDatePicker.vue'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'
import { useToastStore } from '@/stores/toast'
import { apiCruises, apiOwnerPanel } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDate, formatMoney } from '@/utils/format'
import type { Cruise, OwnerPanel } from '@/types'

/**
 * Panel de la dueña: separa lo consumido, lo cobrado y lo pendiente,
 * y las compras aparte del costo de lo consumido.
 */
const toast = useToastStore()

const cruises = shallowRef<Cruise[]>([])
const cruiseId = shallowRef('')
const from = shallowRef('')
const to = shallowRef('')
const data = shallowRef<OwnerPanel | null>(null)
const loading = shallowRef(true)
const rangeError = shallowRef('')

const METHOD_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  online: 'En línea',
}

const STATUS_LABEL: Record<string, string> = {
  planificado: 'Programada',
  abordo: 'En curso',
  cerrado: 'Finalizada',
}

const cruiseOptions = computed(() => [
  { value: '', label: 'Todas las salidas' },
  ...cruises.value.map((c) => ({
    value: c._id,
    label: `${c.code} · ${c.name}`,
    hint: `${formatDate(c.startDate)} · ${STATUS_LABEL[c.status] ?? c.status}`,
  })),
])

const methods = computed(() =>
  Object.entries(data.value?.byMethod ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: METHOD_LABEL[k] ?? k, value: v })),
)

const missingExtra = computed(() =>
  data.value ? Math.max(0, data.value.missingCostCount - data.value.missingCost.length) : 0,
)

async function load() {
  rangeError.value = ''
  if (from.value && to.value && from.value > to.value) {
    rangeError.value = 'La fecha inicial es posterior a la final.'
    return
  }
  loading.value = true
  try {
    data.value = await apiOwnerPanel({
      cruiseId: cruiseId.value || undefined,
      from: from.value ? `${from.value}T00:00:00-05:00` : undefined,
      to: to.value ? `${to.value}T23:59:59.999-05:00` : undefined,
    })
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    cruises.value = await apiCruises()
  } catch {
    // Sin salidas en el filtro: se ve el total.
  }
  await load()
})

watch([cruiseId, from, to], load)

const hasFilters = computed(() => Boolean(cruiseId.value || from.value || to.value))

function clearFilters() {
  cruiseId.value = ''
  from.value = ''
  to.value = ''
}
</script>

<template>
  <section class="owner" aria-label="Panel de la dueña">
    <header class="owner-head">
      <h2><i class="fa-solid fa-gem" aria-hidden="true" /> Panel de la dueña</h2>
      <p>Consumos, cobros y costos por separado. Las compras no son el costo de lo consumido.</p>
    </header>

    <div class="card filters">
      <div class="field filter-cruise">
        <label>Salida</label>
        <BaseSelect v-model="cruiseId" :options="cruiseOptions" searchable placeholder="Todas las salidas" />
      </div>
      <div class="field">
        <label>Desde</label>
        <BaseDatePicker v-model="from" placeholder="Sin inicio" clearable />
      </div>
      <div class="field">
        <label>Hasta</label>
        <BaseDatePicker v-model="to" placeholder="Hoy" clearable />
      </div>
      <Transition name="fade">
        <button v-if="hasFilters" type="button" class="btn btn-ghost clear" @click="clearFilters">
          <i class="fa-solid fa-filter-circle-xmark" aria-hidden="true" /> Quitar filtros
        </button>
      </Transition>
      <p v-if="rangeError" class="range-error">{{ rangeError }}</p>
    </div>

    <div v-if="loading && !data" class="grid">
      <SkeletonBlock v-for="i in 8" :key="i" height="120px" />
    </div>

    <Transition v-else-if="data" name="fade" appear>
      <div class="grid" :class="{ busy: loading }">
        <article class="card kpi">
          <p class="kpi-label">Consumos netos</p>
          <p class="kpi-value">{{ formatMoney(data.netConsumption) }}</p>
          <p class="kpi-hint">Lo cargado a cabinas, sin cortesías ni anulados.</p>
        </article>

        <article class="card kpi">
          <p class="kpi-label">Cortesías</p>
          <p class="kpi-value">{{ formatMoney(data.courtesy) }}</p>
          <p class="kpi-hint">Valor a precio de venta de lo bonificado.</p>
        </article>

        <article class="card kpi">
          <p class="kpi-label">Cobrado</p>
          <p class="kpi-value kpi-value--ok">{{ formatMoney(data.collected) }}</p>
          <ul v-if="methods.length" class="kpi-list">
            <li v-for="m in methods" :key="m.label">
              <span>{{ m.label }}</span><strong>{{ formatMoney(m.value) }}</strong>
            </li>
          </ul>
          <p v-else class="kpi-hint">Sin cobros en el periodo.</p>
        </article>

        <article class="card kpi">
          <p class="kpi-label">Por cobrar</p>
          <p class="kpi-value" :class="{ 'kpi-value--warn': data.pendingCollection > 0 }">
            {{ formatMoney(data.pendingCollection) }}
          </p>
          <p class="kpi-hint">Consumos sin pago registrado.</p>
        </article>

        <article class="card kpi">
          <p class="kpi-label">Compras recibidas</p>
          <p class="kpi-value">{{ formatMoney(data.purchases) }}</p>
          <p class="kpi-hint">Mercadería que llegó en el periodo. Va aparte del costo consumido.</p>
        </article>

        <article class="card kpi">
          <p class="kpi-label">Costo consumido</p>
          <p class="kpi-value">{{ formatMoney(data.consumedCost) }}</p>
          <p class="kpi-hint">Costo de los insumos que salieron en cada consumo.</p>
        </article>

        <article class="card kpi kpi--margin" :class="{ 'kpi--incomplete': !data.costsComplete }">
          <p class="kpi-label">Margen bruto estimado</p>
          <template v-if="data.costsComplete && data.margin !== null">
            <p class="kpi-value">{{ formatMoney(data.margin) }}</p>
            <p class="kpi-hint">Consumos netos − costo consumido.</p>
          </template>
          <template v-else>
            <p class="kpi-value kpi-value--warn">Costos incompletos</p>
            <p v-if="!data.missingCostCount" class="kpi-hint">Aún no hay consumos en el periodo para calcularlo.</p>
            <template v-else>
              <p class="kpi-hint">Falta el costo de estos productos. Regístralo en sus compras para ver el margen:</p>
              <ul class="missing">
                <li v-for="name in data.missingCost" :key="name">{{ name }}</li>
                <li v-if="missingExtra" class="more">y {{ missingExtra }} más</li>
              </ul>
            </template>
          </template>
        </article>

        <article class="card kpi">
          <p class="kpi-label">Consumos retenidos</p>
          <p class="kpi-value" :class="{ 'kpi-value--warn': data.heldConsumptions > 0 }">
            {{ data.heldConsumptions }}
          </p>
          <p class="kpi-hint">Envíos tardíos esperando la revisión de la directora.</p>
        </article>
      </div>
    </Transition>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.owner {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  margin-bottom: 1.75rem;
}

.owner-head {
  h2 {
    font-size: 1.3rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;

    i {
      color: var(--gold-500);
      font-size: 1rem;
    }
  }

  p {
    margin: 0.2rem 0 0;
    color: var(--ink-400);
    font-size: 0.9rem;
  }
}

.filters {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
  align-items: end;

  @include tablet {
    grid-template-columns: 2fr 1fr 1fr;
  }
}

.clear {
  justify-self: start;

  @include tablet {
    grid-column: 1 / -1;
  }
}

.range-error {
  margin: 0;
  color: var(--danger);
  font-weight: 600;
  grid-column: 1 / -1;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
  transition: opacity 0.2s ease;

  @include tablet {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }

  &.busy {
    opacity: 0.55;
  }
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.kpi-label {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-400);
}

.kpi-value {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 800;
  color: var(--navy-800);
  font-variant-numeric: tabular-nums;

  &--ok {
    color: var(--success);
  }

  &--warn {
    color: #8a5d1d;
  }
}

.kpi-hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--ink-400);
}

.kpi-list {
  list-style: none;
  margin: 0.2rem 0 0;
  padding: 0.4rem 0 0;
  border-top: 1px solid var(--cream-200);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.86rem;

  li {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    color: var(--ink-600);
  }
}

.kpi--incomplete .kpi-value {
  font-size: 1.25rem;
}

.missing {
  margin: 0.2rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.85rem;
  color: var(--ink-600);
  max-height: 140px;
  overflow-y: auto;

  .more {
    list-style: none;
    margin-left: -1.1rem;
    color: var(--ink-400);
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
</style>
