<script setup lang="ts">
import { computed, shallowRef, useId } from 'vue'
import type { Cruise, Passenger } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { apiUpdatePassengers } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { readPassengerList, type ListRow } from '@/utils/passengerList'
import { formatDate } from '@/utils/format'

/**
 * Importar la lista de pasajeros del operador (PDF, pedido del cliente
 * 16-nov-2026): cada cama va a su cabina. Lo que ya estaba se conserva (con
 * sus consumos asignados) y solo se agregan los que faltan.
 */
const props = defineProps<{ cruise: Cruise; cruiseLabel: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const toast = useToastStore()
const { play } = useSound()
const fileId = useId()

const rows = shallowRef<ListRow[]>([])
const fileName = shallowRef('')
const reading = shallowRef(false)
const saving = shallowRef(false)

type Status = 'nuevo' | 'ya' | 'otra' | 'sin-cabina'
const STATUS_LABEL: Record<Status, string> = {
  nuevo: 'Se agrega',
  ya: 'Ya está',
  otra: 'Ya está en otra cabina',
  'sin-cabina': 'Esa cabina no existe',
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
const samePerson = (p: Pick<Passenger, 'name' | 'idNumber'>, r: ListRow) =>
  (Boolean(p.idNumber) && norm(p.idNumber) === norm(r.idNumber)) || norm(p.name) === norm(r.name)

const preview = computed(() =>
  rows.value.map((r) => {
    const cabin = props.cruise.cabins.find((c) => c.number === r.cabin)
    let status: Status = 'nuevo'
    if (!cabin) status = 'sin-cabina'
    else if (cabin.passengers.some((p) => samePerson(p, r))) status = 'ya'
    else if (props.cruise.cabins.some((c) => c.number !== r.cabin && c.passengers.some((p) => samePerson(p, r)))) status = 'otra'
    return { ...r, status }
  }),
)
const toAdd = computed(() => preview.value.filter((r) => r.status === 'nuevo'))
const listDates = computed(() => [...new Set(rows.value.map((r) => r.dates).filter(Boolean))].join(' · '))
const cruiseDates = computed(() =>
  props.cruise.endDate
    ? `${formatDate(props.cruise.startDate)} – ${formatDate(props.cruise.endDate)}`
    : formatDate(props.cruise.startDate),
)

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileName.value = file.name
  reading.value = true
  rows.value = []
  try {
    rows.value = await readPassengerList(file)
    if (!rows.value.length) {
      play('error')
      toast.error('No se encontraron pasajeros en ese PDF. Revisa que sea la lista con columnas «# cab», «Nombre y Apellido» y «Passport».')
    }
  } catch (err) {
    play('error')
    toast.error(`No se pudo leer el PDF: ${err instanceof Error ? err.message : 'archivo dañado'}`)
  } finally {
    reading.value = false
    input.value = ''
  }
}

async function save() {
  const byCabin = new Map<number, ListRow[]>()
  for (const r of toAdd.value) byCabin.set(r.cabin, [...(byCabin.get(r.cabin) ?? []), r])
  saving.value = true
  const failed: string[] = []
  let added = 0
  for (const [number, list] of byCabin) {
    const cabin = props.cruise.cabins.find((c) => c.number === number)!
    const merged: Passenger[] = [
      ...cabin.passengers,
      ...list.map((r) => ({
        name: r.name,
        idNumber: r.idNumber,
        nationality: r.nationality,
        country: r.nationality,
        email: '',
        phone: '',
        isPayer: false,
      })),
    ]
    if (merged.length > 6) {
      failed.push(`Cabina ${number}: serían ${merged.length} pasajeros (máximo 6)`)
      continue
    }
    try {
      await apiUpdatePassengers(props.cruise._id, number, merged, Math.max(cabin.capacity ?? 2, merged.length))
      added += list.length
    } catch (err) {
      failed.push(`Cabina ${number}: ${apiErrorMessage(err)}`)
    }
  }
  saving.value = false
  if (added) {
    play('success')
    toast.success(`${added} pasajero(s) agregados a ${props.cruiseLabel}`)
  }
  if (failed.length) {
    play('error')
    toast.error(failed.join(' · '))
  }
  if (added) emit('saved')
}
</script>

<template>
  <BaseModal
    :title="`Importar lista de pasajeros · ${cruiseLabel}`"
    :subtitle="`Crucero del ${cruiseDates}. Se lee el PDF del operador y cada pasajero va a su cabina. Los que ya están no se tocan.`"
    size="xl"
    @close="emit('close')"
  >
    <div class="import">
      <label :for="fileId" class="pick" :class="{ 'pick--busy': reading }">
        <i class="fa-solid" :class="reading ? 'fa-spinner fa-spin' : 'fa-file-pdf'" aria-hidden="true" />
        <span>{{ reading ? 'Leyendo la lista…' : fileName ? 'Elegir otro PDF' : 'Elegir el PDF de la lista' }}</span>
        <small v-if="fileName && !reading">{{ fileName }}</small>
      </label>
      <input :id="fileId" type="file" accept="application/pdf,.pdf" class="sr-only" :disabled="reading || saving" @change="onFile" />

      <template v-if="preview.length">
        <p v-if="listDates" class="dates">
          <i class="fa-solid fa-calendar-days" aria-hidden="true" />
          La lista dice <strong>{{ listDates }}</strong>; este crucero va del <strong>{{ cruiseDates }}</strong>. Revisa que sea el mismo.
        </p>

        <div class="table-wrap" tabindex="0" role="region" aria-labelledby="import-caption">
          <table>
            <caption id="import-caption">{{ preview.length }} pasajeros en la lista · {{ toAdd.length }} por agregar</caption>
            <thead>
              <tr>
                <th scope="col">Cama</th>
                <th scope="col">Nombre</th>
                <th scope="col">Pasaporte</th>
                <th scope="col">Nacionalidad</th>
                <th scope="col">Qué pasa</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in preview" :key="`${r.bed}-${r.idNumber}-${r.name}`" :class="`row--${r.status}`">
                <th scope="row">{{ r.bed }}</th>
                <td>{{ r.name }}</td>
                <td>{{ r.idNumber || '—' }}</td>
                <td>{{ r.nationality || '—' }}</td>
                <td>
                  <span class="tag" :class="`tag--${r.status}`">{{ STATUS_LABEL[r.status] }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="hint">El correo no viene en la lista: se completa en cada cabina si lo piden para la factura.</p>
      </template>
    </div>

    <template #footer>
      <button type="button" class="btn btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="button" class="btn btn-primary btn-lg" :disabled="saving || reading || !toAdd.length" @click="save">
        <i class="fa-solid" :class="saving ? 'fa-spinner fa-spin' : 'fa-user-plus'" aria-hidden="true" />
        {{ saving ? 'Agregando…' : toAdd.length ? `Agregar ${toAdd.length} pasajero(s)` : 'Nada por agregar' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped lang="scss">
.import {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.pick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.7rem;
  min-height: 56px;
  padding: 0.8rem 1rem;
  border: 2px dashed var(--powder-300, var(--line));
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--navy-ink, var(--navy-800));
  font-weight: 700;
  cursor: pointer;

  i {
    font-size: 1.3rem;
  }

  small {
    flex-basis: 100%;
    font-weight: 500;
    color: var(--ink-600);
    overflow-wrap: anywhere;
  }

  &--busy {
    cursor: progress;
  }
}

.pick:has(+ input:focus-visible) {
  outline: 3px solid var(--navy-900);
  outline-offset: 3px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.dates {
  display: flex;
  gap: 0.5rem;
  margin: 0;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius-sm);
  background: var(--cream-100);
  color: var(--ink-900);
  font-size: 0.9rem;
}

.table-wrap {
  overflow: auto;
  max-block-size: min(460px, 60vh);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

table {
  inline-size: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.9rem;
}

caption {
  padding: 0.6rem 0.8rem;
  text-align: start;
  font-weight: 700;
  color: var(--ink-900);
}

thead {
  position: sticky;
  inset-block-start: 0;
  z-index: 1;
}

th,
td {
  padding: 0.55rem 0.8rem;
  text-align: start;
  border-block-end: 1px solid var(--line);
}

thead th {
  background: var(--cream-100);
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--ink-600);
}

tbody th {
  font-variant-numeric: tabular-nums;
}

.row--ya,
.row--otra,
.row--sin-cabina {
  color: var(--ink-600);
}

.tag {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  white-space: nowrap;
  background: var(--cream-100);
  color: var(--ink-600);

  &--nuevo {
    background: var(--navy-800);
    color: #fff;
  }

  &--otra,
  &--sin-cabina {
    background: var(--pill-warn-bg, #f6e7c8);
    color: var(--pill-warn-ink, #6b4b12);
  }
}

.hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--ink-600);
}
</style>
