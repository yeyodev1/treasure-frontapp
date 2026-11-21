<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import { useToastStore } from '@/stores/toast'
import { apiCount, apiCounts, apiWeeklyOrder, apiWeeklyOrderCurrent } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime, formatNumber } from '@/utils/format'
import type { StockCount } from '@/types'

/**
 * Control de BAR - STOCK (pedido del cliente, 19-nov-2026): diferencias entre
 * lo calculado por el sistema y lo que contó el bar, y el historial de
 * solicitudes, aprobaciones, envíos y recepciones. Lo usan la directora,
 * Tierra (auditoría) y Gerencia.
 */
const toast = useToastStore()

const counts = shallowRef<StockCount[]>([])
const count = shallowRef<StockCount | null>(null)
const events = shallowRef<Array<{ at: string; byName: string; action: string; detail: string; code: string }>>([])
const loading = shallowRef(true)
const all = shallowRef(false)

async function openCount(id: string) {
  try {
    count.value = await apiCount(id)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

async function load() {
  loading.value = true
  try {
    const [list, current] = await Promise.all([apiCounts(), apiWeeklyOrderCurrent()])
    counts.value = list.filter((c) => c.location === 'abordo' && c.status === 'aprobado')
    const full = await Promise.all(current.others.map((o) => apiWeeklyOrder(o._id)))
    events.value = [...(current.order ? [current.order] : []), ...full]
      .flatMap((o) => o.history.map((h) => ({ ...h, code: o.code })))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 60)
    if (counts.value[0]) await openCount(counts.value[0]._id)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** En envases (botellas), que es como cuenta el bar. */
const env = (base: number, size?: number) => base / (size || 1)
const rows = computed(() =>
  (count.value?.lines ?? [])
    .filter((l) => l.physical !== null)
    .map((l) => {
      const calc = env(l.digitalAtCut, l.containerSize)
      const real = env(l.physical!, l.containerSize)
      return { name: l.name, label: l.containerLabel || '', calc, real, diff: Math.round((real - calc) * 100) / 100 }
    })
    .filter((r) => all.value || r.diff !== 0)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)),
)
const n = (v: number) => formatNumber(Math.round(v * 100) / 100)
</script>

<template>
  <div class="control">
    <SkeletonList v-if="loading" :rows="5" />
    <template v-else>
      <section class="card" aria-label="Diferencias de inventario">
        <header class="head">
          <h3>Diferencias de inventario</h3>
          <select
            v-if="counts.length"
            :value="count?._id"
            aria-label="Conteo"
            @change="openCount(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="c in counts" :key="c._id" :value="c._id">
              {{ formatDateTime(c.reviewedAt ?? c.createdAt) }} · {{ c.code }} · {{ c.differences ?? 0 }} diferencia(s)
            </option>
          </select>
        </header>
        <p v-if="!counts.length" class="muted">Todavía no hay conteos del barco. El primero se guarda cuando el bar envíe su pedido.</p>
        <template v-else-if="count">
          <p class="muted">
            Contó {{ count.submittedBy?.name ?? count.createdBy?.name }} el {{ formatDateTime(count.reviewedAt ?? count.createdAt) }} ·
            <b>Calculado</b> es lo que el sistema tenía con entradas y consumos registrados; <b>Contado</b> es lo que había de verdad.
          </p>
          <label class="toggle"><input v-model="all" type="checkbox" /> Ver también lo que coincidió</label>
          <p v-if="!rows.length" class="muted">Todo lo contado coincidió con el sistema.</p>
          <div v-else class="table-wrap">
            <table>
              <thead>
                <tr><th scope="col">Producto</th><th scope="col">Calculado</th><th scope="col">Contado</th><th scope="col">Diferencia</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in rows" :key="r.name">
                  <th scope="row">{{ r.name }}</th>
                  <td>{{ n(r.calc) }}</td>
                  <td>{{ n(r.real) }}</td>
                  <td :class="{ minus: r.diff < 0, plus: r.diff > 0 }">{{ r.diff > 0 ? '+' : '' }}{{ n(r.diff) }} {{ r.label }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>

      <section class="card" aria-label="Historial de pedidos">
        <h3>Historial de pedidos</h3>
        <p v-if="!events.length" class="muted">Sin movimientos todavía.</p>
        <ol v-else class="events">
          <li v-for="(e, i) in events" :key="i">
            <span class="when">{{ formatDateTime(e.at) }}</span>
            <span><b>{{ e.code }}</b> · {{ e.action }} · {{ e.byName }}</span>
            <small v-if="e.detail">{{ e.detail }}</small>
          </li>
        </ol>
      </section>
    </template>
  </div>
</template>

<style scoped lang="scss">
.control {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

h3 {
  margin: 0;
  font-size: 1.1rem;
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin-bottom: 0.5rem;

  select {
    min-height: 44px;
    max-width: 100%;
    padding: 0 0.6rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink-900);
  }
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0.5rem 0;
  color: var(--ink-600);
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;

  th,
  td {
    padding: 0.55rem 0.6rem;
    border-bottom: 1px solid var(--line);
    text-align: right;
    white-space: nowrap;
  }

  th:first-child {
    text-align: left;
    white-space: normal;
  }

  thead th {
    font-size: 0.82rem;
    color: var(--ink-600);
  }

  .minus {
    color: var(--danger-ink);
    font-weight: 600;
  }

  .plus {
    color: var(--success-ink);
    font-weight: 600;
  }
}

.events {
  list-style: none;
  margin: 0.6rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;

  li {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .when {
    font-size: 0.8rem;
    color: var(--ink-400);
  }

  small {
    color: var(--ink-600);
  }
}
</style>
