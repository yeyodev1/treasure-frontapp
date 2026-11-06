<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { Cruise } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { apiUpdateContinuations } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDate } from '@/utils/format'

/**
 * Crucero unido (pedido del cliente, 6-nov-2026): qué cabinas de este crucero
 * siguen de un crucero anterior. Todo el barco, algunas cabinas, o con cambio
 * de cabina. La cuenta es una sola y se cobra al final.
 */
const props = defineProps<{ cruise: Cruise; cruises: Cruise[] }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const toast = useToastStore()
const { play } = useSound()
const name = (c: Cruise) => (c.code ? `Crucero ${c.code}` : c.name)

const origins = computed(() =>
  props.cruises
    .filter((c) => c._id !== props.cruise._id && c.startDate < props.cruise.startDate)
    .sort((a, b) => b.startDate.localeCompare(a.startDate)),
)
const originOptions = computed(() =>
  origins.value.map((c) => ({ value: c._id, label: `${name(c)} · ${formatDate(c.startDate)}` })),
)

const linkedOrigin = props.cruise.cabins.find((c) => c.continuesFrom)?.continuesFrom?.cruise
const originId = shallowRef(linkedOrigin ?? origins.value[0]?._id ?? '')
const origin = computed(() => origins.value.find((c) => c._id === originId.value) ?? null)

/** Cabina de destino → cabina de origen ('' = no continúa). */
const rows = ref<Record<number, string>>({})
function fromCurrent() {
  rows.value = Object.fromEntries(
    props.cruise.cabins.map((c) => [
      c.number,
      c.continuesFrom?.cruise === originId.value ? String(c.continuesFrom.cabinNumber) : '',
    ]),
  )
}
watch(originId, fromCurrent, { immediate: true })

const cabinOptions = computed(() => [
  { value: '', label: 'No continúa' },
  ...(origin.value?.cabins ?? []).map((c) => ({
    value: String(c.number),
    label: `Cabina ${c.number}${c.guestName ? ` · ${c.guestName}` : ''}`,
  })),
])

/** Todo el barco: cada cabina con gente sigue en la misma cabina. */
function wholeShip() {
  for (const c of origin.value?.cabins ?? []) {
    if (c.passengers.length && c.number in rows.value) rows.value[c.number] = String(c.number)
  }
}

function otherOrigin(number: number) {
  const from = props.cruise.cabins.find((c) => c.number === number)?.continuesFrom
  if (!from || from.cruise === originId.value) return ''
  const c = props.cruises.find((x) => x._id === from.cruise)
  return `Ya sigue de ${c ? name(c) : 'otro crucero'} · cabina ${from.cabinNumber}`
}

const saving = shallowRef(false)
async function save() {
  type Link = { to: number; fromCruise: string | null; fromCabin?: number }
  const links = props.cruise.cabins.flatMap((c): Link[] => {
    const value = rows.value[c.number]
    if (value) return [{ to: c.number, fromCruise: originId.value, fromCabin: Number(value) }]
    // Solo se suelta la que venía de este origen; las de otro crucero no se tocan.
    return c.continuesFrom?.cruise === originId.value ? [{ to: c.number, fromCruise: null }] : []
  })
  if (!links.length) {
    emit('close')
    return
  }
  saving.value = true
  try {
    await apiUpdateContinuations(props.cruise._id, links)
    play('success')
    toast.success('Crucero unido guardado')
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
  <BaseModal
    :title="`Unir ${name(cruise)} con un crucero anterior`"
    subtitle="Elige de qué cabina viene cada una. La cuenta del bar sigue abierta y se cobra una sola vez, al final del viaje."
    size="lg"
    @close="emit('close')"
  >
    <p v-if="!origins.length" class="empty">No hay cruceros anteriores a este.</p>
    <div v-else class="join">
      <div class="field">
        <label>Viene del crucero</label>
        <BaseSelect v-model="originId" :options="originOptions" />
      </div>
      <div class="quick">
        <button type="button" class="btn btn-secondary" @click="wholeShip">
          <i class="fa-solid fa-ship" aria-hidden="true" /> Todo el barco sigue
        </button>
        <button type="button" class="btn btn-ghost" @click="fromCurrent">Deshacer cambios</button>
      </div>
      <ul class="rows">
        <li v-for="c in cruise.cabins" :key="c.number" class="row">
          <span class="row-cabin">
            <strong>Cabina {{ c.number }}</strong>
            <small>{{ c.guestName || 'Sin pasajeros' }}</small>
          </span>
          <BaseSelect v-model="rows[c.number]!" :options="cabinOptions" />
          <small v-if="otherOrigin(c.number)" class="row-note">{{ otherOrigin(c.number) }}</small>
        </li>
      </ul>
      <p class="hint">
        <i class="fa-solid fa-circle-info" aria-hidden="true" />
        Si la cabina está vacía, recibe los pasajeros de la de origen. Al finalizar el crucero anterior, estas cabinas no quedan por cobrar.
      </p>
    </div>

    <template #footer>
      <button type="button" class="btn btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="button" class="btn btn-primary btn-lg" :disabled="saving || !origins.length" @click="save">
        <i class="fa-solid" :class="saving ? 'fa-spinner fa-spin' : 'fa-link'" aria-hidden="true" />
        {{ saving ? 'Guardando…' : 'Guardar' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.join {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.rows {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.4rem;
  padding: 0.7rem 0;
  border-bottom: 1px solid var(--rule);

  @include tablet {
    grid-template-columns: 200px 1fr;
    align-items: center;
  }
}

.row-cabin {
  display: flex;
  flex-direction: column;

  small {
    color: var(--ink-400);
  }
}

.row-note {
  grid-column: 1 / -1;
  color: var(--gold-600);
}

.hint,
.empty {
  margin: 0;
  color: var(--ink-600);
  font-size: 0.92rem;
}
</style>
