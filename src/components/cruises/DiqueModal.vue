<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseDatePicker from '@/components/ui/BaseDatePicker.vue'
import { useToastStore } from '@/stores/toast'
import { apiCreateShipStop, apiDeleteShipStop, apiShipStops, type ShipStopRow } from '@/services/api'
import { useConfirmStore } from '@/stores/confirm'
import { formatDate } from '@/utils/format'
import { daysBetween } from '@/components/owner/insights'
import { apiErrorMessage } from '@/services/httpBase'

/**
 * Registrar el dique (arreglo del barco) con fechas y motivo. Desde la
 * especificación del Resumen (24-nov-2026) se registra en Cruceros; las paras
 * no se marcan: son los días sin crucero ni dique.
 */
const emit = defineEmits<{ close: []; saved: [from: string] }>()
const toast = useToastStore()
const confirm = useConfirmStore()

/** Diques ya registrados, para quitar uno mal puesto. */
const diques = shallowRef<ShipStopRow[]>([])
async function loadDiques() {
  try {
    diques.value = (await apiShipStops()).filter((s) => s.kind === 'dique')
  } catch {
    diques.value = []
  }
}
void loadDiques()

async function remove(s: ShipStopRow) {
  const ok = await confirm.ask({
    title: '¿Quitar este dique?',
    message: `${formatDate(s.from)} a ${formatDate(s.to)}. Esos días vuelven a contar como para o navegando.`,
    confirmLabel: 'Quitar',
    danger: true,
    icon: 'fa-trash',
  })
  if (!ok) return
  try {
    await apiDeleteShipStop(s.id)
    await loadDiques()
    toast.success('Dique quitado')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

const kind = shallowRef<'para' | 'dique' | ''>('dique')
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
  if (!note.value.trim()) return 'Escribe el motivo del dique'
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
    title="Registrar dique"
    subtitle="Días de arreglo del barco. Las paras (días sin crucero) salen solas del calendario."
    @close="emit('close')"
  >
    <form id="ship-stop-form" class="stop-form" novalidate @submit.prevent="save">
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
        <label for="ship-stop-note">Motivo</label>
        <input id="ship-stop-note" v-model="note" type="text" maxlength="200" placeholder="Ej.: mantenimiento de motores" />
      </div>
      <ul v-if="diques.length" class="dique-list" aria-label="Diques registrados">
        <li v-for="d in diques" :key="d.id">
          <span><strong>{{ formatDate(d.from) }} – {{ formatDate(d.to) }}</strong><template v-if="d.note"> · {{ d.note }}</template></span>
          <button type="button" class="btn-text" @click="remove(d)"><i class="fa-solid fa-trash" aria-hidden="true" /> Quitar</button>
        </li>
      </ul>
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
.dique-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-sm);
  }

  .btn-text {
    min-height: 44px;
    color: var(--danger-ink);
  }
}

.stop-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
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
