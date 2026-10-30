<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseDatePicker from '@/components/ui/BaseDatePicker.vue'
import BarList from '@/components/ui/BarList.vue'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'
import OwnerDetail, { type DetailKind } from '@/components/owner/OwnerDetail.vue'
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
    return `Crucero ${scope.cruise.code}${route} (${STATUS_LABEL[scope.cruise.status] ?? ''}). Consumos y pagos de este crucero hasta el corte del ${cut}.`
  }
  if (scope.mode === 'periodo') {
    const start = scope.from ? formatDate(scope.from) : 'el inicio'
    return `Del ${start} al corte del ${cut}. Consumos por su fecha de consumo y pagos por su fecha de pago, de todos los cruceros.`
  }
  return `Todo el historial hasta el corte del ${cut}, de todos los cruceros.`
})

const purchaseScope = computed(() => {
  const scope = data.value?.scope
  if (!scope) return ''
  const start = scope.purchasesFrom ? formatDate(scope.purchasesFrom) : 'el inicio'
  return `Recepciones del ${start} al ${formatDate(scope.purchasesTo)}${scope.mode === 'crucero' ? ' (fechas del crucero: las compras no pertenecen a un crucero)' : ''}.`
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
      detail: `${c.payments} pagos`,
    })) ?? [],
)

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
  else router.push('/cuentas')
}
</script>

<template>
  <section class="owner" aria-label="Resumen del negocio">
    <!-- Un solo filtro para todo el resumen -->
    <div class="card filters">
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
        <div v-if="mode === 'crucero'" key="crucero" class="field filter-cruise">
          <label>Crucero</label>
          <BaseSelect :model-value="cruiseId" :options="cruiseOptions" searchable placeholder="Elige un crucero" @update:model-value="onCruise" />
        </div>
        <div v-else key="periodo" class="period">
          <div class="presets">
            <button
              v-for="p in PRESETS"
              :key="p.key"
              type="button"
              class="preset"
              :class="{ 'preset--on': preset === p.key }"
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

    <div v-if="loading && !data" class="grid">
      <SkeletonBlock v-for="i in 5" :key="i" height="120px" />
    </div>

    <Transition v-else-if="data" name="fade" appear>
      <div class="content" :class="{ busy: loading }">
        <p class="scope">
          <i class="fa-solid fa-circle-info" aria-hidden="true" />
          <span>{{ scopeText }}</span>
          <span class="updated">
            Actualizado {{ formatTime(data.scope.generatedAt) }}
            <button type="button" class="refresh" :disabled="loading" aria-label="Actualizar" @click="load">
              <i class="fa-solid fa-rotate" :class="{ 'fa-spin': loading }" aria-hidden="true" />
            </button>
          </span>
        </p>

        <!-- Alertas: solo incidencias existentes, con su acción -->
        <TransitionGroup v-if="data.alerts.length" name="fade" tag="ul" class="alerts">
          <li v-for="alert in data.alerts" :key="alert.kind" class="alert">
            <i class="fa-solid" :class="ALERT_ICON[alert.kind]" aria-hidden="true" />
            <span>
              {{ alert.text }}<template v-if="alert.amount"> · {{ formatMoney(alert.amount) }}</template>
            </span>
            <button type="button" class="alert-action" @click="act(alert)">
              {{ alert.action }} <i class="fa-solid fa-arrow-right" aria-hidden="true" />
            </button>
          </li>
        </TransitionGroup>

        <!-- Cifras principales, en orden -->
        <div class="grid grid--main">
          <button type="button" class="card kpi" @click="detail = 'consumo'">
            <span class="kpi-label">Consumos del bar</span>
            <span class="kpi-value">{{ formatMoney(data.netConsumption) }}</span>
            <span class="kpi-hint">Cargado a las cabinas, sin cortesías ni anulados.</span>
            <span class="kpi-more">Ver detalle <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
          </button>

          <button type="button" class="card kpi" @click="detail = 'cobrado'">
            <span class="kpi-label">Cobrado</span>
            <span class="kpi-value kpi-value--ok">{{ formatMoney(data.collected) }}</span>
            <span v-if="methods.length" class="kpi-list">
              <span v-for="m in methods" :key="m.label">
                <span>{{ m.label }}</span><strong>{{ formatMoney(m.value) }}</strong>
              </span>
            </span>
            <span v-else class="kpi-hint">Sin pagos en este alcance.</span>
            <span class="kpi-more">Ver detalle <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
          </button>

          <button type="button" class="card kpi" @click="detail = 'porCobrar'">
            <span class="kpi-label">Por cobrar</span>
            <span class="kpi-value" :class="{ 'kpi-value--warn': data.pendingCollection > 0 }">
              {{ formatMoney(data.pendingCollection) }}
            </span>
            <span class="kpi-hint">
              Saldo al corte.
              <template v-if="data.pendingFromBefore > 0">
                {{ formatMoney(data.pendingFromPeriod) }} de este periodo y {{ formatMoney(data.pendingFromBefore) }} de antes.
              </template>
            </span>
            <span class="kpi-more">Ver detalle <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
          </button>

          <button type="button" class="card kpi" :class="{ 'kpi--incomplete': data.consumedCost === null }" @click="detail = 'costo'">
            <span class="kpi-label">Costo de lo servido</span>
            <template v-if="data.consumedCost !== null">
              <span class="kpi-value">{{ formatMoney(data.consumedCost) }}</span>
              <span class="kpi-hint">Insumos al costo histórico, incluidas las cortesías servidas.</span>
            </template>
            <template v-else>
              <span class="kpi-value kpi-value--warn">No disponible: faltan costos</span>
              <span class="kpi-hint">
                {{ data.missingCostCount ? `${data.missingCostCount} producto(s) sin costo.` : 'Aún no hay consumos en este alcance.' }}
              </span>
            </template>
            <span class="kpi-more">Ver detalle <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
          </button>

          <button type="button" class="card kpi" :class="{ 'kpi--incomplete': data.margin === null }" @click="detail = 'margen'">
            <span class="kpi-label">Margen del bar</span>
            <span v-if="data.margin !== null" class="kpi-value">{{ formatMoney(data.margin) }}</span>
            <span v-else class="kpi-value kpi-value--warn">No disponible: faltan costos</span>
            <span class="kpi-hint">Consumos del bar − costo de lo servido. No es utilidad neta; mermas y ajustes van aparte.</span>
            <span class="kpi-more">Ver detalle <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
          </button>
        </div>

        <!-- Información secundaria -->
        <div class="grid grid--secondary">
          <button type="button" class="card kpi kpi--small" @click="detail = 'cortesias'">
            <span class="kpi-label">Cortesías</span>
            <span class="kpi-value">{{ formatMoney(data.courtesy) }}</span>
            <span class="kpi-hint">A precio de venta. No se cobran.</span>
          </button>
          <button type="button" class="card kpi kpi--small" @click="detail = 'compras'">
            <span class="kpi-label">Compras recibidas</span>
            <span class="kpi-value">{{ formatMoney(data.purchases) }}</span>
            <span class="kpi-hint">{{ purchaseScope }} No es el costo de lo servido.</span>
          </button>
          <div class="card kpi kpi--small kpi--static">
            <span class="kpi-label">Consumos retenidos</span>
            <span class="kpi-value" :class="{ 'kpi-value--warn': data.heldConsumptions > 0 }">{{ data.heldConsumptions }}</span>
            <span class="kpi-hint">Consumos enviados tarde, pendientes de revisión.</span>
          </div>
        </div>

        <!-- Bloque de consumos (mismo filtro) -->
        <div class="panels">
          <section class="card">
            <h3 class="panel-title"><i class="fa-regular fa-calendar-days" aria-hidden="true" /> Consumos por día</h3>
            <BarList :rows="dayRows" :format="formatMoney" />
          </section>
          <section class="card">
            <h3 class="panel-title"><i class="fa-solid fa-user-group" aria-hidden="true" /> Consumos por bartender</h3>
            <BarList :rows="bartenderRows" :format="formatMoney" />
          </section>
          <section class="card">
            <h3 class="panel-title"><i class="fa-solid fa-champagne-glasses" aria-hidden="true" /> Productos más consumidos</h3>
            <BarList :rows="productRows" />
          </section>
          <section class="card">
            <h3 class="panel-title"><i class="fa-solid fa-ship" aria-hidden="true" /> Cobrado por crucero</h3>
            <BarList :rows="cruiseRows" :format="formatMoney" />
          </section>
        </div>
      </div>
    </Transition>

    <OwnerDetail v-if="detail && data" :kind="detail" :data="data" @close="detail = null" />
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.owner {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.filters {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.mode {
  display: inline-flex;
  align-self: flex-start;
  gap: 0.3rem;
  padding: 0.25rem;
  border-radius: 999px;
  background: var(--cream-200);
}

.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 40px;
  padding: 0 1rem;
  border-radius: 999px;
  font-weight: 700;
  font-size: 0.88rem;
  color: var(--ink-600);
  transition:
    background 0.18s ease,
    color 0.18s ease;

  &--on {
    background: var(--navy-800);
    color: var(--cream-100);
  }

  &:disabled {
    opacity: 0.45;
  }
}

.filter-cruise {
  max-width: 520px;
}

.period {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.preset {
  min-height: 40px;
  padding: 0 0.9rem;
  border-radius: 999px;
  border: 1.5px solid var(--cream-200);
  font-weight: 700;
  font-size: 0.85rem;
  color: var(--ink-600);
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    color 0.18s ease;

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: var(--cream-100);
  }
}

.dates {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  max-width: 520px;
}

.range-error {
  margin: 0;
  color: var(--danger);
  font-weight: 600;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  transition: opacity 0.2s ease;

  &.busy {
    opacity: 0.55;
  }
}

.scope {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.5rem;
  font-size: 0.86rem;
  color: var(--ink-600);

  > i {
    color: var(--navy-600);
  }
}

.updated {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--ink-400);
  font-weight: 600;
}

.refresh {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--navy-600);
  transition: background 0.18s ease;

  &:hover:not(:disabled) {
    background: var(--cream-200);
  }
}

.alerts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.alert {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  padding: 0.6rem 0.85rem;
  border-radius: var(--radius-sm);
  background: rgba(185, 128, 47, 0.1);
  border: 1px solid rgba(185, 128, 47, 0.3);
  font-size: 0.9rem;
  font-weight: 600;
  color: #6f4b17;

  > span {
    flex: 1;
    min-width: 180px;
  }
}

.alert-action {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 40px;
  padding: 0 0.85rem;
  border-radius: 999px;
  background: var(--surface);
  border: 1.5px solid rgba(185, 128, 47, 0.45);
  font-weight: 700;
  font-size: 0.84rem;
  color: var(--navy-800);
  transition: border-color 0.18s ease;

  &:hover {
    border-color: var(--navy-800);
  }
}

.grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: 1fr;

  @include tablet {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }

  &--main {
    @include tablet {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  &--secondary {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  }
}

.kpi {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.3rem;
  min-width: 0;
  text-align: left;
  font: inherit;
  color: inherit;
  transition:
    box-shadow 0.18s ease,
    transform 0.18s ease;

  &:not(.kpi--static):hover {
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }

  &--small .kpi-value {
    font-size: 1.2rem;
  }

  &--incomplete .kpi-value {
    font-size: 1.1rem;
  }
}

.kpi-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-400);
}

.kpi-value {
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
  font-size: 0.82rem;
  color: var(--ink-400);
}

.kpi-more {
  margin-top: auto;
  padding-top: 0.3rem;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--navy-600);

  i {
    font-size: 0.7rem;
  }
}

.kpi-list {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding-top: 0.4rem;
  border-top: 1px solid var(--cream-200);
  font-size: 0.86rem;

  > span {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    color: var(--ink-600);
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
  display: flex;
  align-items: center;
  gap: 0.5rem;

  i {
    color: var(--gold-500);
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
