<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Passenger } from '@/types'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { COUNTRY_OPTIONS } from '@/utils/countries'
import { emptyBilling, EMAIL_RE, NO_CLIENT_EMAIL, type Billing } from './payLines'

/**
 * Quién paga (pedido del cliente, 31-oct-2026): los mismos datos que se
 * llenan al registrar pasajeros en el zarpe (nombre, cédula o pasaporte,
 * país y correo), ya cargados. Se elige a un pasajero o "Otra persona".
 */
const props = defineProps<{
  passengers: Array<Passenger & { cabin?: number }>
  idPrefix: string
  /** Pasajeros que ya pagaron su parte (se marcan). */
  paidNames?: string[]
}>()
const billing = defineModel<Billing>({ required: true })

/** Lo escrito en "Otra persona": vuelve si se toca un pasajero y luego "Otra persona". */
const lastOther = ref<Billing>(emptyBilling())

function pick(p: (typeof props.passengers)[number] | null) {
  if (isOther.value) lastOther.value = { ...billing.value }
  billing.value = p
    ? { passengerId: p._id ?? '', name: p.name, idNumber: p.idNumber ?? '', email: p.email ?? '', country: p.country ?? '' }
    : { ...lastOther.value }
}

const isOther = computed(() => !billing.value.passengerId)

/** Lo que había escrito antes de tocar «Cliente no da correo», por si se arrepiente. */
let emailBefore = ''
function toggleNoEmail() {
  if (billing.value.noEmail) {
    billing.value = { ...billing.value, noEmail: false, email: emailBefore }
  } else {
    emailBefore = billing.value.email
    billing.value = { ...billing.value, noEmail: true, email: NO_CLIENT_EMAIL }
  }
}
const emailBad = computed(() => Boolean(billing.value.email.trim()) && !EMAIL_RE.test(billing.value.email.trim()))
</script>

<template>
  <div class="payer-form">
    <div class="who" role="radiogroup" aria-label="Quién paga">
      <button
        v-for="p in passengers"
        :key="p._id ?? p.name"
        type="button"
        role="radio"
        class="who-chip"
        :class="{ 'who-chip--on': billing.passengerId && billing.passengerId === p._id }"
        :aria-checked="Boolean(billing.passengerId) && billing.passengerId === p._id"
        @click="pick(p)"
      >
        <i class="fa-solid fa-user" aria-hidden="true" />
        <span>{{ p.name }}</span>
        <small v-if="p.cabin">Cab {{ p.cabin }}</small>
        <small v-if="paidNames?.includes(p.name)" class="who-paid">ya pagó</small>
      </button>
      <button
        type="button"
        role="radio"
        class="who-chip"
        :class="{ 'who-chip--on': isOther }"
        :aria-checked="isOther"
        @click="pick(null)"
      >
        <i class="fa-solid fa-user-plus" aria-hidden="true" />
        <span>Otra persona</span>
      </button>
    </div>

    <div class="grid">
      <div class="field span-2">
        <label :for="`${idPrefix}-name`">Nombre para la factura</label>
        <input :id="`${idPrefix}-name`" v-model="billing.name" type="text" autocomplete="off" />
      </div>
      <div class="field">
        <label :for="`${idPrefix}-id`">Cédula / pasaporte / RUC</label>
        <input :id="`${idPrefix}-id`" v-model="billing.idNumber" type="text" autocomplete="off" />
      </div>
      <div class="field">
        <label>País</label>
        <BaseSelect v-model="billing.country" :options="COUNTRY_OPTIONS" searchable placeholder="Buscar país…" />
      </div>
      <div class="field span-2">
        <label :for="`${idPrefix}-email`">Correo para la factura</label>
        <div class="email-row">
          <input
            :id="`${idPrefix}-email`"
            v-model="billing.email"
            type="email"
            inputmode="email"
            autocomplete="off"
            placeholder="nombre@dominio.com"
            :readonly="billing.noEmail"
            :aria-invalid="emailBad"
          />
          <button type="button" class="no-email" :aria-pressed="Boolean(billing.noEmail)" @click="toggleNoEmail">
            <i class="fa-solid" :class="billing.noEmail ? 'fa-rotate-left' : 'fa-envelope-circle-check'" aria-hidden="true" />
            {{ billing.noEmail ? 'Sí da correo' : 'Cliente no da correo' }}
          </button>
        </div>
        <small v-if="billing.noEmail" class="field-hint">
          La factura se emite igual y llega a este correo de la casa. En Cobros sale como «Sin correo del cliente».
        </small>
        <Transition name="fade">
          <small v-if="emailBad" class="field-error">Revisa el correo. Ejemplo: nombre@dominio.com.</small>
        </Transition>
        <small v-if="!billing.email.trim()" class="field-hint">Obligatorio: ahí le llega la factura electrónica.</small>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.payer-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.who {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.who-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 44px;
  padding: 0 0.9rem;
  border-radius: 999px;
  border: 1.5px solid var(--cream-200);
  background: var(--surface);
  font-weight: 600;
  font-size: 0.9rem;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    transform 0.12s ease;

  i {
    color: var(--navy-600);
  }

  small {
    font-weight: 500;
    color: var(--ink-400);
  }

  &:hover:not(.who-chip--on) {
    border-color: var(--navy-600);
  }

  &:active {
    transform: scale(0.97);
  }

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;

    i,
    small {
      color: var(--powder-300);
    }
  }
}

.who-paid {
  color: var(--success) !important;
}

.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.6rem 0.75rem;

  @include tablet {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .field {
    margin: 0;
  }
}

.span-2 {
  @include tablet {
    grid-column: span 2;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.field-hint {
  font-size: 0.9rem;
  color: var(--ink-600);
}

.email-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;

  input {
    flex: 1 1 220px;
    min-width: 0;

    &:read-only {
      background: var(--cream-100);
      color: var(--ink-600);
    }
  }
}

.no-email {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.45rem;
  min-height: 44px;
  padding: 0 0.9rem;
  border: 1.5px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--navy-800);

  &[aria-pressed='true'] {
    border-color: var(--navy-800);
  }
}
</style>
