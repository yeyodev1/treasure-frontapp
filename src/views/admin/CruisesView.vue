<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import { useCruiseStore } from '@/stores/cruise'
import { useToastStore } from '@/stores/toast'
import {
  apiCreateCruise,
  apiCruises,
  apiUpdateCabin,
  apiUpdateCruise,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDate } from '@/utils/format'
import BaseModal from '@/components/ui/BaseModal.vue'
import type { Cabin, Cruise, CruiseStatus } from '@/types'

const toast = useToastStore()
const cruiseStore = useCruiseStore()

const cruises = ref<Cruise[]>([])
const showCreate = shallowRef(false)
const createForm = ref({ name: '', startDate: new Date().toISOString().slice(0, 10), cabinCount: 9 })
const saving = shallowRef(false)

const cabinTarget = shallowRef<{ cruise: Cruise; cabin: Cabin } | null>(null)
const cabinForm = ref({ guestName: '', guestCount: 1, country: '', email: '', phone: '' })

const STATUS_LABELS: Record<CruiseStatus, string> = {
  planificado: 'Planificado',
  abordo: 'A bordo',
  cerrado: 'Cerrado',
}

async function refresh() {
  try {
    cruises.value = await apiCruises()
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

onMounted(refresh)

async function createCruise() {
  if (!createForm.value.name) return
  saving.value = true
  try {
    await apiCreateCruise(createForm.value)
    toast.success('Crucero creado')
    showCreate.value = false
    await refresh()
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}

async function setStatus(cruise: Cruise, status: CruiseStatus) {
  try {
    await apiUpdateCruise(cruise._id, { status })
    toast.success(`Crucero ${STATUS_LABELS[status].toLowerCase()}`)
    await refresh()
    await cruiseStore.loadActive(true)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

function openCabin(cruise: Cruise, cabin: Cabin) {
  cabinTarget.value = { cruise, cabin }
  cabinForm.value = {
    guestName: cabin.guestName,
    guestCount: cabin.guestCount || 1,
    country: cabin.country,
    email: cabin.email,
    phone: cabin.phone,
  }
}

async function saveCabin() {
  if (!cabinTarget.value) return
  saving.value = true
  try {
    await apiUpdateCabin(
      cabinTarget.value.cruise._id,
      cabinTarget.value.cabin.number,
      cabinForm.value,
    )
    toast.success('Cabina actualizada')
    cabinTarget.value = null
    await refresh()
    await cruiseStore.loadActive(true)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1 class="page-title">Cruceros</h1>
      <button type="button" class="btn btn-gold" @click="showCreate = true">＋ Nuevo crucero</button>
    </header>

    <div class="cruises">
      <article v-for="cruise in cruises" :key="cruise._id" class="card cruise">
        <header class="cruise-head">
          <div>
            <h3>{{ cruise.name }}</h3>
            <p class="cruise-dates">
              {{ formatDate(cruise.startDate) }}
              <template v-if="cruise.endDate"> → {{ formatDate(cruise.endDate) }}</template>
            </p>
          </div>
          <span class="status" :class="`status--${cruise.status}`">
            {{ STATUS_LABELS[cruise.status] }}
          </span>
        </header>

        <div class="cabin-grid">
          <button
            v-for="cabin in cruise.cabins"
            :key="cabin.number"
            type="button"
            class="cabin-chip"
            :class="{ 'cabin-chip--filled': cabin.guestName }"
            @click="openCabin(cruise, cabin)"
          >
            <strong>{{ cabin.number }}</strong>
            <span>{{ cabin.guestName || '—' }}</span>
          </button>
        </div>

        <footer class="cruise-actions">
          <button
            v-if="cruise.status === 'planificado'"
            type="button"
            class="btn btn-primary"
            @click="setStatus(cruise, 'abordo')"
          >
            Iniciar crucero
          </button>
          <button
            v-if="cruise.status === 'abordo'"
            type="button"
            class="btn btn-ghost"
            @click="setStatus(cruise, 'cerrado')"
          >
            Cerrar crucero
          </button>
        </footer>
      </article>

      <p v-if="!cruises.length" class="empty">Aún no hay cruceros creados.</p>
    </div>

    <BaseModal v-if="showCreate" title="Nuevo crucero" @close="showCreate = false">
      <div class="modal-form">
        <div class="field">
          <label for="cr-name">Nombre</label>
          <input id="cr-name" v-model="createForm.name" type="text" placeholder="Ej. Galápagos 25-oct" />
        </div>
        <div class="field">
          <label for="cr-date">Fecha de inicio</label>
          <input id="cr-date" v-model="createForm.startDate" type="date" />
        </div>
        <div class="field">
          <label for="cr-cabins">Número de cabinas</label>
          <input id="cr-cabins" v-model.number="createForm.cabinCount" type="number" min="1" max="30" />
        </div>
        <button type="button" class="btn btn-gold" :disabled="saving" @click="createCruise">
          {{ saving ? 'Creando…' : 'Crear crucero' }}
        </button>
      </div>
    </BaseModal>

    <BaseModal
      v-if="cabinTarget"
      :title="`Cabina ${cabinTarget.cabin.number} · ${cabinTarget.cruise.name}`"
      @close="cabinTarget = null"
    >
      <div class="modal-form">
        <div class="field">
          <label for="cb-name">Nombre del huésped</label>
          <input id="cb-name" v-model="cabinForm.guestName" type="text" />
        </div>
        <div class="row">
          <div class="field">
            <label for="cb-count">Personas</label>
            <input id="cb-count" v-model.number="cabinForm.guestCount" type="number" min="0" />
          </div>
          <div class="field">
            <label for="cb-country">País</label>
            <input id="cb-country" v-model="cabinForm.country" type="text" />
          </div>
        </div>
        <div class="field">
          <label for="cb-email">Correo (opcional, se pide al facturar)</label>
          <input id="cb-email" v-model="cabinForm.email" type="email" />
        </div>
        <div class="field">
          <label for="cb-phone">Teléfono (opcional)</label>
          <input id="cb-phone" v-model="cabinForm.phone" type="tel" />
        </div>
        <button type="button" class="btn btn-gold" :disabled="saving" @click="saveCabin">
          {{ saving ? 'Guardando…' : 'Guardar cabina' }}
        </button>
      </div>
    </BaseModal>
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

.cruises {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 820px;
}

.cruise-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.75rem;

  h3 {
    font-size: 1.05rem;
  }
}

.cruise-dates {
  margin: 0.15rem 0 0;
  font-size: 0.82rem;
  color: var(--ink-400);
  font-weight: 600;
}

.status {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  background: var(--cream-200);
  white-space: nowrap;

  &--abordo {
    background: rgba(63, 174, 106, 0.15);
    color: var(--success);
  }

  &--cerrado {
    background: rgba(125, 143, 161, 0.18);
    color: var(--ink-600);
  }
}

.cabin-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.4rem;
  margin-bottom: 0.75rem;

  @include tablet {
    grid-template-columns: repeat(9, 1fr);
  }
}

.cabin-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  padding: 0.45rem 0.2rem;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  font-size: 0.7rem;
  color: var(--ink-400);

  strong {
    font-size: 0.95rem;
    color: var(--ink-900);
  }

  span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &--filled {
    border-color: var(--teal-400);
    background: rgba(79, 209, 197, 0.08);
  }
}

.cruise-actions {
  display: flex;
  gap: 0.5rem;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.empty {
  color: var(--ink-400);
}
</style>
