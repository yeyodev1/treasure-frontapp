<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import type { Cabin, Passenger } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'
import { apiMoveCabin, apiUpdatePassengers } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { COUNTRY_OPTIONS } from '@/utils/countries'

const props = defineProps<{ cruiseId: string; cruiseLabel: string; cabin: Cabin; readonly: boolean; cabins?: Cabin[] }>()
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
/** Plazas de la cabina: no se registran más pasajeros que esto. */
const capacity = shallowRef(props.cabin.capacity ?? 2)

function add() {
  if (passengers.value.length >= capacity.value) {
    toast.error(`La cabina ${props.cabin.number} tiene ${capacity.value} plaza(s): sube la capacidad si corresponde`)
    return
  }
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

/**
 * Correo del pasajero: vacío o válido (checklist 29-oct, 17). El servidor
 * aplica la misma regla; aquí se avisa junto al campo sin borrar nada.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/
const EMAIL_ERROR = 'Revisa el correo. Ejemplo: nombre@dominio.com.'
/** Índices de correos que ya se revisaron (al salir del campo o al guardar). */
const touchedEmail = ref<Set<number>>(new Set())
const triedSave = shallowRef(false)

function emailInvalid(p: Passenger): boolean {
  const email = (p.email ?? '').trim()
  return email !== '' && !EMAIL_RE.test(email)
}

function showEmailError(p: Passenger, index: number): boolean {
  return (triedSave.value || touchedEmail.value.has(index)) && emailInvalid(p)
}

function touchEmail(index: number) {
  touchedEmail.value = new Set(touchedEmail.value).add(index)
}

// ---- Cambio de cabina (pedido del cliente, 17-nov-2026: upgrades, piden arriba) ----
const saved = props.cabin.passengers.filter((p) => p._id)
const otherCabins = computed(() => (props.cabins ?? []).filter((c) => c.number !== props.cabin.number))
const showMove = shallowRef(false)
const moveTo = shallowRef(0)
const moveIds = ref<string[]>(saved.map((p) => p._id!))
const movingAll = computed(() => moveIds.value.length === saved.length)
const target = computed(() => otherCabins.value.find((c) => c.number === moveTo.value) ?? null)
const moveHint = computed(() => {
  if (!target.value) return ''
  if (movingAll.value && !target.value.passengers.length) {
    return `Toda la cabina pasa a la ${target.value.number}, con su cuenta y sus consumos.`
  }
  return `${target.value.passengers.length ? 'Se suman a' : 'Pasan a'} la cabina ${target.value.number}. La cuenta y los consumos se quedan en la cabina ${props.cabin.number}.`
})

async function move() {
  const t = target.value
  if (!t || !moveIds.value.length) return
  const names = saved.filter((p) => moveIds.value.includes(p._id!)).map((p) => p.name).join(', ')
  const ok = await confirmStore.ask({
    title: `¿Mover a la cabina ${t.number}?`,
    message: `${names}. ${moveHint.value}`,
    confirmLabel: `Mover a la cabina ${t.number}`,
    icon: 'fa-right-left',
  })
  if (!ok) return
  saving.value = true
  try {
    await apiMoveCabin(props.cruiseId, props.cabin.number, t.number, movingAll.value ? undefined : moveIds.value)
    play('success')
    toast.success(`${names}: ahora en la cabina ${t.number}`)
    emit('saved')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}

async function save() {
  const clean = passengers.value.filter((p) => p.name.trim())
  if (passengers.value.some((p) => !p.name.trim() && (p.email || p.idNumber))) {
    toast.error('Cada pasajero necesita su nombre')
    return
  }
  triedSave.value = true
  if (passengers.value.some(emailInvalid)) {
    play('error')
    toast.error('No se guardaron los pasajeros: revisa el correo marcado.')
    return
  }
  saving.value = true
  try {
    await apiUpdatePassengers(
      props.cruiseId,
      props.cabin.number,
      clean.map((p) => ({ ...p, email: (p.email ?? '').trim() })),
      capacity.value,
    )
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
  <BaseModal
    :title="`Cabina ${cabin.number} · ${cruiseLabel}`"
    :subtitle="readonly
      ? 'Crucero finalizado: los pasajeros se conservan solo para consulta.'
      : 'Solo los datos para facturar. Quién paga (o si dividen la cuenta) se elige al cobrar.'"
    size="lg"
    @close="emit('close')"
  >
    <div class="pax">
      <button
        v-if="!readonly && saved.length && otherCabins.length && !showMove"
        type="button"
        class="btn btn-secondary move-open"
        @click="showMove = true"
      >
        <i class="fa-solid fa-right-left" aria-hidden="true" /> Cambiar de cabina
      </button>

      <section v-if="showMove" class="move" aria-labelledby="move-title">
        <h3 id="move-title" class="move-title">¿A qué cabina se cambian?</h3>
        <div class="move-cabins" role="radiogroup" aria-labelledby="move-title">
          <button
            v-for="c in otherCabins"
            :key="c.number"
            type="button"
            role="radio"
            class="move-cabin"
            :class="{ 'move-cabin--on': moveTo === c.number }"
            :aria-checked="moveTo === c.number"
            @click="moveTo = c.number"
          >
            <strong>{{ c.number }}</strong>
            <span>{{ c.passengers.length ? c.guestName : 'Vacía' }}</span>
          </button>
        </div>

        <fieldset v-if="saved.length > 1" class="move-who">
          <legend>¿Quién se cambia?</legend>
          <label v-for="p in saved" :key="p._id" class="move-person">
            <input v-model="moveIds" type="checkbox" :value="p._id" />
            {{ p.name }}
          </label>
        </fieldset>

        <p v-if="moveHint" class="move-hint">
          <i class="fa-solid fa-circle-info" aria-hidden="true" /> {{ moveHint }}
        </p>
        <div class="move-actions">
          <button type="button" class="btn btn-secondary" @click="showMove = false">Cancelar</button>
          <button type="button" class="btn btn-primary" :disabled="!target || !moveIds.length || saving" @click="move">
            <i class="fa-solid fa-right-left" aria-hidden="true" />
            {{ target ? `Mover a la cabina ${target.number}` : 'Elige la cabina' }}
          </button>
        </div>
      </section>

      <div v-if="!readonly" class="capacity">
        <span>Plazas de la cabina</span>
        <div class="stepper">
          <button type="button" aria-label="Menos plazas" :disabled="capacity <= Math.max(1, passengers.filter((p) => p.name.trim()).length)" @click="capacity--">
            <i class="fa-solid fa-minus" aria-hidden="true" />
          </button>
          <strong>{{ capacity }}</strong>
          <button type="button" aria-label="Más plazas" :disabled="capacity >= 6" @click="capacity++">
            <i class="fa-solid fa-plus" aria-hidden="true" />
          </button>
        </div>
      </div>

      <TransitionGroup name="list" tag="div" class="list">
        <article v-for="(p, index) in passengers" :key="index" class="person">
          <header class="person-head">
            <span class="person-n">Pasajero {{ index + 1 }}</span>
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
              <label :for="`pax-id-${index}`">Pasaporte / cédula</label>
              <input :id="`pax-id-${index}`" v-model="p.idNumber" type="text" :disabled="readonly" />
            </div>
            <div class="field span-2">
              <label :for="`pax-email-${index}`">Correo (opcional)</label>
              <input
                :id="`pax-email-${index}`"
                v-model="p.email"
                type="email"
                inputmode="email"
                autocomplete="off"
                placeholder="nombre@dominio.com"
                :class="{ invalid: showEmailError(p, index) }"
                :aria-invalid="showEmailError(p, index)"
                :aria-describedby="showEmailError(p, index) ? `pax-email-err-${index}` : undefined"
                :disabled="readonly"
                @blur="touchEmail(index)"
              />
              <Transition name="fade">
                <small v-if="showEmailError(p, index)" :id="`pax-email-err-${index}`" class="field-error" role="alert">
                  <i class="fa-solid fa-circle-exclamation" aria-hidden="true" /> {{ EMAIL_ERROR }}
                </small>
              </Transition>
            </div>
          </div>
        </article>
      </TransitionGroup>

      <button
        v-if="!readonly"
        type="button"
        class="btn btn-secondary add-btn"
        @click="add"
      >
        <i class="fa-solid fa-user-plus" aria-hidden="true" /> Agregar pasajero
      </button>
    </div>

    <template v-if="!readonly" #footer>
      <button type="button" class="btn btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="button" class="btn btn-primary btn-lg" :disabled="saving" @click="save">
        <i class="fa-solid" :class="saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'" aria-hidden="true" />
        {{ saving ? 'Guardando…' : 'Guardar pasajeros' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.capacity {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.6rem 0.9rem;
  border-radius: var(--radius-sm);
  background: var(--cream-100);
  font-weight: 600;
}

.stepper {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;

  button {
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line-strong);
    background: var(--surface);
    color: var(--navy-800);
    transition:
      border-color 0.16s ease,
      opacity 0.16s ease,
      transform 0.14s var(--ease-out);

    &:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }

    &:not(:disabled):hover {
      border-color: var(--navy-600);
    }

    &:not(:disabled):active {
      transform: scale(0.94);
    }
  }

  strong {
    min-width: 1.75rem;
    text-align: center;
    font-size: 1.25rem;
    font-variant-numeric: tabular-nums;
  }
}

.move-open {
  align-self: flex-start;
}

.move {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1rem;
  border: 1px solid var(--powder-300);
  border-radius: var(--radius-sm);
  background: var(--powder-100);
}

.move-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
}

.move-cabins {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 0.5rem;
}

.move-cabin {
  min-width: 0;
  min-height: 64px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 0.5rem 0.7rem;
  text-align: left;
  border: 2px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-600);
  transition:
    border-color 0.15s ease,
    background 0.15s ease;

  strong {
    font-size: 1.2rem;
    color: var(--ink-900);
  }

  span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.9rem;
  }

  &--on {
    border-color: var(--navy-800);
    background: var(--navy-800);
    color: var(--powder-300);

    strong {
      color: #fff;
    }
  }
}

.move-who {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  border: none;

  legend {
    margin-bottom: 0.4rem;
    font-weight: 700;
  }
}

.move-person {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-height: 48px;
  padding: 0 0.8rem;
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: 1rem;
  font-weight: 600;

  input {
    width: 22px;
    height: 22px;
  }
}

.move-hint {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  margin: 0;
  font-weight: 600;
  color: var(--navy-800);
}

.move-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.6rem;
}

.pax {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.person {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 0.9rem 1rem 1rem;
  background: var(--surface);
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease;

}

.person-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.person-n {
  font-family: var(--font-serif);
  font-weight: 700;
  font-size: 1.1rem;
}

.person-remove {
  margin-left: auto;
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--danger-ink);
  transition: background-color 0.16s ease;

  &:hover {
    background: var(--pill-danger-bg);
  }
}

.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;

  @include tablet {
    grid-template-columns: 1fr 1fr;
  }
}

.field-error {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--danger-ink);
  font-size: 0.92rem;
  font-weight: 600;
}

input.invalid {
  border-color: var(--danger);
}

.add-btn {
  align-self: flex-start;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.span-2 {
  @include tablet {
    grid-column: span 2;
  }
}
</style>
