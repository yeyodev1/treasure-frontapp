<script setup lang="ts">
import { computed } from 'vue'
import { METHOD_OPTIONS, linesState, newLine, parseMoney, type PayLine } from './payLines'
import { formatMoney } from '@/utils/format'

/**
 * Formas de pago de un cobro: una o varias (ej. $10 en efectivo y el resto
 * con tarjeta). La última sin monto cubre lo que falta. Con `allowPartial`
 * se puede cobrar menos que el total (queda saldo para después).
 */
const props = defineProps<{ target: number; allowPartial?: boolean; idPrefix: string }>()
const lines = defineModel<PayLine[]>({ required: true })

const state = computed(() => linesState(lines.value, props.target, Boolean(props.allowPartial)))

function addLine() {
  // La forma actual se queda con lo que muestra; la nueva cubre el resto.
  const last = lines.value[lines.value.length - 1]
  if (last && parseMoney(last.amount) === null) {
    const amount = state.value.amounts[lines.value.length - 1] ?? 0
    last.amount = amount > 0 ? amount.toFixed(2) : ''
  }
  const used = new Set(lines.value.map((l) => l.method))
  const next = METHOD_OPTIONS.find((m) => !used.has(m.value))?.value ?? 'tarjeta'
  lines.value = [...lines.value, newLine(next)]
}

function removeLine(key: number) {
  lines.value = lines.value.filter((l) => l.key !== key)
  const last = lines.value[lines.value.length - 1]
  if (last) last.amount = ''
}

function placeholderFor(index: number) {
  const isLast = index === lines.value.length - 1
  return isLast ? (state.value.amounts[index] ?? 0).toFixed(2) : '0,00'
}
</script>

<template>
  <div class="paylines">
    <TransitionGroup name="list" tag="div" class="paylines-list">
      <div v-for="(line, i) in lines" :key="line.key" class="payline" :class="{ 'payline--multi': lines.length > 1 }">
        <div class="payline-head">
          <span v-if="lines.length > 1" class="payline-n">Forma {{ i + 1 }}</span>
          <div class="payline-amount">
            <label :for="`${idPrefix}-amt-${line.key}`" class="sr-only">Monto</label>
            <span class="amount-prefix" aria-hidden="true">$</span>
            <input
              :id="`${idPrefix}-amt-${line.key}`"
              v-model="line.amount"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              :placeholder="placeholderFor(i)"
            />
          </div>
          <small v-if="i === lines.length - 1 && !line.amount.trim()" class="payline-auto">
            {{ lines.length > 1 ? 'lo que falta' : allowPartial ? 'saldo completo' : 'total' }}
          </small>
          <button
            v-if="lines.length > 1"
            type="button"
            class="payline-remove"
            :aria-label="`Quitar forma de pago ${i + 1}`"
            @click="removeLine(line.key)"
          >
            <i class="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <div class="method-grid" role="radiogroup" :aria-label="`Método de pago ${i + 1}`">
          <button
            v-for="m in METHOD_OPTIONS"
            :key="m.value"
            type="button"
            role="radio"
            class="method"
            :class="{ 'method--on': line.method === m.value }"
            :aria-checked="line.method === m.value"
            @click="line.method = m.value"
          >
            <i class="fa-solid" :class="m.icon" aria-hidden="true" />
            {{ m.label }}
          </button>
        </div>

        <Transition name="fade" mode="out-in">
          <div v-if="line.method !== 'efectivo'" key="ref" class="field">
            <label :for="`${idPrefix}-ref-${line.key}`">
              Referencia {{ line.method === 'transferencia' ? '(obligatoria)' : '(voucher, opcional)' }}
            </label>
            <input
              :id="`${idPrefix}-ref-${line.key}`"
              v-model="line.reference"
              type="text"
              maxlength="40"
              placeholder="Número de transferencia o voucher"
            />
          </div>
          <label v-else key="cash" class="cash-check" :class="{ 'cash-check--on': line.cashConfirmed }">
            <input v-model="line.cashConfirmed" type="checkbox" />
            Confirmo que el efectivo ingresó a caja
          </label>
        </Transition>
      </div>
    </TransitionGroup>

    <button v-if="lines.length < 4" type="button" class="add-line" @click="addLine">
      <i class="fa-solid fa-plus" aria-hidden="true" />
      {{ lines.length === 1 ? 'Pagar con dos formas (ej. parte en efectivo y el resto con tarjeta)' : 'Agregar otra forma de pago' }}
    </button>

    <Transition name="fade" mode="out-in">
      <p v-if="state.error" :key="state.error" class="paylines-note paylines-note--error" role="alert">
        <i class="fa-solid fa-circle-exclamation" aria-hidden="true" /> {{ state.error }}
      </p>
      <p v-else-if="state.partial" key="partial" class="paylines-note">
        Pago parcial: queda un saldo de {{ formatMoney(target - state.total) }}.
      </p>
      <p v-else-if="lines.length > 1" key="sum" class="paylines-note">
        {{ lines.length }} formas de pago · suman {{ formatMoney(state.total) }} · una sola factura.
      </p>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.paylines {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.paylines-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.payline {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;

  &--multi {
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
}

.payline-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.payline-n {
  font-weight: 700;
  font-size: 0.9rem;
  color: var(--ink-600);
  white-space: nowrap;
}

.payline-amount {
  display: flex;
  align-items: center;
  flex: 0 1 180px;
  min-height: 48px;
  padding: 0 0.75rem;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  background: #fff;

  &:focus-within {
    border-color: var(--navy-600);
  }

  input {
    width: 100%;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 1.15rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
}

.amount-prefix {
  margin-right: 0.3rem;
  font-weight: 700;
  color: var(--ink-400);
}

.payline-auto {
  color: var(--ink-400);
  font-size: 0.82rem;
}

.payline-remove {
  margin-left: auto;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--ink-600);
  transition: background 0.15s ease;

  &:hover {
    background: var(--cream-100);
  }
}

.method-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;

  @include tablet {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.method {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-height: 48px;
  padding: 0 0.6rem;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-weight: 600;
  font-size: 0.9rem;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    transform 0.12s ease;

  &:hover:not(.method--on) {
    border-color: var(--navy-600);
  }

  &:active {
    transform: scale(0.97);
  }

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }
}

.cash-check {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 48px;
  padding: 0 0.8rem;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;

  input {
    width: 20px;
    height: 20px;
    accent-color: var(--navy-800);
  }

  &--on {
    border-color: var(--success);
    background: rgba(63, 122, 87, 0.08);
  }
}

.add-line {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  align-self: flex-start;
  min-height: 44px;
  padding: 0 0.8rem;
  border-radius: var(--radius-sm);
  border: 1.5px dashed var(--navy-600);
  font-weight: 600;
  font-size: 0.88rem;
  color: var(--navy-700);
  text-align: left;
  transition: background 0.15s ease;

  &:hover {
    background: var(--powder-100);
  }
}

.paylines-note {
  margin: 0;
  font-size: 0.88rem;
  color: var(--ink-600);

  &--error {
    color: var(--danger);
    font-weight: 600;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
