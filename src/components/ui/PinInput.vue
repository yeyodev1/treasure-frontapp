<script setup lang="ts">
import { nextTick, useTemplateRef } from 'vue'

/**
 * Clave de 4 números en cuatro casillas grandes (≥ 56 px). Se ven puntos,
 * nunca los números. Teclado numérico en la tablet.
 */
const props = defineProps<{ label?: string; invalid?: boolean; autofocus?: boolean }>()
const model = defineModel<string>({ default: '' })
const inputs = useTemplateRef<HTMLInputElement[]>('boxes')

function digits(): string[] {
  return Array.from({ length: 4 }, (_, i) => model.value[i] ?? '')
}

function focus(i: number) {
  nextTick(() => inputs.value?.[i]?.focus())
}

function onInput(i: number, e: Event) {
  const el = e.target as HTMLInputElement
  const typed = el.value.replace(/\D/g, '')
  el.value = ''
  if (!typed) return
  const next = digits()
  // Se puede pegar o escribir varios seguidos.
  for (const [k, d] of [...typed].entries()) if (i + k < 4) next[i + k] = d
  model.value = next.join('').slice(0, 4)
  focus(Math.min(3, i + typed.length))
}

function onKey(i: number, e: KeyboardEvent) {
  if (e.key !== 'Backspace') return
  e.preventDefault()
  const next = digits()
  if (next[i]) next[i] = ''
  else if (i > 0) {
    next[i - 1] = ''
    focus(i - 1)
  }
  model.value = next.join('')
}

defineExpose({ focus: () => focus(Math.min(model.value.length, 3)) })
if (props.autofocus) focus(0)
</script>

<template>
  <div class="pin" :class="{ 'pin--invalid': invalid }" role="group" :aria-label="label ?? 'Clave de 4 números'">
    <input
      v-for="(d, i) in digits()"
      :key="i"
      ref="boxes"
      class="pin-box"
      :class="{ filled: d }"
      type="tel"
      inputmode="numeric"
      autocomplete="off"
      maxlength="4"
      :value="d ? '•' : ''"
      :aria-label="`Número ${i + 1} de 4`"
      @input="onInput(i, $event)"
      @keydown="onKey(i, $event)"
      @focus="($event.target as HTMLInputElement).select()"
    />
  </div>
</template>

<style scoped lang="scss">
.pin {
  display: inline-flex;
  gap: 0.6rem;
}

.pin-box {
  width: 56px;
  height: 60px;
  padding: 0;
  text-align: center;
  font-size: 1.6rem;
  font-weight: 700;
  border-radius: var(--radius-sm);
  border: 2px solid var(--ink-400);
  background: #fff;
  color: var(--navy-800);
  caret-color: transparent;

  &::selection {
    background: transparent;
  }
  transition: border-color 0.15s ease, box-shadow 0.15s ease;

  &:focus {
    outline: none;
    border-color: var(--navy-700);
    box-shadow: 0 0 0 3px rgba(39, 68, 90, 0.18);
  }

  &.filled {
    border-color: var(--navy-700);
  }

  .pin--invalid & {
    border-color: var(--danger);
  }
}
</style>
