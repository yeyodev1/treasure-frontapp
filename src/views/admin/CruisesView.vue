<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { useCruiseStore } from '@/stores/cruise'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'
import { apiCruises, apiCycleSettings, apiGenerateCycle, apiUpdateCruise } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDate } from '@/utils/format'
import BaseDatePicker from '@/components/ui/BaseDatePicker.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import PassengersModal from '@/components/cruises/PassengersModal.vue'
import CycleSettingsModal from '@/components/cruises/CycleSettingsModal.vue'
import type { Cabin, Cruise, CruiseStatus, CycleSettings } from '@/types'

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

const startDate = shallowRef('')
const untilDate = shallowRef('')

const STATUS_LABELS: Record<CruiseStatus, string> = {
  planificado: 'Programada',
  abordo: 'A bordo',
  cerrado: 'Cerrada',
}

const LEG_ICONS = ['fa-sun', 'fa-water', 'fa-compass']

// La salida a bordo siempre primero; luego las programadas por fecha.
const visible = computed(() =>
  tab.value === 'cerradas'
    ? [...cruises.value].filter((c) => c.status === 'cerrado').reverse()
    : [
        ...cruises.value.filter((c) => c.status === 'abordo'),
        ...cruises.value.filter((c) => c.status === 'planificado'),
      ],
)

function label(cruise: Cruise): string {
  return cruise.code ? `Salida ${cruise.code}` : cruise.name
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
    toast.error('Elige la fecha de inicio del tramo A y hasta cuándo generar')
    return
  }
  const weekday = new Date(`${startDate.value}T12:00:00-05:00`).getDay()
  if (weekday !== 6) {
    const ok = await confirmStore.ask({
      title: 'El tramo A suele zarpar en sábado',
      message: 'La fecha elegida no es sábado. ¿Generar de todas formas desde ese día?',
      confirmLabel: 'Generar igual',
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
        ? `Se generaron ${created.length} salida(s): ${created.join(', ')}${skipped ? ` · ${skipped} ya existían` : ''}`
        : `No hay salidas nuevas: las ${skipped} ya existían`,
    )
    await refresh()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    generating.value = false
  }
}

async function setStatus(cruise: Cruise, status: CruiseStatus) {
  const occupied = cruise.cabins.filter((c) => c.passengers.length).length
  const prompts: Partial<Record<CruiseStatus, Parameters<typeof confirmStore.ask>[0]>> = {
    abordo: {
      title: `¿Iniciar ${label(cruise)}?`,
      message: `Pasa a "a bordo" y el bar podrá registrar pedidos. Cabinas con pasajeros: ${occupied} de ${cruise.cabins.length}.`,
      confirmLabel: 'Iniciar salida',
      icon: 'fa-ship',
    },
    cerrado: {
      title: `¿Cerrar ${label(cruise)}?`,
      message: 'No se podrán registrar más pedidos en esta salida. Las cuentas sin cobrar siguen disponibles en Cuentas.',
      confirmLabel: 'Cerrar salida',
      icon: 'fa-anchor',
      danger: true,
    },
  }
  const prompt = prompts[status]
  if (prompt && !(await confirmStore.ask(prompt))) return

  try {
    await apiUpdateCruise(cruise._id, { status })
    play('success')
    toast.success(`${label(cruise)} · ${STATUS_LABELS[status].toLowerCase()}`)
    await refresh()
    await cruiseStore.loadActive(true)
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  }
}

async function onPassengersSaved() {
  paxTarget.value = null
  await refresh()
  await cruiseStore.loadActive(true)
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1 class="page-title">Salidas</h1>
      <button type="button" class="btn btn-ghost" @click="showSettings = true">
        <i class="fa-solid fa-sliders" aria-hidden="true" /> Configurar ciclo
      </button>
    </header>

    <!-- Programar ciclo A → B → C -->
    <section class="cycle">
      <h2 class="section-title">Programar ciclo</h2>
      <div class="cycle-grid">
        <article v-for="(leg, i) in settings?.legs ?? []" :key="leg.code" class="leg">
          <span class="leg-icon"><i class="fa-solid" :class="LEG_ICONS[i]" aria-hidden="true" /></span>
          <div class="leg-body">
            <h3><strong>{{ leg.code }}</strong> · {{ leg.label }}</h3>
            <p>{{ leg.routeFrom }} → {{ leg.routeTo }}</p>
            <p class="leg-meta">{{ leg.durationDays }} días · zarpe {{ leg.departureTime }}</p>
          </div>
        </article>

        <article class="generate">
          <div class="field">
            <label>Inicio del tramo A</label>
            <BaseDatePicker v-model="startDate" placeholder="Sábado de inicio" />
          </div>
          <div class="field">
            <label>Generar hasta</label>
            <BaseDatePicker v-model="untilDate" placeholder="Fecha final" />
          </div>
          <button type="button" class="btn btn-primary" :disabled="generating" @click="generate">
            <i class="fa-regular fa-clock" aria-hidden="true" />
            {{ generating ? 'Generando…' : 'Generar próximas salidas' }}
          </button>
        </article>
      </div>
      <p class="rule">
        Se repite A → B → C con su código y {{ settings?.cabinCount ?? 9 }} cabinas limpias. Volver a
        generar no duplica salidas y nunca toca los viajes cerrados.
      </p>
    </section>

    <div class="tabs">
      <button type="button" class="tab" :class="{ 'tab--on': tab === 'proximas' }" @click="tab = 'proximas'">
        Próximas y a bordo
      </button>
      <button type="button" class="tab" :class="{ 'tab--on': tab === 'cerradas' }" @click="tab = 'cerradas'">
        Cerradas
      </button>
    </div>

    <SkeletonList v-if="loading" variant="card" :rows="3" />
    <p v-else-if="!visible.length" class="empty">
      {{ tab === 'cerradas' ? 'Aún no hay salidas cerradas.' : 'No hay salidas programadas. Genera el ciclo arriba.' }}
    </p>

    <TransitionGroup v-else name="list" tag="div" class="cruises">
      <article v-for="cruise in visible" :key="cruise._id" class="cruise" :class="`cruise--${cruise.status}`">
        <header class="cruise-head">
          <div class="cruise-title">
            <h3>{{ label(cruise) }}</h3>
            <p v-if="cruise.routeFrom" class="cruise-route">
              <i class="fa-solid fa-route" aria-hidden="true" /> {{ cruise.routeFrom }} → {{ cruise.routeTo }}
            </p>
            <p class="cruise-dates">
              <i class="fa-regular fa-calendar" aria-hidden="true" />
              {{ formatDate(cruise.startDate) }}
              <template v-if="cruise.endDate"> → {{ formatDate(cruise.endDate) }}</template>
            </p>
          </div>
          <span class="status" :class="`status--${cruise.status}`">{{ STATUS_LABELS[cruise.status] }}</span>
        </header>

        <div class="cabin-grid">
          <button
            v-for="cabin in cruise.cabins"
            :key="cabin.number"
            type="button"
            class="cabin-chip"
            :class="{ 'cabin-chip--filled': cabin.passengers.length }"
            @click="paxTarget = { cruise, cabin }"
          >
            <strong>{{ cabin.number }}</strong>
            <span>{{ cabin.passengers.length ? cabin.guestName : 'Vacía' }}</span>
            <small v-if="cabin.passengers.length > 1">{{ cabin.passengers.length }} pax</small>
          </button>
        </div>

        <footer class="cruise-actions">
          <button v-if="cruise.status === 'planificado'" type="button" class="btn btn-primary" @click="setStatus(cruise, 'abordo')">
            <i class="fa-solid fa-ship" aria-hidden="true" /> Iniciar salida
          </button>
          <button v-if="cruise.status === 'abordo'" type="button" class="btn btn-ghost" @click="setStatus(cruise, 'cerrado')">
            <i class="fa-solid fa-anchor" aria-hidden="true" /> Cerrar salida
          </button>
        </footer>
      </article>
    </TransitionGroup>

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

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1rem;

  .page-title {
    margin-bottom: 0;
  }
}

.section-title {
  font-family: var(--font-sans);
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--ink-400);
  margin-bottom: 0.6rem;
}

.cycle {
  margin-bottom: 1.5rem;
}

.cycle-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
  align-items: start;

  @include tablet {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @include wide {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.leg,
.generate {
  background: var(--surface);
  border: 1px solid var(--cream-200);
  border-radius: var(--radius);
  padding: 1rem;
  min-width: 0;
}

.leg {
  display: flex;
  gap: 0.8rem;
}

.leg-icon {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--powder-100);
  color: var(--navy-700);
}

.leg-body {
  min-width: 0;

  h3 {
    font-family: var(--font-sans);
    font-size: 0.95rem;
    font-weight: 600;
  }

  p {
    margin: 0.15rem 0 0;
    font-size: 0.88rem;
    color: var(--ink-600);
  }
}

.leg-meta {
  font-size: 0.78rem !important;
  color: var(--ink-400) !important;
}

.generate {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  background: var(--powder-100);
}

.rule {
  margin: 0.6rem 0 0;
  font-size: 0.82rem;
  color: var(--ink-400);
}

.tabs {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.9rem;
}

.tab {
  min-height: 40px;
  padding: 0.4rem 1rem;
  border-radius: 999px;
  border: 1.5px solid var(--cream-200);
  background: var(--surface);
  font-weight: 600;
  font-size: 0.86rem;
  color: var(--ink-600);
  transition: all 0.15s ease;

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }
}

.empty {
  color: var(--ink-400);
}

.cruises {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;

  @include desktop {
    grid-template-columns: repeat(auto-fill, minmax(460px, 1fr));
  }
}

.cruise {
  background: var(--surface);
  border: 1px solid var(--cream-200);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 1rem;
  min-width: 0;

  &--abordo {
    border-color: var(--success);
    box-shadow: 0 0 0 3px rgba(63, 122, 87, 0.12);
  }
}

.cruise-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.8rem;
}

.cruise-title {
  min-width: 0;

  h3 {
    font-size: 1.15rem;
  }

  p {
    margin: 0.15rem 0 0;
    font-size: 0.84rem;
    color: var(--ink-600);
  }

  i {
    width: 1rem;
    color: var(--gold-500);
  }
}

.status {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  background: var(--powder-100);
  color: var(--navy-700);
  white-space: nowrap;

  &--abordo {
    background: rgba(63, 122, 87, 0.15);
    color: var(--success);
  }

  &--cerrado {
    background: var(--cream-200);
    color: var(--ink-600);
  }
}

.cabin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
  gap: 0.4rem;
  margin-bottom: 0.8rem;
}

.cabin-chip {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.05rem;
  padding: 0.45rem 0.25rem;
  border: 1.5px dashed var(--cream-200);
  border-radius: var(--radius-sm);
  font-size: 0.7rem;
  color: var(--ink-400);
  transition: border-color 0.14s ease, background 0.14s ease;

  strong {
    font-size: 0.98rem;
    color: var(--ink-900);
  }

  span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    font-size: 0.64rem;
    font-weight: 700;
    color: var(--gold-500);
  }

  &--filled {
    border-style: solid;
    border-color: var(--powder-300);
    background: var(--powder-100);
    color: var(--ink-600);
  }

  &:hover {
    border-color: var(--gold-500);
  }
}

.cruise-actions {
  display: flex;
  gap: 0.5rem;
}
</style>
