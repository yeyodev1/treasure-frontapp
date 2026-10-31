<script setup lang="ts">
import { ref, shallowRef } from 'vue'
import type { CycleSettings } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { apiUpdateCycleSettings } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'

const props = defineProps<{ settings: CycleSettings }>()
const emit = defineEmits<{ close: []; saved: [CycleSettings] }>()

const toast = useToastStore()
const { play } = useSound()

const legs = ref(props.settings.legs.map((l) => ({ ...l })))
const cabinCount = shallowRef(props.settings.cabinCount)
const saving = shallowRef(false)

async function save() {
  saving.value = true
  try {
    const settings = await apiUpdateCycleSettings({ legs: legs.value, cabinCount: cabinCount.value })
    play('success')
    toast.success('Ciclo actualizado')
    emit('saved', settings)
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal
    title="Configurar ciclo de cruceros"
    subtitle="Ruta, duración y hora de zarpe de cada tipo. Aplica a los cruceros que se creen desde ahora."
    size="lg"
    @close="emit('close')"
  >
    <div class="cfg">
      <article v-for="leg in legs" :key="leg.code" class="leg">
        <h4><span class="leg-code">{{ leg.code }}</span> Crucero {{ leg.code }} · {{ leg.label }}</h4>
        <div class="grid">
          <div class="field">
            <label :for="`from-${leg.code}`">Zarpa desde</label>
            <input :id="`from-${leg.code}`" v-model="leg.routeFrom" type="text" />
          </div>
          <div class="field">
            <label :for="`to-${leg.code}`">Llega a</label>
            <input :id="`to-${leg.code}`" v-model="leg.routeTo" type="text" />
          </div>
          <div class="field">
            <label :for="`days-${leg.code}`">Duración (días)</label>
            <input :id="`days-${leg.code}`" v-model.number="leg.durationDays" type="number" min="1" max="14" />
          </div>
          <div class="field">
            <label :for="`time-${leg.code}`">Hora de zarpe</label>
            <input :id="`time-${leg.code}`" v-model="leg.departureTime" type="text" inputmode="numeric" placeholder="10:00" />
          </div>
        </div>
      </article>

      <div class="field cabins-field">
        <label for="cabin-count">Cabinas por crucero</label>
        <input id="cabin-count" v-model.number="cabinCount" type="number" min="1" max="30" />
      </div>

    </div>

    <template #footer>
      <button type="button" class="btn btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="button" class="btn btn-primary btn-lg" :disabled="saving" @click="save">
        <i class="fa-solid" :class="saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'" aria-hidden="true" />
        {{ saving ? 'Guardando…' : 'Guardar ciclo' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.cfg {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.leg {
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--rule);
}

.leg h4 {
  margin: 0 0 0.7rem;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-family: var(--font-serif);
  font-size: 1.15rem;
  font-weight: 700;
}

.leg-code {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--navy-800);
  color: #fff;
  font-size: 0.95rem;
  font-family: var(--font-sans);
}

.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;

  @include tablet {
    grid-template-columns: 1fr 1fr;
  }
}

.cabins-field {
  max-width: 240px;
}
</style>
