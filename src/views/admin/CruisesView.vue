<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
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
  apiPlanCruise,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDate, formatDayKey, formatLongDate } from '@/utils/format'
import BaseDatePicker from '@/components/ui/BaseDatePicker.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import PassengersModal from '@/components/cruises/PassengersModal.vue'
import CycleSettingsModal from '@/components/cruises/CycleSettingsModal.vue'
import CruiseStartModal from '@/components/cruises/CruiseStartModal.vue'
import CruiseFinishModal from '@/components/cruises/CruiseFinishModal.vue'
import { useUserStore } from '@/stores/user'
import type { Cabin, Cruise, CruiseStatus, CycleSettings, NewCruisePlan } from '@/types'

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

// ---- Nuevo crucero: tipo + fecha de inicio; el resto lo completa el ciclo ----
const newLeg = shallowRef('')
const newStart = shallowRef('')
const plan = shallowRef<NewCruisePlan | null>(null)
const planning = shallowRef(false)
const planError = shallowRef('')
const creating = shallowRef(false)
let planSeq = 0

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

const canCreate = computed(() => Boolean(plan.value && !plan.value.overlap && !planning.value && !creating.value))

async function createCruise(acceptWeekday = false) {
  const p = plan.value
  if (!p || p.overlap || creating.value) return
  if (!acceptWeekday) {
    const dayWarning = p.weekday.ok
      ? ''
      : ` Atención: el crucero ${p.leg} zarpa en ${p.weekday.expected} y la fecha elegida es ${p.weekday.actual}.`
    const ok = await confirmStore.ask({
      title: `¿Crear el crucero ${p.code}?`,
      message: `${p.routeFrom} → ${p.routeTo}. Del ${formatLongDate(newStart.value).toLowerCase()} al ${formatLongDate(p.endKey).toLowerCase()} (${p.durationDays} días), zarpe ${p.departureTime}, ${p.cabinCount} cabinas sin pasajeros.${dayWarning}`,
      confirmLabel: p.weekday.ok ? 'Crear crucero' : 'Crear igual',
      icon: p.weekday.ok ? 'fa-ship' : 'fa-calendar-day',
    })
    if (!ok) return
  }
  creating.value = true
  try {
    const cruise = await apiCreatePlannedCruise(p.leg, newStart.value, acceptWeekday || !p.weekday.ok)
    play('success')
    toast.success(`Crucero ${cruise.code} creado: ${formatDate(cruise.startDate)} → ${formatDate(cruise.endDate ?? cruise.startDate)}`)
    newLeg.value = ''
    newStart.value = ''
    tab.value = 'proximas'
    await refresh()
  } catch (err) {
    const code = axios.isAxiosError(err) ? (err.response?.data as { code?: string } | undefined)?.code : undefined
    play('error')
    if (code === 'dia_distinto') {
      // El servidor avisa del día de zarpe: se confirma y se reintenta.
      const ok = await confirmStore.ask({
        title: 'El día no es el de zarpe',
        message: `${apiErrorMessage(err)} ¿Crear de todas formas?`,
        confirmLabel: 'Crear igual',
        icon: 'fa-calendar-day',
      })
      creating.value = false
      if (ok) await createCruise(true)
      return
    }
    toast.error(apiErrorMessage(err))
    if (code === 'solapa') await loadPlan()
  } finally {
    creating.value = false
  }
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

onMounted(refresh)

async function generate() {
  if (!startDate.value || !untilDate.value) {
    toast.error('Elige la fecha de inicio del crucero A y hasta cuándo programar')
    return
  }
  const weekday = new Date(`${startDate.value}T12:00:00-05:00`).getDay()
  if (weekday !== 6) {
    const ok = await confirmStore.ask({
      title: 'El crucero A zarpa en sábado',
      message: 'La fecha elegida no es sábado. ¿Programar de todas formas desde ese día?',
      confirmLabel: 'Programar igual',
      icon: 'fa-calendar-day',
    })
    if (!ok) return
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
        <p class="page-lead">Elige el tipo y la fecha de inicio: el fin, la ruta y el código se completan solos.</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-secondary" @click="showSettings = true">
          <i class="fa-solid fa-sliders" aria-hidden="true" /> Configurar ciclo
        </button>
      </div>
    </header>

    <!-- Nuevo crucero: tipo + fecha de inicio (pedido de Gerencia, 30-oct-2026) -->
    <section class="new-cruise" aria-labelledby="new-cruise-title">
      <h2 id="new-cruise-title" class="section-title">Nuevo crucero</h2>

      <p class="step">Tipo de crucero</p>
      <div class="leg-options" role="radiogroup" aria-label="Tipo de crucero">
        <button
          v-for="(leg, i) in settings?.legs ?? []"
          :key="leg.code"
          type="button"
          role="radio"
          class="leg-option"
          :class="{ 'leg-option--on': newLeg === leg.code }"
          :aria-checked="newLeg === leg.code"
          @click="newLeg = leg.code"
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

      <p class="step">Fecha de inicio</p>
      <div class="start-field">
        <BaseDatePicker v-model="newStart" placeholder="Elige la fecha de inicio" />
      </div>

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
              Elige otra fecha de inicio.
            </span>
          </p>
          <p v-else-if="!plan.weekday.ok" class="plan-alert plan-alert--warning">
            <i class="fa-solid fa-calendar-day" aria-hidden="true" />
            <span>
              El crucero {{ plan.leg }} zarpa en {{ plan.weekday.expected }} y el {{ formatDayKey(newStart) }} es
              {{ plan.weekday.actual }}. Se puede crear igual si es correcto.
            </span>
          </p>
        </div>
        <p v-else-if="planError" class="plan-alert plan-alert--danger plan-alert--solo">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true" /> <span>{{ planError }}</span>
        </p>
        <p v-else-if="planning" class="plan-hint"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true" /> Calculando…</p>
        <p v-else class="plan-hint">
          {{ newLeg ? 'Elige la fecha de inicio: la fecha de fin, la ruta y el código se completan solos.' : 'Elige el tipo de crucero y la fecha de inicio: el resto se completa solo.' }}
        </p>
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
      <article v-for="cruise in visible" :key="cruise._id" class="cruise" :class="`cruise--${cruise.status}`">
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
    margin-bottom: 1rem;
  }
}

.step {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--ink-600);
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

.start-field {
  max-width: 360px;
  margin-bottom: 1.1rem;
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
