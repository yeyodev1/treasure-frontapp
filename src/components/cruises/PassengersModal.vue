<script setup lang="ts">
import { ref, shallowRef } from 'vue'
import type { Cabin, Passenger } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'
import { apiUpdatePassengers } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { COUNTRY_OPTIONS } from '@/utils/countries'

const props = defineProps<{ cruiseId: string; cruiseLabel: string; cabin: Cabin; readonly: boolean }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const toast = useToastStore()
const confirmStore = useConfirmStore()
const { play } = useSound()

function blank(isPayer = false): Passenger {
  return { name: '', country: '', nationality: '', idNumber: '', email: '', phone: '', isPayer }
}

const passengers = ref<Passenger[]>(
  props.cabin.passengers.length ? props.cabin.passengers.map((p) => ({ ...p })) : [blank(true)],
)
const saving = shallowRef(false)

function add() {
  passengers.value.push(blank(!passengers.value.length))
}

async function remove(index: number) {
  const p = passengers.value[index]!
  if (p.name) {
    const ok = await confirmStore.ask({
      title: `¿Quitar a ${p.name}?`,
      message: 'Se elimina de la cabina al guardar.',
      confirmLabel: 'Quitar',
      danger: true,
      icon: 'fa-user-minus',
    })
    if (!ok) return
  }
  const wasPayer = p.isPayer
  passengers.value.splice(index, 1)
  if (wasPayer && passengers.value[0]) passengers.value[0].isPayer = true
}

function setPayer(index: number) {
  passengers.value.forEach((p, i) => (p.isPayer = i === index))
}

async function save() {
  const clean = passengers.value.filter((p) => p.name.trim())
  if (passengers.value.some((p) => !p.name.trim() && (p.email || p.idNumber || p.phone))) {
    toast.error('Cada pasajero necesita su nombre')
    return
  }
  saving.value = true
  try {
    await apiUpdatePassengers(props.cruiseId, props.cabin.number, clean)
    play('success')
    toast.success(`Cabina ${props.cabin.number}: ${clean.length} pasajero(s) guardados`)
    emit('saved')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Cabina ${cabin.number} · ${cruiseLabel}`" @close="emit('close')">
    <div class="pax">
      <p class="intro">
        Registra a cada persona. La facturación toma los datos del pagador y solo pide lo que falte.
      </p>

      <TransitionGroup name="list" tag="div" class="list">
        <article v-for="(p, index) in passengers" :key="index" class="person" :class="{ 'person--payer': p.isPayer }">
          <header class="person-head">
            <span class="person-n">Pasajero {{ index + 1 }}</span>
            <button
              type="button"
              class="payer-toggle"
              :class="{ on: p.isPayer }"
              :disabled="readonly"
              @click="setPayer(index)"
            >
              <i class="fa-solid" :class="p.isPayer ? 'fa-circle-check' : 'fa-circle'" aria-hidden="true" />
              {{ p.isPayer ? 'Pagador' : 'Marcar como pagador' }}
            </button>
            <button
              v-if="!readonly"
              type="button"
              class="person-remove"
              aria-label="Quitar pasajero"
              @click="remove(index)"
            >
              <i class="fa-solid fa-user-minus" aria-hidden="true" />
            </button>
          </header>

          <div class="grid">
            <div class="field span-2">
              <label :for="`pax-name-${index}`">Nombre completo</label>
              <input :id="`pax-name-${index}`" v-model="p.name" type="text" :disabled="readonly" />
            </div>
            <div class="field">
              <label>País de residencia</label>
              <BaseSelect v-model="p.country" :options="COUNTRY_OPTIONS" searchable placeholder="Buscar país…" :disabled="readonly" />
            </div>
            <div class="field">
              <label>Nacionalidad</label>
              <BaseSelect v-model="p.nationality" :options="COUNTRY_OPTIONS" searchable placeholder="Buscar…" :disabled="readonly" />
            </div>
            <div class="field">
              <label :for="`pax-id-${index}`">Pasaporte / cédula</label>
              <input :id="`pax-id-${index}`" v-model="p.idNumber" type="text" :disabled="readonly" />
            </div>
            <div class="field">
              <label :for="`pax-phone-${index}`">Teléfono (opcional)</label>
              <input :id="`pax-phone-${index}`" v-model="p.phone" type="tel" :disabled="readonly" />
            </div>
            <div class="field span-2">
              <label :for="`pax-email-${index}`">Correo (opcional)</label>
              <input :id="`pax-email-${index}`" v-model="p.email" type="email" :disabled="readonly" />
            </div>
          </div>
        </article>
      </TransitionGroup>

      <template v-if="!readonly">
        <button type="button" class="btn btn-ghost" @click="add">
          <i class="fa-solid fa-user-plus" aria-hidden="true" /> Agregar pasajero
        </button>
        <button type="button" class="btn btn-gold" :disabled="saving" @click="save">
          <i class="fa-solid fa-floppy-disk" aria-hidden="true" />
          {{ saving ? 'Guardando…' : 'Guardar pasajeros' }}
        </button>
      </template>
      <p v-else class="intro">La salida está cerrada: los pasajeros se conservan solo para consulta.</p>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.pax {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.intro {
  margin: 0;
  font-size: 0.86rem;
  color: var(--ink-600);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.person {
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  padding: 0.85rem;
  transition: border-color 0.15s ease;

  &--payer {
    border-color: var(--gold-500);
  }
}

.person-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.65rem;
}

.person-n {
  font-weight: 700;
  font-size: 0.85rem;
}

.payer-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-400);
  border: 1px solid var(--cream-200);

  &.on {
    color: #fff;
    background: var(--gold-500);
    border-color: var(--gold-500);
  }
}

.person-remove {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--danger);

  &:hover {
    background: rgba(180, 72, 59, 0.1);
  }
}

.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.6rem;

  @include tablet {
    grid-template-columns: 1fr 1fr;
  }
}

.span-2 {
  @include tablet {
    grid-column: span 2;
  }
}
</style>
