<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { apiSalesByCruise, apiSalesSummary } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { useToastStore } from '@/stores/toast'
import { formatMoney, formatDate } from '@/utils/format'
import StatCard from '@/components/ui/StatCard.vue'
import BarList from '@/components/ui/BarList.vue'
import type { CruiseSales, SalesSummary } from '@/types'

type RangeKey = 'semana' | 'mes' | 'todo'

const toast = useToastStore()
const summary = shallowRef<SalesSummary | null>(null)
const byCruise = shallowRef<CruiseSales[]>([])
const range = shallowRef<RangeKey>('semana')

function rangeFrom(key: RangeKey): string | undefined {
  if (key === 'todo') return undefined
  const days = key === 'semana' ? 7 : 30
  const from = new Date()
  from.setDate(from.getDate() - days)
  return from.toISOString()
}

async function load() {
  try {
    const [sales, cruises] = await Promise.all([
      apiSalesSummary({ from: rangeFrom(range.value) }),
      apiSalesByCruise(),
    ])
    summary.value = sales
    byCruise.value = cruises
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

onMounted(load)

function setRange(key: RangeKey) {
  range.value = key
  load()
}

const dayRows = computed(
  () =>
    summary.value?.byDay.map((d) => ({
      label: formatDate(d.date),
      value: d.total,
      detail: `${d.orders} pedidos`,
    })) ?? [],
)

const userRows = computed(
  () =>
    summary.value?.byUser.map((u) => ({
      label: u.name,
      value: u.total,
      detail: `${u.orders} pedidos`,
    })) ?? [],
)

const productRows = computed(
  () =>
    summary.value?.topProducts.map((p) => ({
      label: p.name,
      value: p.qty,
      detail: formatMoney(p.total),
    })) ?? [],
)

const cruiseRows = computed(() =>
  byCruise.value.map((c) => ({
    label: `${c.name} (${formatDate(c.startDate)})`,
    value: c.collected,
    detail: `${c.payments} cobros`,
  })),
)
</script>

<template>
  <div class="page">
    <header class="dash-head">
      <h1 class="page-title">Panel</h1>
      <div class="range">
        <button
          v-for="key in ['semana', 'mes', 'todo'] as const"
          :key="key"
          type="button"
          class="range-btn"
          :class="{ 'range-btn--active': range === key }"
          @click="setRange(key)"
        >
          {{ key === 'semana' ? 'Semana' : key === 'mes' ? 'Mes' : 'Todo' }}
        </button>
      </div>
    </header>

    <div class="stats">
      <StatCard
        label="Ventas"
        :value="formatMoney(summary?.totals.total ?? 0)"
        :hint="`${summary?.totals.orders ?? 0} pedidos`"
      />
      <StatCard label="Pedidos" :value="String(summary?.totals.orders ?? 0)" />
    </div>

    <div class="panels">
      <section class="card">
        <h3 class="panel-title">Ventas por día</h3>
        <BarList :rows="dayRows" :format="formatMoney" />
      </section>

      <section class="card">
        <h3 class="panel-title">Ventas por persona</h3>
        <BarList :rows="userRows" :format="formatMoney" />
      </section>

      <section class="card">
        <h3 class="panel-title">Productos más vendidos</h3>
        <BarList :rows="productRows" />
      </section>

      <section class="card">
        <h3 class="panel-title">Recaudado por crucero</h3>
        <BarList :rows="cruiseRows" :format="formatMoney" />
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.dash-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1rem;

  .page-title {
    margin-bottom: 0;
  }
}

.range {
  display: flex;
  gap: 0.35rem;
  background: var(--cream-200);
  padding: 0.25rem;
  border-radius: 999px;
}

.range-btn {
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--ink-600);

  &--active {
    background: var(--navy-800);
    color: var(--cream-100);
  }
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
  margin-bottom: 1rem;

  @include tablet {
    max-width: 480px;
  }
}

.panels {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;

  @include tablet {
    grid-template-columns: repeat(2, 1fr);
  }
}

.panel-title {
  font-size: 0.9rem;
  margin-bottom: 0.75rem;
  color: var(--ink-600);
}
</style>
