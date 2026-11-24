<script setup lang="ts">
import { reactive, shallowRef } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import { apiUpdateCruise } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { useToastStore } from '@/stores/toast'
import type { Cruise } from '@/types'

/**
 * Agencia del crucero (especificación del Resumen, 24-nov-2026): a quién se le
 * facturan las cortesías de bar y los wetsuits que paga la agencia.
 */
const props = defineProps<{ cruise: Cruise }>()
const emit = defineEmits<{ close: []; saved: [Cruise] }>()
const toast = useToastStore()

const form = reactive({
  name: props.cruise.agency?.name ?? '',
  ruc: props.cruise.agency?.ruc ?? '',
  email: props.cruise.agency?.email ?? '',
})
const saving = shallowRef(false)

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const cruise = await apiUpdateCruise(props.cruise._id, { agency: { ...form } })
    toast.success(form.name ? `Agencia de ${props.cruise.code}: ${form.name}` : 'Agencia quitada')
    emit('saved', cruise)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Agencia de ${cruise.code || cruise.name}`" subtitle="Se usa para facturarle sus cortesías y wetsuits." @close="emit('close')">
    <form id="agency-form" class="agency-form" novalidate @submit.prevent="save">
      <div class="field">
        <label for="agency-name">Razón social</label>
        <input id="agency-name" v-model="form.name" type="text" maxlength="120" autocomplete="organization" />
      </div>
      <div class="field">
        <label for="agency-ruc">RUC</label>
        <input id="agency-ruc" v-model="form.ruc" type="text" inputmode="numeric" maxlength="13" autocomplete="off" placeholder="13 números" />
      </div>
      <div class="field">
        <label for="agency-email">Correo de facturación</label>
        <input id="agency-email" v-model="form.email" type="email" inputmode="email" autocomplete="off" placeholder="facturacion@agencia.com" />
      </div>
    </form>
    <template #footer>
      <button type="button" class="btn btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="submit" form="agency-form" class="btn btn-primary" :disabled="saving">
        <i class="fa-solid" :class="saving ? 'fa-spinner fa-spin' : 'fa-check'" aria-hidden="true" />
        {{ saving ? 'Guardando…' : 'Guardar' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.agency-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
</style>
