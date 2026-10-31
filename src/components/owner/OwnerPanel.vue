<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseDatePicker from '@/components/ui/BaseDatePicker.vue'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'
import OwnerDetail, { type DetailKind } from '@/components/owner/OwnerDetail.vue'
import OwnerBars from '@/components/owner/OwnerBars.vue'
import { useToastStore } from '@/stores/toast'
import { apiCruises, apiOwnerPanel } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDate, formatDateTime, formatDayKey, formatMoney, formatTime, todayKey } from '@/utils/format'
import type { Cruise, OwnerAlert, OwnerPanel } from '@/types'

/**
 * Resumen del negocio (checklist 29-oct: 06, 08, 09, 10A, 10B y 11). Un solo
 * filtro, crucero o periodo, gobierna todas las cifras. Primero consumos del
 * bar, cobrado y por cobrar; después costo de lo servido y margen. Cada cifra
 * abre su detalle, que suma exactamente lo mostrado.
 */
type Mode = 'crucero' | 'periodo'
type Preset = 'hoy' | '7' | '30' | 'todo' | ''

const toast = useToastStore()
const router = useRouter()

const cruises = shallowRef<Cruise[]>([])
const mode = shallowRef<Mode>('crucero')
const cruiseId = shallowRef('')
const preset = shallowRef<Preset>('7')
const from = shallowRef('')
const to = shallowRef('')
const data = shallowRef<OwnerPanel | null>(null)
const loading = shallowRef(true)
const rangeError = shallowRef('')
const detail = shallowRef<DetailKind | null>(null)

const METHOD_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  online: 'Pago en línea',
}

const STATUS_LABEL: Record<string, string> = {
  planificado: 'programado',
  abordo: 'en curso',
  cerrado: 'finalizado',
}

const cruiseOptions = computed(() =>
  cruises.value.map((c) => ({
    value: c._id,
    label: `${c.code} · ${c.name}`,
    hint: `${formatDate(c.startDate)} · ${STATUS_LABEL[c.status] ?? c.status}`,
  })),
)

const PRESETS: Array<{ key: Exclude<Preset, ''>; label: string }> = [
  { key: 'hoy', label: 'Hoy' },
  { key: '7', label: '7 días' },
  { key: '30', label: '30 días' },
  { key: 'todo', label: 'Todo' },
]

function shiftKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function applyPreset(key: Exclude<Preset, ''>) {
  preset.value = key
  const today = todayKey()
  from.value = key === 'todo' ? '' : key === 'hoy' ? today : shiftKey(today, key === '7' ? -6 : -29)
  to.value = key === 'todo' ? '' : today
  load()
}

function setMode(next: Mode) {
  if (mode.value === next) return
  mode.value = next
  if (next === 'periodo' && !preset.value && !from.value && !to.value) preset.value = '7'
  if (next === 'periodo' && preset.value) applyPreset(preset.value)
  else load()
}

function onCruise(id: string) {
  cruiseId.value = id
  load()
}

function onDates() {
  preset.value = ''
  load()
}

const methods = computed(() =>
  Object.entries(data.value?.byMethod ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: METHOD_LABEL[k] ?? k, value: v })),
)

/** Alcance visible: qué entra en las cifras y hasta qué corte. */
const scopeText = computed(() => {
  const scope = data.value?.scope
  if (!scope) return ''
  const cut = formatDateTime(scope.cut)
  if (scope.mode === 'crucero' && scope.cruise) {
    const route = scope.cruise.route ? ` · ${scope.cruise.route}` : ''
    return `Crucero ${scope.cruise.code}${route} (${STATUS_LABEL[scope.cruise.status] ?? ''}). Consumos y pagos de este crucero hasta el corte (${cut}).`
  }
  if (scope.mode === 'periodo') {
    const start = scope.from ? `el ${formatDate(scope.from)}` : 'el inicio'
    return `Desde ${start} hasta el corte (${cut}). Consumos por su fecha de consumo y pagos por su fecha de pago, de todos los cruceros.`
  }
  return `Todo el historial hasta el corte (${cut}), de todos los cruceros.`
})

const purchaseScope = computed(() => {
  const scope = data.value?.scope
  if (!scope) return ''
  const start = scope.purchasesFrom ? formatDate(scope.purchasesFrom) : 'el inicio'
  return `Recibidas del ${start} al ${formatDate(scope.purchasesTo)}${scope.mode === 'crucero' ? ', fechas del crucero' : ''}.`
})

async function load() {
  rangeError.value = ''
  if (mode.value === 'periodo' && from.value && to.value && from.value > to.value) {
    rangeError.value = 'La fecha inicial es posterior a la final.'
    return
  }
  loading.value = true
  try {
    data.value = await apiOwnerPanel(
      mode.value === 'crucero'
        ? { cruiseId: cruiseId.value || undefined }
        : { from: from.value || undefined, to: to.value || undefined },
    )
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    const list = await apiCruises()
    // En curso primero, luego los iniciados más recientes.
    cruises.value = [
      ...list.filter((c) => c.status === 'abordo'),
      ...list.filter((c) => c.status === 'cerrado').reverse(),
      ...list.filter((c) => c.status === 'planificado'),
    ]
  } catch {
    // Sin cruceros: se usa el periodo.
  }
  const current = cruises.value.find((c) => c.status !== 'planificado')
  if (current) {
    cruiseId.value = current._id
    await load()
  } else {
    mode.value = 'periodo'
    applyPreset('7')
  }
})

const dayRows = computed(
  () => data.value?.byDay.map((d) => ({ label: formatDayKey(d.date), value: d.total, detail: `${d.orders} consumos` })) ?? [],
)
const bartenderRows = computed(
  () => data.value?.byBartender.map((u) => ({ label: u.name, value: u.total, detail: `${u.orders} consumos` })) ?? [],
)
const productRows = computed(
  () =>
    data.value?.topProducts.map((p) => ({
      label: p.name,
      value: p.qty,
      detail: `${formatMoney(p.total)}${p.courtesyQty ? ` · ${p.courtesyQty} cortesía` : ''}`,
    })) ?? [],
)
const cruiseRows = computed(
  () =>
    data.value?.byCruise.map((c) => ({
      label: c.startDate ? `${c.name} (${formatDate(c.startDate)})` : c.name,
      value: c.collected,
      detail: `${c.payments} pago(s)`,
    })) ?? [],
)

/** Parte de lo consumido que ya se cobró: solo si las tres cifras cuadran. */
const salesSplit = computed(() => {
  const d = data.value
  if (!d || d.netConsumption <= 0) return null
  if (Math.abs(d.collected + d.pendingCollection - d.netConsumption) > 0.005) return null
  const paid = (d.collected / d.netConsumption) * 100
  return {
    paid,
    due: 100 - paid,
    label: `Cobrado ${Math.round(paid)} % de los consumos · ${formatMoney(d.collected)} de ${formatMoney(d.netConsumption)}`,
  }
})

/** Costo y margen sobre la misma escala de Consumos, si ambos están disponibles. */
const marginSplit = computed(() => {
  const d = data.value
  if (!d || d.netConsumption <= 0 || d.consumedCost === null || d.margin === null || d.margin < 0) return null
  const cost = (d.consumedCost / d.netConsumption) * 100
  return {
    cost,
    margin: 100 - cost,
    label: `Costo ${Math.round(cost)} % · margen ${Math.round(100 - cost)} % de los consumos del bar`,
  }
})

const ALERT_ICON: Record<OwnerAlert['kind'], string> = {
  cuentas: 'fa-file-invoice-dollar',
  costos: 'fa-tag',
  conteos: 'fa-clipboard-list',
  facturas: 'fa-file-circle-exclamation',
  retenidos: 'fa-hourglass-half',
}

/** Cada alerta abre su detalle o la pantalla donde se resuelve. */
function act(alert: OwnerAlert) {
  if (alert.kind === 'costos') detail.value = 'costo'
  else if (alert.kind === 'cuentas') detail.value = 'porCobrar'
  else if (alert.kind === 'conteos') router.push({ path: '/admin/inventario', query: { tab: 'conteos' } })
  else if (alert.kind === 'facturas') router.push({ path: '/admin/pagos', query: { factura: 'pendiente' } })
  else openHeld()
}

/** Retenidos: se revisan en Cuentas (alerta y tarjeta llevan al mismo lugar). */
function openHeld() {
  router.push('/cuentas')
}
</script>

<template>
  <section class="owner" aria-label="Resumen del negocio">
    <!-- Un solo filtro para todo el resumen -->
    <div class="filters">
      <div class="mode" role="tablist" aria-label="Filtrar por">
        <button
          type="button"
          role="tab"
          class="mode-btn"
          :class="{ 'mode-btn--on': mode === 'crucero' }"
          :aria-selected="mode === 'crucero'"
          :disabled="!cruises.length"
          @click="setMode('crucero')"
        >
          <i class="fa-solid fa-ship" aria-hidden="true" /> Crucero
        </button>
        <button
          type="button"
          role="tab"
          class="mode-btn"
          :class="{ 'mode-btn--on': mode === 'periodo' }"
          :aria-selected="mode === 'periodo'"
          @click="setMode('periodo')"
        >
          <i class="fa-regular fa-calendar" aria-hidden="true" /> Periodo
        </button>
      </div>

      <Transition name="fade" mode="out-in">
        <div v-if="mode === 'crucero'" key="crucero" class="filter-cruise">
          <BaseSelect
            :model-value="cruiseId"
            :options="cruiseOptions"
            searchable
            placeholder="Elige un crucero"
            aria-label="Crucero"
            @update:model-value="onCruise"
          />
        </div>
        <div v-else key="periodo" class="period">
          <div class="presets" role="group" aria-label="Periodo rápido">
            <button
              v-for="p in PRESETS"
              :key="p.key"
              type="button"
              class="preset"
              :class="{ 'preset--on': preset === p.key }"
              :aria-pressed="preset === p.key"
              @click="applyPreset(p.key)"
            >
              {{ p.label }}
            </button>
          </div>
          <div class="dates">
            <div class="field">
              <label>Desde</label>
              <BaseDatePicker v-model="from" placeholder="Sin inicio" clearable @update:model-value="onDates" />
            </div>
            <div class="field">
              <label>Hasta</label>
              <BaseDatePicker v-model="to" placeholder="Hoy" clearable @update:model-value="onDates" />
            </div>
          </div>
        </div>
      </Transition>
      <p v-if="rangeError" class="range-error">{{ rangeError }}</p>
    </div>

    <div v-if="loading && !data" class="skeleton">
      <SkeletonBlock height="180px" />
      <SkeletonBlock height="120px" />
      <SkeletonBlock height="96px" />
    </div>

    <Transition v-else-if="data" name="fade" appear>
      <div class="content" :class="{ busy: loading }">
        <div class="scope">
          <p>{{ scopeText }}</p>
          <span class="updated">
            Actualizado {{ formatTime(data.scope.generatedAt) }}
            <button type="button" class="refresh" :disabled="loading" aria-label="Actualizar" @click="load">
              <i class="fa-solid fa-rotate" :class="{ 'fa-spin': loading }" aria-hidden="true" />
            </button>
          </span>
        </div>

        <!-- Alertas: solo incidencias existentes, con su acción -->
        <TransitionGroup v-if="data.alerts.length" name="fade" tag="ul" class="alerts" aria-label="Pendientes">
          <li v-for="alert in data.alerts" :key="alert.kind" class="alert">
            <i class="fa-solid" :class="ALERT_ICON[alert.kind]" aria-hidden="true" />
            <span class="alert-text">
              {{ alert.text }}<template v-if="alert.amount"> · {{ formatMoney(alert.amount) }}</template>
              <small v-if="alert.scope === 'total'">Pendientes en total, de todos los cruceros</small>
            </span>
            <button type="button" class="alert-action" @click="act(alert)">
              {{ alert.action }} <i class="fa-solid fa-arrow-right" aria-hidden="true" />
            </button>
          </li>
        </TransitionGroup>

        <!-- Ventas del bar: lo consumido, cuánto se cobró y cuánto falta -->
        <section class="panel ledger" aria-labelledby="ledger-title">
          <h2 id="ledger-title" class="panel-title">Ventas del bar</h2>
          <div class="figures">
            <button type="button" class="figure figure--lead" @click="detail = 'consumo'">
              <span class="figure-label">Consumos del bar</span>
              <span class="figure-value">{{ formatMoney(data.netConsumption) }}</span>
              <span class="figure-hint">Cargado a las cabinas, sin cortesías ni anulados.</span>
              <span class="figure-more">Ver detalle <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
            </button>
            <button type="button" class="figure" @click="detail = 'cobrado'">
              <span class="figure-label"><i class="dot dot--paid" aria-hidden="true" /> Cobrado</span>
              <span class="figure-value">{{ formatMoney(data.collected) }}</span>
              <span v-if="methods.length" class="figure-list">
                <span v-for="m in methods" :key="m.label">
                  <span>{{ m.label }}</span><span class="num">{{ formatMoney(m.value) }}</span>
                </span>
              </span>
              <span v-else class="figure-hint">Sin pagos en este alcance.</span>
              <span class="figure-more">Ver detalle <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
            </button>
            <button type="button" class="figure" @click="detail = 'porCobrar'">
              <span class="figure-label"><i class="dot dot--due" aria-hidden="true" /> Por cobrar</span>
              <span class="figure-value" :class="{ 'figure-value--zero': data.pendingCollection === 0 }">
                {{ formatMoney(data.pendingCollection) }}
              </span>
              <span class="figure-hint">
                Saldo al corte.
                <template v-if="data.pendingFromBefore > 0">
                  {{ formatMoney(data.pendingFromPeriod) }} de este periodo y {{ formatMoney(data.pendingFromBefore) }} de antes.
                </template>
              </span>
              <span class="figure-more">Ver detalle <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
            </button>
          </div>
          <!-- Solo cuando cuadra: Consumos = Cobrado + Por cobrar -->
          <div v-if="salesSplit" class="split" role="img" :aria-label="salesSplit.label">
            <span class="split-bar">
              <span class="split-part split-part--paid" :style="{ width: `${salesSplit.paid}%` }" />
              <span class="split-part split-part--due" :style="{ width: `${salesSplit.due}%` }" />
            </span>
            <span class="split-caption">{{ salesSplit.label }}</span>
          </div>
        </section>

        <!-- Costo de lo servido y margen -->
        <section class="panel" aria-labelledby="margin-title">
          <h2 id="margin-title" class="panel-title">Costo y margen</h2>
          <div class="figures figures--two">
            <button type="button" class="figure" @click="detail = 'costo'">
              <span class="figure-label"><i class="dot dot--cost" aria-hidden="true" /> Costo de lo servido</span>
              <template v-if="data.noConsumption">
                <span class="figure-value figure-value--zero">{{ formatMoney(0) }}</span>
                <span class="figure-hint">Sin consumos en este alcance.</span>
              </template>
              <template v-else-if="data.consumedCost !== null">
                <span class="figure-value">{{ formatMoney(data.consumedCost) }}</span>
                <span class="figure-hint">Insumos al costo histórico, incluidas las cortesías servidas.</span>
              </template>
              <template v-else>
                <span class="figure-value figure-value--missing">No disponible: faltan costos</span>
                <span class="figure-hint">
                  {{ data.missingCostCount ? `${data.missingCostCount} producto(s) sin costo.` : 'Aún no hay consumos en este alcance.' }}
                </span>
              </template>
              <span class="figure-more">Ver detalle <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
            </button>
            <button type="button" class="figure" @click="detail = 'margen'">
              <span class="figure-label"><i class="dot dot--margin" aria-hidden="true" /> Margen del bar</span>
              <span v-if="data.margin !== null" class="figure-value">{{ formatMoney(data.margin) }}</span>
              <span v-else class="figure-value figure-value--missing">No disponible: faltan costos</span>
              <span class="figure-hint">
                {{
                  data.noConsumption
                    ? 'Sin consumos en este alcance.'
                    : 'Consumos del bar − costo de lo servido. No es utilidad neta; mermas y ajustes van aparte.'
                }}
              </span>
              <span class="figure-more">Ver detalle <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
            </button>
          </div>
          <div v-if="marginSplit" class="split" role="img" :aria-label="marginSplit.label">
            <span class="split-bar">
              <span class="split-part split-part--cost" :style="{ width: `${marginSplit.cost}%` }" />
              <span class="split-part split-part--margin" :style="{ width: `${marginSplit.margin}%` }" />
            </span>
            <span class="split-caption">{{ marginSplit.label }}</span>
          </div>
        </section>

        <!-- Información secundaria -->
        <section class="panel panel--strip" aria-label="Otras cifras">
          <button type="button" class="figure figure--small" @click="detail = 'cortesias'">
            <span class="figure-label">Cortesías</span>
            <span class="figure-value" :class="{ 'figure-value--zero': data.courtesy === 0 }">{{ formatMoney(data.courtesy) }}</span>
            <span class="figure-hint">A precio de venta. No se cobran.</span>
          </button>
          <button type="button" class="figure figure--small" @click="detail = 'compras'">
            <span class="figure-label">Compras recibidas</span>
            <span class="figure-value" :class="{ 'figure-value--zero': data.purchases === 0 }">{{ formatMoney(data.purchases) }}</span>
            <span class="figure-hint">{{ purchaseScope }} No es el costo de lo servido.</span>
          </button>
          <!-- Abre los retenidos igual que su alerta (09) -->
          <button type="button" class="figure figure--small" @click="openHeld">
            <span class="figure-label">Consumos retenidos</span>
            <span class="figure-value" :class="{ 'figure-value--warn': data.heldConsumptions > 0, 'figure-value--zero': !data.heldConsumptions }">
              {{ data.heldConsumptions }}
            </span>
            <span class="figure-hint">
              Enviados tarde, pendientes de revisión.{{ data.pendingScope === 'total' ? ' Pendientes en total.' : '' }}
            </span>
            <span class="figure-more">Revisar en Cuentas <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
          </button>
        </section>

        <!-- Consumos (mismo filtro) -->
        <div class="lists">
          <section class="panel list-day">
            <h2 class="panel-title">Consumos por día</h2>
            <OwnerBars :rows="dayRows" :format="formatMoney" tone="main" />
          </section>
          <div class="list-side">
            <section class="panel">
              <h2 class="panel-title">Consumos por bartender</h2>
              <OwnerBars :rows="bartenderRows" :format="formatMoney" />
            </section>
            <section class="panel">
              <h2 class="panel-title">Cobrado por crucero</h2>
              <OwnerBars :rows="cruiseRows" :format="formatMoney" />
            </section>
          </div>
          <section class="panel list-products">
            <h2 class="panel-title">Productos más consumidos</h2>
            <OwnerBars :rows="productRows" :format="(v) => `${v} u.`" class="two-col" />
          </section>
        </div>
      </div>
    </Transition>

    <OwnerDetail v-if="detail && data" :kind="detail" :data="data" @close="detail = null" />
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

/*
 * Resumen: tinta en las cifras, azul profundo en la serie principal y en lo
 * cobrado, caramelo solo en el costo. Paneles blancos con borde de 1 px, sin
 * sombras en reposo; cada cifra es un botón que abre su detalle.
 */
.owner {
  --line: #dbe4eb;
  --line-strong: #c3d1dc;
  --muted: #55636d;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

// Filtro
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem 1rem;
}

.mode {
  display: inline-flex;
  flex: none;
  padding: 4px;
  border-radius: 999px;
  background: var(--powder-100);
}

.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 44px;
  padding: 0 1.1rem;
  border-radius: 999px;
  font-weight: 500;
  font-size: 1rem;
  color: var(--ink-600);
  transition:
    background 0.18s ease,
    color 0.18s ease;

  &--on {
    background: var(--navy-800);
    color: #fff;
  }

  &:disabled {
    opacity: 0.45;
  }
}

.filter-cruise {
  flex: 1 1 320px;
  max-width: 520px;
}

.period {
  flex: 1 1 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem 1rem;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.preset {
  @include touch-target;
  padding: 0 1rem;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-weight: 500;
  font-size: 1rem;
  color: var(--ink-900);
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    color 0.18s ease;

  &:hover:not(.preset--on) {
    border-color: var(--navy-600);
  }

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }
}

.dates {
  flex: 1 1 320px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  max-width: 480px;
}

.range-error {
  flex-basis: 100%;
  margin: 0;
  color: var(--danger);
  font-weight: 500;
}

.skeleton {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  transition: opacity 0.2s ease;

  &.busy {
    opacity: 0.55;
  }
}

.scope {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.25rem 1rem;
  font-size: 0.9375rem;
  color: var(--muted);

  p {
    flex: 1 1 360px;
    margin: 0;
  }
}

.updated {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.refresh {
  @include touch-target;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--navy-700);
  transition: background 0.18s ease;

  &:hover:not(:disabled) {
    background: var(--powder-100);
  }
}

// Alertas
.alerts {
  list-style: none;
  margin: 0;
  padding: 0 1rem;
  border-radius: var(--radius);
  background: #fbf5ec;
  border: 1px solid #ead7b8;
}

.alert {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  padding: 0.65rem 0;
  font-size: 1rem;
  color: #5c3f12;

  & + & {
    border-top: 1px solid #ead7b8;
  }

  > i {
    width: 1.25rem;
    color: #8a5d1d;
  }
}

.alert-text {
  flex: 1 1 220px;
  min-width: 0;

  small {
    display: block;
    font-size: 0.875rem;
    color: #6f5a3c;
  }
}

.alert-action {
  @include touch-target;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0 1rem;
  border-radius: var(--radius-sm);
  background: var(--surface);
  border: 1px solid #d9bf96;
  font-weight: 500;
  font-size: 0.9375rem;
  color: var(--navy-800);
  transition: border-color 0.18s ease;

  i {
    font-size: 0.8rem;
    transition: transform 0.18s ease;
  }

  &:hover {
    border-color: var(--navy-800);

    i {
      transform: translateX(2px);
    }
  }
}

// Paneles
.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1rem 1.25rem 1.25rem;
}

.panel-title {
  margin: 0 0 0.75rem;
  font-size: 1.1875rem;
  color: var(--ink-900);
}

.figures {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  margin: 0 -1.25rem;

  // En celular, Cobrado y Por cobrar quedan lado a lado bajo Consumos.
  &:not(.figures--two) {
    grid-template-columns: repeat(2, minmax(0, 1fr));

    .figure--lead {
      grid-column: 1 / -1;
    }

    .figure:nth-child(3) {
      border-left: 1px solid var(--line);
    }
  }

  @include tablet {
    &:not(.figures--two) {
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) minmax(0, 1fr);

      .figure--lead {
        grid-column: auto;
      }
    }
  }

  &--two {
    @include tablet {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
}

.figure {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.3rem;
  min-width: 0;
  padding: 0.75rem 1.25rem;
  text-align: left;
  border-top: 1px solid var(--line);
  transition: background 0.18s ease;

  &:first-child {
    border-top: 0;
  }

  @include tablet {
    border-top: 0;

    & + & {
      border-left: 1px solid var(--line);
    }
  }

  &:hover {
    background: #f7fafc;
  }

  &:hover .figure-more i {
    transform: translateX(3px);
  }

  &:focus-visible {
    outline: 2px solid var(--navy-700);
    outline-offset: -2px;
  }
}

.figure-label {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.9375rem;
  color: var(--muted);
}

.figure-value {
  font-size: 1.5rem;
  line-height: 1.15;
  font-weight: 600;
  color: var(--ink-900);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;

  .figure--lead & {
    font-size: 2rem;
    color: var(--navy-800);
  }

  &--zero {
    color: var(--muted);
  }

  &--warn {
    color: #8a5d1d;
  }

  &--missing {
    font-size: 1.0625rem;
    font-weight: 500;
    color: #8a5d1d;
  }
}

.figure-hint {
  font-size: 0.875rem;
  color: var(--muted);
}

.figure-list {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.9375rem;

  > span {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    color: var(--ink-600);
  }

  .num {
    color: var(--ink-900);
    font-variant-numeric: tabular-nums;
  }
}

.figure-more {
  margin-top: auto;
  padding-top: 0.4rem;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--navy-700);

  i {
    font-size: 0.7rem;
    transition: transform 0.18s ease;
  }
}

.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;

  &--paid {
    background: var(--navy-700);
  }

  &--due {
    background: var(--powder-300);
  }

  &--cost {
    background: var(--gold-500);
  }

  &--margin {
    background: var(--navy-700);
  }
}

// Barra que reparte el total entre sus partes (misma escala que Consumos)
.split {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.75rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--line);
}

.split-bar {
  display: flex;
  gap: 2px;
  height: 12px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--powder-100);
}

.split-part {
  display: block;
  height: 100%;
  transition: width 0.4s ease;

  &--paid,
  &--margin {
    background: var(--navy-700);
  }

  &--due {
    background: var(--powder-300);
  }

  &--cost {
    background: var(--gold-500);
  }
}

.split-caption {
  font-size: 0.875rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.panel--strip {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  padding: 0;

  @include tablet {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .figure {
    padding: 1rem 1.25rem;
  }
}

.figure--small .figure-value {
  font-size: 1.25rem;
}

// Por día junto a bartender y cruceros (apilados); productos a todo el ancho
// en dos columnas, para que la fila no quede dispareja.
.lists {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;

  @include tablet {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.list-side {
  display: flex;
  flex-direction: column;
  gap: 1rem;

  > .panel:last-child {
    flex: 1;
  }
}

.list-products {
  @include tablet {
    grid-column: 1 / -1;
  }
}

.two-col {
  @include tablet {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 2.5rem;
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
