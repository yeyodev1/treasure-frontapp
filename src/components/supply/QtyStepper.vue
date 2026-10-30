<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useSound } from '@/composables/useSound'

/**
 * Stepper táctil: − y + grandes, número editable en el centro.
 * Lo escrito no se corrige en silencio (checklist 29-oct, 16): un negativo,
 * un cero o un texto quedan tal cual con el aviso junto al campo, y el
 * modelo queda inválido (negativo o NaN) para que el formulario no envíe.
 */
const props = withDefaults(
  defineProps<{
    min?: number
    max?: number
    step?: number
    label?: string
    /** Unidad que se muestra bajo el número ("botellas", "ml"). */
    unit?: string
    disabled?: boolean
    /** Cero es válido (recepciones: "no llegó nada de esto"). */
    allowZero?: boolean
  }>(),
  { min: 0, step: 1, label: 'Cantidad', allowZero: false },
)

const model = defineModel<number>({ default: 0 })
const { play } = useSound()

function show(value: number): string {
  return Number.isFinite(value) ? String(value).replace('.', ',') : ''
}

/** Texto tal como lo escribió la persona. */
const draft = shallowRef(show(model.value))
/** Aviso cuando se ajustó al máximo disponible. */
const notice = shallowRef('')
let fromInput = false

watch(model, (value) => {
  if (fromInput) {
    fromInput = false
    return
  }
  draft.value = show(value)
})

const invalid = computed(() => {
  const v = model.value
  return !Number.isFinite(v) || v < 0 || (!props.allowZero && v === 0)
})
const error = computed(() => {
  if (props.disabled || !invalid.value) return ''
  return props.allowZero ? 'Introduce una cantidad de cero o más.' : 'Introduce una cantidad mayor que cero.'
})

const canDown = computed(
  () => !props.disabled && Number.isFinite(model.value) && (props.allowZero ? model.value > props.min : model.value > props.step),
)
const canUp = computed(() => !props.disabled && (props.max === undefined || !(model.value >= props.max)))

function bump(delta: number) {
  // Desde un decimal (0,5) el paso lleva al entero más cercano en esa dirección.
  const current = Number.isFinite(model.value) ? Math.max(model.value, 0) : 0
  let target = delta > 0 ? Math.floor(current / props.step) * props.step + props.step : Math.ceil(current / props.step) * props.step - props.step
  target = Math.round(target * 100) / 100
  if (target < props.min) target = props.min
  if (props.max !== undefined && target > props.max) target = props.max
  notice.value = ''
  model.value = target
  play('tap')
}

function setFromInput(next: number) {
  if (Object.is(next, model.value)) return
  fromInput = true
  model.value = next
}

function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  draft.value = raw
  notice.value = ''
  const clean = raw.replace(',', '.').trim()
  const value = clean === '' ? Number.NaN : Number(clean)
  if (Number.isNaN(value)) {
    setFromInput(Number.NaN)
    return
  }
  const rounded = Math.round(value * 100) / 100
  if (props.max !== undefined && rounded > props.max && rounded > 0) {
    // Más de lo disponible: se ajusta, pero se dice por qué.
    notice.value = `Hay como máximo ${show(props.max)}${props.unit ? ` ${props.unit}` : ''}: se ajustó la cantidad.`
    draft.value = show(props.max)
    setFromInput(props.max)
    return
  }
  setFromInput(rounded)
}
</script>

<template>
  <div class="qty">
    <div class="stepper" :class="{ 'stepper--disabled': disabled, 'stepper--invalid': Boolean(error) }">
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
          :value="draft"
          type="text"
          inputmode="decimal"
          :aria-label="label"
          :aria-invalid="Boolean(error)"
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
    <Transition name="fade">
      <small v-if="error" class="qty-msg qty-msg--error" role="alert">
        <i class="fa-solid fa-circle-exclamation" aria-hidden="true" /> {{ error }}
      </small>
      <small v-else-if="notice" class="qty-msg" role="status">
        <i class="fa-solid fa-circle-info" aria-hidden="true" /> {{ notice }}
      </small>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.qty {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
}

.qty-msg {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--navy-700);

  &--error {
    color: var(--danger);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.stepper--invalid .stepper-value {
  border-color: var(--danger);
}

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
  border: 1px solid var(--line-strong);
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
  border: 1px solid var(--line-strong);
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
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--ink-400);
  padding-bottom: 0.3rem;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
