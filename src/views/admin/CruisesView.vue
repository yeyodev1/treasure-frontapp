<script setup lang="ts">
import { computed, nextTick, onMounted, shallowRef, watch } from 'vue'
import axios from 'axios'
import { useCruiseStore } from '@/stores/cruise'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'
import {
  apiCreatePlannedCruise,
  apiCruises,
  apiCycleSettings,
  apiGenerateCycle,
  apiNewCruiseOptions,
  apiPlanCruise,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDate, formatLongDate } from '@/utils/format'
import BaseDatePicker from '@/components/ui/BaseDatePicker.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import PassengersModal from '@/components/cruises/PassengersModal.vue'
import CycleSettingsModal from '@/components/cruises/CycleSettingsModal.vue'
import CruiseStartModal from '@/components/cruises/CruiseStartModal.vue'
import CruiseFinishModal from '@/components/cruises/CruiseFinishModal.vue'
import { useUserStore } from '@/stores/user'
import type { Cabin, Cruise, CruiseStatus, CycleSettings, NewCruiseOptions, NewCruisePlan } from '@/types'

const toast = useToastStore()
const cruiseStore = useCruiseStore()
const confirmStore = useConfirmStore()
const { play } = useSound()

const cruises = shallowRef<Cruise[]>([])
const settings = shallowRef<CycleSettings | null>(null)
const loading = shallowRef(true)
const generating = shallowRef(false)
const tab = shallowRef<'proximas' | 'cerradas'>('proximas')
const showSettings = shallowRef(false)
const paxTarget = shallowRef<{ cruise: Cruise; cabin: Cabin } | null>(null)
const startTarget = shallowRef<Cruise | null>(null)
const finishTarget = shallowRef<Cruise | null>(null)
const userStore = useUserStore()

const startDate = shallowRef('')
const untilDate = shallowRef('')
/** "Programar varios" (generador del ciclo) va plegado: lo habitual es un crucero. */
const showGenerator = shallowRef(false)

// ---- Nuevo crucero (pedido del cliente, 31-oct-2026) ----
// Solo inician y terminan sábado o martes: cada tipo ofrece únicamente sus
// fechas de zarpe, con las ocupadas marcadas con el crucero que las ocupa.
// Al abrir, queda elegido el siguiente crucero del ciclo en su primera
// fecha libre: lo habitual es revisar y tocar Crear.
const newLeg = shallowRef('')
const newStart = shallowRef('')
const options = shallowRef<NewCruiseOptions | null>(null)
const plan = shallowRef<NewCruisePlan | null>(null)
const planning = shallowRef(false)
const planError = shallowRef('')
const creating = shallowRef(false)
/** Crucero resaltado en la lista (el que ocupa una fecha). */
const highlighted = shallowRef('')
let planSeq = 0

const legOption = computed(() => options.value?.legs.find((l) => l.code === newLeg.value) ?? null)
const isSuggested = computed(
  () =>
    Boolean(options.value?.suggestion) &&
    options.value!.suggestion!.leg === newLeg.value &&
    options.value!.suggestion!.startDate === newStart.value,
)

async function loadOptions(applySuggestion = false) {
  try {
    options.value = await apiNewCruiseOptions()
    const s = options.value.suggestion
    if (applySuggestion && s) {
      newLeg.value = s.leg
      newStart.value = s.startDate
    }
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

/** Al cambiar de tipo: su primera fecha libre (o ninguna). */
function pickLeg(code: string) {
  if (newLeg.value === code) return
  newLeg.value = code
  const leg = options.value?.legs.find((l) => l.code === code)
  newStart.value = leg?.dates.find((d) => d.free)?.date ?? ''
}

function useSuggestion() {
  const s = options.value?.suggestion
  if (!s) return
  newLeg.value = s.leg
  newStart.value = s.startDate
}

/** Lleva al crucero que ocupa la fecha y lo resalta un momento. */
async function showCruise(cruiseId: string) {
  tab.value = 'proximas'
  highlighted.value = cruiseId
  await nextTick()
  document.querySelector(`[data-cruise="${cruiseId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  setTimeout(() => {
    if (highlighted.value === cruiseId) highlighted.value = ''
  }, 2400)
}

async function loadPlan() {
  const seq = ++planSeq
  planError.value = ''
  if (!newLeg.value || !newStart.value) {
    plan.value = null
    return
  }
  planning.value = true
  try {
    const result = await apiPlanCruise(newLeg.value, newStart.value)
    if (seq === planSeq) plan.value = result
  } catch (err) {
    if (seq === planSeq) {
      plan.value = null
      planError.value = apiErrorMessage(err)
    }
  } finally {
    if (seq === planSeq) planning.value = false
  }
}

watch([newLeg, newStart], loadPlan)

const canCreate = computed(() =>
  Boolean(plan.value && !plan.value.overlap && plan.value.weekday.ok && !planning.value && !creating.value),
)

async function createCruise() {
  const p = plan.value
  if (!p || p.overlap || !p.weekday.ok || creating.value) return
  const ok = await confirmStore.ask({
    title: `¿Crear el crucero ${p.code}?`,
    message: `${p.routeFrom} → ${p.routeTo}. Del ${formatLongDate(newStart.value).toLowerCase()} al ${formatLongDate(p.endKey).toLowerCase()} (${p.durationDays} días), zarpe ${p.departureTime}, ${p.cabinCount} cabinas sin pasajeros.`,
    confirmLabel: 'Crear crucero',
    icon: 'fa-ship',
  })
  if (!ok) return
  creating.value = true
  try {
    const cruise = await apiCreatePlannedCruise(p.leg, newStart.value)
    play('success')
    toast.success(`Crucero ${cruise.code} creado: ${formatDate(cruise.startDate)} → ${formatDate(cruise.endDate ?? cruise.startDate)}`)
    tab.value = 'proximas'
    await refresh()
    // Queda listo el siguiente del ciclo.
    await loadOptions(true)
    void showCruise(cruise._id)
  } catch (err) {
    const code = axios.isAxiosError(err) ? (err.response?.data as { code?: string } | undefined)?.code : undefined
    play('error')
    toast.error(apiErrorMessage(err))
    if (code === 'solapa' || code === 'dia_distinto') {
      await loadOptions()
      await loadPlan()
    }
  } finally {
    creating.value = false
  }
}

/** "sáb 7 nov" para los botones de fecha. */
function shortDay(key: string) {
  return new Intl.DateTimeFormat('es-EC', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${key}T12:00:00Z`))
    .replace(/\./g, '')
}

const STATUS_LABELS: Record<CruiseStatus, string> = {
  planificado: 'Programado',
  abordo: 'En curso',
  cerrado: 'Finalizado',
}

const LEG_ICONS = ['fa-sun', 'fa-water', 'fa-compass']

// El crucero en curso siempre primero; luego los programados por fecha.
const visible = computed(() =>
  tab.value === 'cerradas'
    ? [...cruises.value].filter((c) => c.status === 'cerrado').reverse()
    : [
        ...cruises.value.filter((c) => c.status === 'abordo'),
        ...cruises.value.filter((c) => c.status === 'planificado'),
      ],
)

const upcomingCount = computed(() => cruises.value.filter((c) => c.status !== 'cerrado').length)
const closedCount = computed(() => cruises.value.filter((c) => c.status === 'cerrado').length)

const STATUS_PILL: Record<CruiseStatus, string> = {
  planificado: 'estado--info',
  abordo: 'estado--ok',
  cerrado: '',
}

function label(cruise: Cruise): string {
  return cruise.code ? `Crucero ${cruise.code}` : cruise.name
}

async function refresh() {
  try {
    const [list, cfg] = await Promise.all([apiCruises(), apiCycleSettings()])
    cruises.value = list
    settings.value = cfg
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
  void loadOptions(true)
})

async function generate() {
  if (!startDate.value || !untilDate.value) {
    toast.error('Elige la fecha de inicio del crucero A y hasta cuándo programar')
    return
  }
  // Los cruceros solo inician sábado o martes: el ciclo arranca con A en sábado.
  const weekday = new Date(`${startDate.value}T12:00:00Z`).getUTCDay()
  if (weekday !== 6) {
    play('error')
    toast.error('El crucero A zarpa los sábados: elige un sábado para empezar el ciclo')
    return
  }
  generating.value = true
  try {
    const { created, skipped } = await apiGenerateCycle(startDate.value, untilDate.value)
    play('success')
    toast.success(
      created.length
        ? `Se programaron ${created.length} crucero(s): ${created.join(', ')}${skipped ? ` · ${skipped} ya existían` : ''}`
        : `No hay cruceros nuevos: los ${skipped} ya existían`,
    )
    await refresh()
    await loadOptions(true)
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    generating.value = false
  }
}

async function onLifecycleDone() {
  startTarget.value = null
  finishTarget.value = null
  await refresh()
  await cruiseStore.loadActive(true)
}

async function onPassengersSaved() {
  paxTarget.value = null
  await refresh()
  await cruiseStore.loadActive(true)
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head-text">
        <h1 class="page-title">Cruceros</h1>
        <p class="page-lead">El siguiente crucero ya viene sugerido: revisa y crea. Solo zarpan sábado o martes.</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-secondary" @click="showSettings = true">
          <i class="fa-solid fa-sliders" aria-hidden="true" /> Configurar ciclo
        </button>
      </div>
    </header>

    <!-- Nuevo crucero: el siguiente del ciclo ya elegido; tipo y fecha solo en días de zarpe -->
    <section class="new-cruise" aria-labelledby="new-cruise-title">
      <div class="new-head">
        <h2 id="new-cruise-title" class="section-title">Nuevo crucero</h2>
        <Transition name="fade" mode="out-in">
          <span v-if="isSuggested" key="sug" class="suggested">
            <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true" /> Sugerido: sigue en el ciclo
          </span>
          <button
            v-else-if="options?.suggestion"
            key="use"
            type="button"
            class="suggested suggested--btn"
            @click="useSuggestion"
          >
            <i class="fa-solid fa-rotate-left" aria-hidden="true" />
            Volver a la sugerencia: crucero {{ options.suggestion.leg }} · {{ shortDay(options.suggestion.startDate) }}
          </button>
        </Transition>
      </div>

      <p class="step"><span class="step-n">1</span> Tipo de crucero</p>
      <div class="leg-options" role="radiogroup" aria-label="Tipo de crucero">
        <button
          v-for="(leg, i) in options?.legs ?? settings?.legs ?? []"
          :key="leg.code"
          type="button"
          role="radio"
          class="leg-option"
          :class="{ 'leg-option--on': newLeg === leg.code }"
          :aria-checked="newLeg === leg.code"
          @click="pickLeg(leg.code)"
        >
          <span class="leg-option-head">
            <span class="leg-icon"><i class="fa-solid" :class="LEG_ICONS[i]" aria-hidden="true" /></span>
            <strong class="leg-letter">Crucero {{ leg.code }}</strong>
            <i
              class="fa-solid fa-circle-check leg-check"
              :class="{ 'leg-check--on': newLeg === leg.code }"
              aria-hidden="true"
            />
          </span>
          <span class="leg-route">{{ leg.routeFrom }} → {{ leg.routeTo }}</span>
          <span class="leg-meta">{{ leg.label }} · {{ leg.durationDays }} días · zarpe {{ leg.departureTime }}</span>
        </button>
      </div>

      <p class="step">
        <span class="step-n">2</span> Fecha de inicio
        <small v-if="legOption?.weekday">· el crucero {{ legOption.code }} zarpa los {{ legOption.weekday.endsWith('s') ? legOption.weekday : `${legOption.weekday}s` }}</small>
      </p>
      <Transition name="fade" mode="out-in">
        <div v-if="legOption" :key="legOption.code" class="dates" role="radiogroup" aria-label="Fecha de inicio">
          <button
            v-for="d in legOption.dates"
            :key="d.date"
            type="button"
            role="radio"
            class="date-chip"
            :class="{ 'date-chip--on': newStart === d.date, 'date-chip--busy': !d.free }"
            :aria-checked="newStart === d.date"
            :aria-disabled="!d.free"
            @click="d.free ? (newStart = d.date) : d.conflict && showCruise(d.conflict._id)"
          >
            <strong>{{ shortDay(d.date) }}</strong>
            <small v-if="d.free">hasta {{ shortDay(d.endDate) }}</small>
            <small v-else class="date-busy"><i class="fa-solid fa-ship" aria-hidden="true" /> Ocupado · {{ d.conflict?.code || d.conflict?.name }}</small>
          </button>
        </div>
        <p v-else class="plan-hint">Elige el tipo de crucero: aparecen solo sus días de zarpe.</p>
      </Transition>

      <Transition name="fade" mode="out-in">
        <div v-if="plan" :key="`${plan.leg}-${newStart}`" class="plan" :class="{ 'plan--busy': planning }" aria-live="polite">
          <div class="plan-code">
            <span>Código</span>
            <strong>{{ plan.code }}</strong>
          </div>
          <dl class="plan-grid">
            <div>
              <dt>Ruta</dt>
              <dd>{{ plan.routeFrom }} → {{ plan.routeTo }}</dd>
            </div>
            <div>
              <dt>Inicio</dt>
              <dd>{{ formatLongDate(newStart) }} · {{ plan.departureTime }}</dd>
            </div>
            <div>
              <dt>Fin</dt>
              <dd>{{ formatLongDate(plan.endKey) }} · {{ plan.departureTime }}</dd>
            </div>
            <div>
              <dt>Duración y cabinas</dt>
              <dd>{{ plan.durationDays }} días · {{ plan.cabinCount }} cabinas</dd>
            </div>
          </dl>
          <p v-if="plan.overlap" class="plan-alert plan-alert--danger">
            <i class="fa-solid fa-circle-exclamation" aria-hidden="true" />
            <span>
              Se cruza con el crucero {{ plan.overlap.code || plan.overlap.name }}
              ({{ plan.overlap.status === 'abordo' ? 'en curso' : 'programado' }},
              {{ formatDate(plan.overlap.startDate) }}<template v-if="plan.overlap.endDate"> → {{ formatDate(plan.overlap.endDate) }}</template>).
              <button type="button" class="link-btn" @click="showCruise(plan.overlap._id)">Ver {{ plan.overlap.code || 'crucero' }}</button>
            </span>
          </p>
        </div>
        <p v-else-if="planError" class="plan-alert plan-alert--danger plan-alert--solo">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true" /> <span>{{ planError }}</span>
        </p>
        <p v-else-if="planning" class="plan-hint"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true" /> Calculando…</p>
      </Transition>

      <button type="button" class="btn btn-primary btn-lg create-btn" :disabled="!canCreate" @click="createCruise()">
        <i class="fa-solid" :class="creating ? 'fa-spinner fa-spin' : 'fa-plus'" aria-hidden="true" />
        {{ creating ? 'Creando…' : plan ? `Crear crucero ${plan.code}` : 'Crear crucero' }}
      </button>
    </section>

    <!-- Programar varios: generador del ciclo A → B → C (opción secundaria) -->
    <section class="cycle">
      <button
        type="button"
        class="cycle-toggle"
        :aria-expanded="showGenerator"
        aria-controls="cycle-panel"
        @click="showGenerator = !showGenerator"
      >
        <i class="fa-solid fa-layer-group" aria-hidden="true" />
        <span class="cycle-texts">
          <span>Programar varios</span>
          <small>Repite A → B → C entre dos fechas</small>
        </span>
        <i class="fa-solid fa-chevron-down cycle-chevron" :class="{ 'cycle-chevron--open': showGenerator }" aria-hidden="true" />
      </button>
      <Transition name="fold">
        <div v-if="showGenerator" id="cycle-panel" class="cycle-panel">
          <div class="generate">
            <div class="field">
              <label>Inicio del crucero A</label>
              <BaseDatePicker v-model="startDate" placeholder="Sábado de inicio" />
            </div>
            <div class="field">
              <label>Programar hasta</label>
              <BaseDatePicker v-model="untilDate" placeholder="Fecha final" />
            </div>
            <button type="button" class="btn btn-primary" :disabled="generating" @click="generate">
              <i class="fa-regular fa-clock" aria-hidden="true" />
              {{ generating ? 'Programando…' : 'Programar cruceros' }}
            </button>
          </div>
          <p class="rule">
            Se repite A → B → C con su código y {{ settings?.cabinCount ?? 9 }} cabinas limpias. Volver a
            programar no duplica cruceros y nunca toca los finalizados.
          </p>
        </div>
      </Transition>
    </section>

    <div class="segs tabs" role="tablist" aria-label="Cruceros por estado">
      <button
        type="button"
        role="tab"
        class="segs-item"
        :class="{ 'segs-item--on': tab === 'proximas' }"
        :aria-selected="tab === 'proximas'"
        @click="tab = 'proximas'"
      >
        <i class="fa-solid fa-ship" aria-hidden="true" /> Programados y en curso
        <span v-if="!loading" class="segs-count">{{ upcomingCount }}</span>
      </button>
      <button
        type="button"
        role="tab"
        class="segs-item"
        :class="{ 'segs-item--on': tab === 'cerradas' }"
        :aria-selected="tab === 'cerradas'"
        @click="tab = 'cerradas'"
      >
        <i class="fa-solid fa-anchor" aria-hidden="true" /> Finalizados
        <span v-if="!loading" class="segs-count">{{ closedCount }}</span>
      </button>
    </div>

    <SkeletonList v-if="loading" variant="card" :rows="3" />
    <div v-else-if="!visible.length" class="vacio">
      <i class="fa-solid" :class="tab === 'cerradas' ? 'fa-anchor' : 'fa-ship'" aria-hidden="true" />
      <p>{{ tab === 'cerradas' ? 'Aún no hay cruceros finalizados.' : 'Aún no hay crucero programado. Crea uno arriba.' }}</p>
    </div>

    <TransitionGroup v-else name="list" tag="div" class="cruises">
      <article
        v-for="cruise in visible"
        :key="cruise._id"
        class="cruise"
        :class="[`cruise--${cruise.status}`, { 'cruise--highlight': highlighted === cruise._id }]"
        :data-cruise="cruise._id"
      >
        <header class="cruise-head">
          <div class="cruise-title">
            <h3>{{ label(cruise) }}</h3>
            <p v-if="cruise.routeFrom" class="cruise-route">
              <i class="fa-solid fa-route" aria-hidden="true" /> {{ cruise.routeFrom }} → {{ cruise.routeTo }}
            </p>
            <p class="cruise-dates num">
              <i class="fa-regular fa-calendar" aria-hidden="true" />
              {{ formatDate(cruise.startDate) }}
              <template v-if="cruise.endDate"> → {{ formatDate(cruise.endDate) }}</template>
            </p>
          </div>
          <span class="estado" :class="STATUS_PILL[cruise.status]">
            <i v-if="cruise.status === 'abordo'" class="fa-solid fa-circle live-dot" aria-hidden="true" />
            {{ STATUS_LABELS[cruise.status] }}
          </span>
        </header>

        <div class="cabin-grid">
          <button
            v-for="cabin in cruise.cabins"
            :key="cabin.number"
            type="button"
            class="cabin-chip"
            :class="{ 'cabin-chip--filled': cabin.passengers.length }"
            :aria-label="`Cabina ${cabin.number}: ${cabin.passengers.length ? cabin.guestName : 'sin pasajeros'}`"
            @click="paxTarget = { cruise, cabin }"
          >
            <strong>{{ cabin.number }}</strong>
            <span>{{ cabin.passengers.length ? cabin.guestName : 'Sin pasajeros' }}</span>
            <small v-if="cabin.passengers.length > 1">{{ cabin.passengers.length }} pax</small>
          </button>
        </div>

        <footer
          v-if="(cruise.status !== 'cerrado' && userStore.isDirector) || cruise.closeReason"
          class="cruise-actions"
        >
          <button
            v-if="cruise.status === 'planificado' && userStore.isDirector"
            type="button"
            class="btn btn-primary"
            @click="startTarget = cruise"
          >
            <i class="fa-solid fa-ship" aria-hidden="true" /> Iniciar crucero
          </button>
          <button
            v-if="cruise.status === 'abordo' && userStore.isDirector"
            type="button"
            class="btn btn-secondary"
            @click="finishTarget = cruise"
          >
            <i class="fa-solid fa-anchor" aria-hidden="true" /> Finalizar operación del crucero
          </button>
          <p v-if="cruise.closeReason" class="close-reason">
            <i class="fa-solid fa-circle-info" aria-hidden="true" /> Cierre excepcional: {{ cruise.closeReason }}
          </p>
        </footer>
      </article>
    </TransitionGroup>

    <CruiseStartModal v-if="startTarget" :cruise="startTarget" @close="startTarget = null" @started="onLifecycleDone" />
    <CruiseFinishModal v-if="finishTarget" :cruise="finishTarget" @close="finishTarget = null" @finished="onLifecycleDone" />

    <PassengersModal
      v-if="paxTarget"
      :cruise-id="paxTarget.cruise._id"
      :cruise-label="label(paxTarget.cruise)"
      :cabin="paxTarget.cabin"
      :readonly="paxTarget.cruise.status === 'cerrado'"
      @close="paxTarget = null"
      @saved="onPassengersSaved"
    />

    <CycleSettingsModal
      v-if="showSettings && settings"
      :settings="settings"
      @close="showSettings = false"
      @saved="(s) => { settings = s; showSettings = false }"
    />
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

// ---- Nuevo crucero ----
.new-cruise {
  margin-bottom: 1rem;
  padding: 1.1rem 1rem 1.25rem;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);

  @include tablet {
    padding: 1.35rem 1.5rem 1.5rem;
  }

  .section-title {
    margin-bottom: 0;
  }
}

.new-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin-bottom: 1rem;
}

.suggested {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 36px;
  padding: 0 0.8rem;
  border-radius: 999px;
  background: var(--powder-100);
  color: var(--navy-800);
  font-size: 0.85rem;
  font-weight: 600;

  &--btn {
    min-height: 44px;
    border: 1.5px solid var(--navy-700);
    background: var(--surface);
    transition:
      background 0.15s ease,
      transform 0.12s ease;

    &:hover {
      background: var(--powder-100);
    }

    &:active {
      transform: scale(0.97);
    }
  }
}

.step {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.5rem;
  margin: 0 0 0.6rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--ink-600);

  small {
    font-weight: 500;
    color: var(--ink-400);
  }
}

.step-n {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--navy-800);
  color: #fff;
  font-size: 0.78rem;
  font-weight: 700;
}

// Fechas de zarpe del tipo elegido: solo días válidos; las ocupadas dicen por quién.
.dates {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 0.5rem;
  margin-bottom: 1.1rem;
}

.date-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  min-height: 56px;
  padding: 0.5rem 0.75rem;
  border: 2px solid var(--cream-200);
  border-radius: var(--radius-sm);
  background: var(--surface);
  text-align: left;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.12s ease;

  strong {
    font-weight: 700;
    text-transform: capitalize;
  }

  small {
    font-size: 0.78rem;
    color: var(--ink-400);
  }

  &:hover:not(.date-chip--busy) {
    border-color: var(--navy-600);
  }

  &:active {
    transform: scale(0.97);
  }

  &--on {
    border-color: var(--navy-800);
    background: var(--navy-800);
    color: #fff;

    small {
      color: var(--powder-300);
    }
  }

  &--busy {
    border-style: dashed;
    background: var(--cream-100);
    color: var(--ink-400);
  }
}

.date-busy {
  color: var(--danger) !important;
  font-weight: 600;
}

.link-btn {
  display: inline;
  padding: 0;
  font-weight: 700;
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.leg-options {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.6rem;
  margin-bottom: 1.25rem;

  @include tablet {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.leg-option {
  min-width: 0;
  min-height: 104px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.3rem;
  padding: 0.9rem 1rem;
  text-align: left;
  background: var(--surface);
  border: 1.5px solid var(--line-strong);
  border-radius: var(--radius);
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.14s var(--ease-out);

  &:hover:not(.leg-option--on) {
    border-color: var(--navy-600);
  }

  &:active {
    transform: scale(0.98);
  }

  &--on {
    border-color: var(--navy-800);
    background: var(--powder-100);
    box-shadow: inset 0 0 0 1px var(--navy-800);
  }
}

.leg-option-head {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
}

.leg-letter {
  font-family: var(--font-serif);
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--ink-900);
}

.leg-check {
  margin-left: auto;
  font-size: 1.25rem;
  color: var(--navy-800);
  opacity: 0;
  transform: scale(0.6);
  transition:
    opacity 0.16s ease,
    transform 0.2s var(--ease-out);

  &--on {
    opacity: 1;
    transform: scale(1);
  }
}

.leg-route {
  font-weight: 600;
  font-size: 1.02rem;
  color: var(--ink-900);
  overflow-wrap: anywhere;
}

.leg-meta {
  font-size: 0.92rem;
  color: var(--ink-600);
}

.leg-icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--powder-100);
  color: var(--navy-700);
  transition:
    background-color 0.16s ease,
    color 0.16s ease;
}

.leg-option--on .leg-icon {
  background: var(--navy-800);
  color: #fff;
}

.plan {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem 1.6rem;
  align-items: flex-start;
  padding: 1rem 1.1rem;
  margin-bottom: 1.1rem;
  border-radius: var(--radius-sm);
  background: var(--powder-100);
  transition: opacity 0.16s ease;

  &--busy {
    opacity: 0.6;
  }
}

.plan-code {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;

  span {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--ink-600);
  }

  strong {
    font-family: var(--font-serif);
    font-size: 2rem;
    line-height: 1.05;
    color: var(--navy-800);
  }
}

.plan-grid {
  flex: 1 1 320px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem 1.4rem;
  margin: 0;

  dt {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--ink-600);
  }

  dd {
    margin: 0.1rem 0 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--ink-900);
  }
}

.plan-alert {
  flex: 1 1 100%;
  display: flex;
  gap: 0.55rem;
  align-items: baseline;
  margin: 0;
  padding: 0.7rem 0.85rem;
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 1rem;
  line-height: 1.4;

  &--danger {
    background: var(--pill-danger-bg);
    color: var(--pill-danger-ink);
  }

  &--warning {
    background: var(--pill-warn-bg);
    color: var(--pill-warn-ink);
  }

  &--solo {
    margin-bottom: 1.1rem;
  }
}

.plan-hint {
  margin: 0 0 1.1rem;
  font-size: 1rem;
  color: var(--ink-600);
}

.create-btn {
  width: 100%;

  @include tablet {
    width: auto;
    min-width: 260px;
  }
}

// ---- Programar varios (plegado) ----
.cycle {
  margin-bottom: 1.75rem;
}

.cycle-toggle {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  width: 100%;
  min-height: 56px;
  padding: 0.6rem 1rem;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-weight: 600;
  color: var(--ink-900);
  transition: border-color 0.16s ease;

  &:hover {
    border-color: var(--navy-600);
  }

  > i:first-child {
    color: var(--navy-700);
  }
}

.cycle-texts {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.1rem 0.7rem;
  min-width: 0;

  small {
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--ink-600);
  }
}

.cycle-chevron {
  margin-left: auto;
  color: var(--ink-400);
  transition: transform 0.22s var(--ease-out);

  &--open {
    transform: rotate(180deg);
  }
}

.cycle-panel {
  padding-top: 0.6rem;
}

.generate {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: var(--surface);

  @include tablet {
    flex-direction: row;
    align-items: flex-end;

    .field {
      flex: 1 1 0;
      margin: 0;
    }
  }
}

.rule {
  margin: 0.6rem 0 0;
  font-size: 0.95rem;
  line-height: 1.45;
  color: var(--ink-600);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.fold-enter-active,
.fold-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.22s var(--ease-out);
}

.fold-enter-from,
.fold-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.tabs {
  margin-bottom: 1rem;
}

// ---- Lista de cruceros ----
.cruises {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;

  @include desktop {
    grid-template-columns: repeat(auto-fill, minmax(480px, 1fr));
  }
}

.cruise {
  min-width: 0;
  padding: 1rem;
  transition:
    box-shadow 0.3s ease,
    border-color 0.3s ease;

  // El crucero que ocupa una fecha, señalado desde Nuevo crucero.
  &--highlight {
    border-color: var(--navy-700);
    box-shadow: 0 0 0 4px var(--powder-200);
  }

  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);

  @include tablet {
    padding: 1.15rem 1.25rem;
  }

  &--abordo {
    border-color: var(--success);
    box-shadow: inset 3px 0 0 var(--success);
  }
}

.cruise-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.9rem;
}

.cruise-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;

  h3 {
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--ink-900);
  }

  p {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    font-size: 1rem;
    color: var(--ink-600);
  }

  i {
    width: 1rem;
    flex: none;
    color: var(--navy-600);
  }
}

.live-dot {
  font-size: 0.5rem;
  animation: live-pulse 1.8s ease-in-out infinite;
}

@keyframes live-pulse {
  50% {
    opacity: 0.35;
  }
}

.cabin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 0.5rem;
}

.cabin-chip {
  min-width: 0;
  min-height: 64px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0.05rem;
  padding: 0.5rem 0.7rem;
  text-align: left;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-sm);
  font-size: 0.92rem;
  color: var(--ink-400);
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    transform 0.14s var(--ease-out);

  strong {
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
    color: var(--ink-900);
  }

  span {
    max-width: 100%;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  small {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--gold-600);
  }

  &--filled {
    border-style: solid;
    border-color: var(--powder-300);
    background: var(--powder-100);
    color: var(--ink-600);
  }

  &:hover {
    border-color: var(--navy-600);
  }

  &:active {
    transform: scale(0.97);
  }
}

.cruise-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 1rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--rule);
}

.close-reason {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  margin: 0;
  font-size: 0.95rem;
  color: var(--pill-warn-ink);
}
</style>
