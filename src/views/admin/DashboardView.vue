<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BarSummary from '@/components/summary/BarSummary.vue'
import OperationSummary from '@/components/summary/OperationSummary.vue'
import GoalsModal from '@/components/summary/GoalsModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'
import {
  apiBarSummary,
  apiCruises,
  apiOperationSummary,
  type BarSummary as BarData,
  type OperationSummary as OperationData,
  type SummaryPeriodKind,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { useToastStore } from '@/stores/toast'
import { todayKey } from '@/utils/format'
import { fmt, monthTitle } from '@/components/owner/insights'
import type { Cruise } from '@/types'

/**
 * Resumen de Gerencia (especificación del 24-nov-2026): dos vistas, Bar (solo
 * Gerencia) y Operación (sin dinero, se exporta en PDF para los socios), y un
 * filtro de período Año · Mes · Crucero. Todo va en la URL:
 * /admin?vista=bar&periodo=mes&valor=2026-11
 */
const route = useRoute()
const router = useRouter()
const toast = useToastStore()

type View = 'bar' | 'operacion'
const view = computed<View>(() => (route.query.vista === 'operacion' ? 'operacion' : 'bar'))
const periodo = computed<SummaryPeriodKind>(() =>
  route.query.periodo === 'mes' || route.query.periodo === 'crucero' ? route.query.periodo : 'ano',
)
const valor = computed(() => {
  const v = String(route.query.valor ?? '')
  if (periodo.value === 'ano') return /^\d{4}$/.test(v) ? v : todayKey().slice(0, 4)
  if (periodo.value === 'mes') return /^\d{4}-\d{2}$/.test(v) ? v : todayKey().slice(0, 7)
  return v
})

function go(next: { vista?: View; periodo?: SummaryPeriodKind; valor?: string }) {
  const p = next.periodo ?? periodo.value
  void router.replace({
    query: {
      vista: next.vista ?? view.value,
      periodo: p,
      valor: next.valor ?? (p === periodo.value ? valor.value : defaultValue(p)),
    },
    hash: '',
  })
}

const cruises = shallowRef<Cruise[]>([])
function defaultValue(p: SummaryPeriodKind) {
  if (p === 'ano') return todayKey().slice(0, 4)
  if (p === 'mes') return todayKey().slice(0, 7)
  return (cruises.value.find((c) => c.status === 'abordo') ?? cruises.value.find((c) => c.status === 'cerrado'))?._id ?? ''
}

function shift(delta: number) {
  if (periodo.value === 'ano') go({ valor: String(Number(valor.value) + delta) })
  else if (periodo.value === 'mes') {
    const [y, m] = valor.value.split('-').map(Number)
    go({ valor: new Date(Date.UTC(y!, m! - 1 + delta, 1)).toISOString().slice(0, 7) })
  }
}

/** Buscador de cruceros por código, con su año al lado. */
const cruiseOptions = computed(() =>
  cruises.value
    .filter((c) => c.status !== 'planificado')
    .map((c) => ({ value: c._id, label: `${c.code} · ${fmt(c.startDate, { day: 'numeric', month: 'short', year: 'numeric' })}` })),
)

const bar = shallowRef<BarData | null>(null)
const op = shallowRef<OperationData | null>(null)
const loading = shallowRef(true)
let seq = 0

async function load() {
  const mine = ++seq
  loading.value = true
  try {
    if (view.value === 'bar') {
      const data = await apiBarSummary(periodo.value, valor.value)
      if (mine === seq) bar.value = data
    } else {
      const data = await apiOperationSummary(periodo.value, valor.value)
      if (mine === seq) op.value = data
    }
  } catch (err) {
    if (mine === seq) toast.error(apiErrorMessage(err))
  } finally {
    if (mine === seq) loading.value = false
  }
}

onMounted(async () => {
  try {
    cruises.value = (await apiCruises()).sort((a, b) => b.startDate.localeCompare(a.startDate))
  } catch {
    // Sin la lista, el selector de crucero queda vacío; el resto funciona.
  }
})
watch(() => [view.value, periodo.value, valor.value], load, { immediate: true })

const periodLabel = computed(() => {
  if (periodo.value === 'ano') return valor.value
  if (periodo.value === 'mes') return monthTitle(valor.value)
  return (view.value === 'bar' ? bar.value?.period.label : op.value?.period.label) ?? 'Crucero'
})

const goalsOpen = shallowRef(false)

function exportPdf() {
  // El navegador guarda la vista Operación como PDF (sin el menú de la app).
  document.title = `Operación ${periodLabel.value} · Treasure of Galápagos`
  window.print()
}
</script>

<template>
  <div class="page summary-page">
    <header class="dash-head">
      <div>
        <h1 class="page-title">Resumen · {{ view === 'bar' ? 'Bar' : 'Operación' }}</h1>
        <p class="subtitle">
          {{ view === 'bar' ? 'Solo Gerencia. Qué pasó, si está bien o mal y qué hacer.' : 'Pasajeros, ocupación, nacionalidades y días operados. Sin dinero: se exporta en PDF para los socios.' }}
        </p>
      </div>
      <div class="head-actions no-print">
        <button v-if="view === 'bar'" type="button" class="btn btn-secondary" @click="goalsOpen = true">
          <i class="fa-solid fa-bullseye" aria-hidden="true" /> Metas
        </button>
        <button v-else type="button" class="btn btn-primary" :disabled="loading" @click="exportPdf">
          <i class="fa-solid fa-file-pdf" aria-hidden="true" /> Exportar PDF
        </button>
      </div>
    </header>

    <div class="controls no-print">
      <nav class="segs" aria-label="Vista">
        <button type="button" class="segs-item" :class="{ 'segs-item--on': view === 'bar' }" :aria-current="view === 'bar' ? 'page' : undefined" @click="go({ vista: 'bar' })">
          <i class="fa-solid fa-martini-glass-citrus" aria-hidden="true" /> Bar
        </button>
        <button type="button" class="segs-item" :class="{ 'segs-item--on': view === 'operacion' }" :aria-current="view === 'operacion' ? 'page' : undefined" @click="go({ vista: 'operacion' })">
          <i class="fa-solid fa-ship" aria-hidden="true" /> Operación
        </button>
      </nav>

      <div class="period">
        <div class="segs segs--small" role="group" aria-label="Período">
          <button v-for="p in (['ano', 'mes', 'crucero'] as const)" :key="p" type="button" class="segs-item" :class="{ 'segs-item--on': periodo === p }" :aria-pressed="periodo === p" @click="go({ periodo: p })">
            {{ p === 'ano' ? 'Año' : p === 'mes' ? 'Mes' : 'Crucero' }}
          </button>
        </div>
        <div v-if="periodo !== 'crucero'" class="stepper" role="group" :aria-label="periodo === 'ano' ? 'Año' : 'Mes'">
          <button type="button" class="icon-btn" :aria-label="periodo === 'ano' ? 'Año anterior' : 'Mes anterior'" @click="shift(-1)">
            <i class="fa-solid fa-chevron-left" aria-hidden="true" />
          </button>
          <strong aria-live="polite">{{ periodLabel }}</strong>
          <button type="button" class="icon-btn" :aria-label="periodo === 'ano' ? 'Año siguiente' : 'Mes siguiente'" @click="shift(1)">
            <i class="fa-solid fa-chevron-right" aria-hidden="true" />
          </button>
        </div>
        <div v-else class="cruise-pick">
          <BaseSelect
            :model-value="(view === 'bar' ? bar?.cruise?.id : op?.cruise?.id) ?? valor"
            :options="cruiseOptions"
            searchable
            placeholder="Buscar crucero por código…"
            aria-label="Crucero"
            @update:model-value="go({ valor: String($event) })"
          />
        </div>
      </div>
    </div>

    <h2 class="print-only">Resumen · Operación · {{ periodLabel }}</h2>

    <SkeletonBlock v-if="loading && !(view === 'bar' ? bar : op)" height="520px" />
    <div v-else :class="{ busy: loading }">
      <BarSummary v-if="view === 'bar' && bar" :data="bar" @reload="load" @period="(p, v) => go({ periodo: p, valor: v })" />
      <OperationSummary v-else-if="view === 'operacion' && op" :data="op" @period="(p, v) => go({ periodo: p, valor: v })" />
    </div>

    <GoalsModal v-if="goalsOpen" @close="goalsOpen = false" @saved="goalsOpen = false; load()" />
  </div>
</template>

<style scoped lang="scss">
.dash-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  margin-bottom: 1rem;

  .page-title {
    margin-bottom: 0.15rem;
  }
}

.subtitle {
  margin: 0;
  font-size: 1rem;
  color: var(--ink-600);
}

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  margin-bottom: 1.25rem;
}

.period {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 0.75rem;
}

.stepper {
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

.cruise-pick {
  min-width: 260px;
}

.busy {
  opacity: 0.6;
  transition: opacity 0.2s ease;
}

.print-only {
  display: none;
}

@media print {
  .no-print {
    display: none !important;
  }

  .print-only {
    display: block;
    margin: 0 0 0.75rem;
    font-size: 1.2rem;
  }
}
</style>

<style lang="scss">
/* PDF de la vista Operación: solo el contenido, sin el menú de la app. */
@media print {
  .topbar,
  .topnav-wrap,
  .sidenav,
  .masthead,
  .order-notice,
  .viewing-as {
    display: none !important;
  }

  body,
  .shell,
  .body,
  .content {
    background: #fff !important;
    padding: 0 !important;
    margin: 0 !important;
  }

  .ins-card,
  .ins-kpis > div {
    break-inside: avoid;
  }

  * {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
</style>
