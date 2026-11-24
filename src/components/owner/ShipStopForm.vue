<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseDatePicker from '@/components/ui/BaseDatePicker.vue'
import { useToastStore } from '@/stores/toast'
import { apiCreateShipStop } from '@/services/api'
import { daysBetween } from '@/components/owner/insights'
import { apiErrorMessage } from '@/services/httpBase'

/** Marcar una para (no sale el crucero) o el dique (arreglo del barco). Sale del antiguo «Registro» (23-nov-2026). */
const emit = defineEmits<{ close: []; saved: [from: string] }>()
const toast = useToastStore()

const kind = shallowRef<'para' | 'dique' | ''>('')
const from = shallowRef('')
const to = shallowRef('')
const note = shallowRef('')
const tried = shallowRef(false)
const saving = shallowRef(false)

// Una para suele ser de un solo día: «hasta» toma el mismo día si queda vacío o antes.
watch(from, (v) => {
  if (v && (!to.value || to.value < v)) to.value = v
})

const formError = computed(() => {
  if (!kind.value) return 'Elige si es para o dique'
  if (!from.value || !to.value) return 'Elige los días desde y hasta'
  if (to.value < from.value) return '«Hasta» no puede ser antes de «Desde»'
  if (daysBetween(from.value, to.value) > 367) return 'Máximo un año por registro'
  return ''
})

async function save() {
  tried.value = true
  if (formError.value || !kind.value || saving.value) return
  saving.value = true
  try {
    await apiCreateShipStop({ kind: kind.value, from: from.value, to: to.value, note: note.value.trim() })
    toast.success('Listo, quedó marcado')
    emit('saved', from.value)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal
    title="Marcar para o dique"
    subtitle="Días en que el barco no sale. Se suma al resumen del año."
    @close="emit('close')"
  >
    <form id="ship-stop-form" class="stop-form" novalidate @submit.prevent="save">
      <fieldset class="stop-kind">
        <legend>¿Qué pasó?</legend>
        <label class="stop-kind-opt">
          <input v-model="kind" type="radio" name="ship-stop-kind" value="para" />
          <i class="fa-solid fa-circle-pause" aria-hidden="true" />
          <strong>Para</strong>
          <span>No sale el crucero</span>
        </label>
        <label class="stop-kind-opt">
          <input v-model="kind" type="radio" name="ship-stop-kind" value="dique" />
          <i class="fa-solid fa-screwdriver-wrench" aria-hidden="true" />
          <strong>Dique</strong>
          <span>Arreglo del barco</span>
        </label>
      </fieldset>
      <div class="stop-dates">
        <div class="field">
          <label>Desde</label>
          <BaseDatePicker v-model="from" placeholder="Elige el día" />
        </div>
        <div class="field">
          <label>Hasta</label>
          <BaseDatePicker v-model="to" placeholder="Elige el día" />
        </div>
      </div>
      <p v-if="from && to && to >= from" class="field-hint">
        Son {{ daysBetween(from, to) }} {{ daysBetween(from, to) === 1 ? 'día' : 'días' }}.
      </p>
      <div class="field">
        <label for="ship-stop-note">Nota (opcional)</label>
        <input id="ship-stop-note" v-model="note" type="text" maxlength="200" placeholder="Ej.: mal tiempo, mantenimiento" />
      </div>
      <p v-if="tried && formError" class="campo-error" role="alert">
        <i class="fa-solid fa-circle-exclamation" aria-hidden="true" /> {{ formError }}
      </p>
    </form>
    <template #footer>
      <button type="button" class="btn btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="submit" form="ship-stop-form" class="btn btn-primary" :disabled="saving">
        <i class="fa-solid" :class="saving ? 'fa-spinner fa-spin' : 'fa-check'" aria-hidden="true" />
        {{ saving ? 'Guardando…' : 'Guardar' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped lang="scss">
.stop-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.stop-kind {
  display: flex;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  border: 0;

  legend {
    margin-bottom: 0.4rem;
    padding: 0;
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--ink-600);
  }
}

.stop-kind-opt {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  min-height: 96px;
  padding: 0.85rem 0.5rem;
  border: 2px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--navy-900);
  text-align: center;
  cursor: pointer;

  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  i {
    font-size: 1.5rem;
    color: var(--navy-600);
  }

  strong {
    font-size: 1.1rem;
  }

  span {
    font-size: 0.85rem;
    color: var(--ink-600);
  }

  &:has(input:checked) {
    border-color: var(--navy-800);
    background: var(--navy-800);
    color: #fff;

    i,
    span {
      color: var(--powder-300);
    }
  }

  &:has(input:focus-visible) {
    box-shadow: var(--focus-ring);
  }
}

.stop-dates {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;

  .field {
    flex: 1 1 180px;
  }
}
</style>
