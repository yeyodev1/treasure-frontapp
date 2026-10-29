<script setup lang="ts">
import { computed } from 'vue'
import { useSound } from '@/composables/useSound'

/** Stepper táctil: − y + grandes, número editable en el centro. */
const props = withDefaults(
  defineProps<{
    min?: number
    max?: number
    step?: number
    label?: string
    /** Unidad que se muestra bajo el número ("botellas", "ml"). */
    unit?: string
    disabled?: boolean
  }>(),
  { min: 0, step: 1, label: 'Cantidad' },
)

const model = defineModel<number>({ default: 0 })
const { play } = useSound()

const canDown = computed(() => !props.disabled && model.value > props.min)
const canUp = computed(() => !props.disabled && (props.max === undefined || model.value < props.max))

function clamp(value: number): number {
  let next = Math.round(value * 100) / 100
  if (next < props.min) next = props.min
  if (props.max !== undefined && next > props.max) next = props.max
  return next
}

function bump(delta: number) {
  // Desde un decimal (0,5) el paso lleva al entero más cercano en esa dirección.
  const current = model.value
  const target = delta > 0 ? Math.floor(current / props.step) * props.step + props.step : Math.ceil(current / props.step) * props.step - props.step
  model.value = clamp(target)
  play('tap')
}

function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value.replace(',', '.')
  if (raw === '') {
    model.value = props.min
    return
  }
  const value = Number(raw)
  if (!Number.isNaN(value)) model.value = clamp(value)
}
</script>

<template>
  <div class="stepper" :class="{ 'stepper--disabled': disabled }">
    <button
      type="button"
      class="stepper-btn"
      :disabled="!canDown"
      :aria-label="`Menos ${label}`"
      @click="bump(-step)"
    >
      <i class="fa-solid fa-minus" aria-hidden="true" />
    </button>
    <label class="stepper-value">
      <input
        :value="String(model).replace('.', ',')"
        type="text"
        inputmode="decimal"
        :aria-label="label"
        :disabled="disabled"
        @input="onInput"
        @focus="($event.target as HTMLInputElement).select()"
      />
      <span v-if="unit" class="stepper-unit">{{ unit }}</span>
    </label>
    <button
      type="button"
      class="stepper-btn stepper-btn--up"
      :disabled="!canUp"
      :aria-label="`Más ${label}`"
      @click="bump(step)"
    >
      <i class="fa-solid fa-plus" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped lang="scss">
.stepper {
  display: inline-flex;
  align-items: stretch;
  gap: 0.4rem;
}

.stepper-btn {
  width: 56px;
  min-height: 56px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--cream-200);
  background: #fff;
  color: var(--navy-800);
  font-size: 1.15rem;
  transition:
    transform 0.12s ease,
    background 0.15s ease,
    border-color 0.15s ease;

  &:active:not(:disabled) {
    transform: scale(0.93);
    background: var(--powder-100);
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  &--up {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;

    &:active:not(:disabled) {
      background: var(--navy-700);
    }
  }
}

.stepper-value {
  width: 92px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  background: #fff;
  transition: border-color 0.15s ease;

  &:focus-within {
    border-color: var(--gold-500);
  }

  input {
    width: 100%;
    border: none;
    outline: none;
    background: transparent;
    text-align: center;
    font-size: 1.35rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--ink-900);
    padding: 0.2rem 0 0;
  }
}

.stepper-unit {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--ink-400);
  padding-bottom: 0.3rem;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
