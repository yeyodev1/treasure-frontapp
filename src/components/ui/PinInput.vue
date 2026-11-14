<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Clave de 4 números con teclado en pantalla (pedido del cliente,
 * 13-nov-2026): en la tableta no se despliega el teclado del sistema. Se ven
 * puntos, nunca los números. En computadora también se puede escribir.
 */
defineProps<{ label?: string; invalid?: boolean }>()
const model = defineModel<string>({ default: '' })

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'borrar'] as const

function press(key: string) {
  if (key === 'borrar') model.value = model.value.slice(0, -1)
  else if (/^\d$/.test(key) && model.value.length < 4) model.value += key
}

function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') return
  if (/^\d$/.test(e.key)) press(e.key)
  else if (e.key === 'Backspace') press('borrar')
  else return
  e.preventDefault()
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="pin-wrap">
    <div
      class="pin"
      :class="{ 'pin--invalid': invalid }"
      role="img"
      :aria-label="`${label ?? 'Clave'}: ${model.length} de 4 números`"
    >
      <span v-for="i in 4" :key="i" class="pin-box" :class="{ filled: model.length >= i, current: model.length === i - 1 }">
        {{ model.length >= i ? '•' : '' }}
      </span>
    </div>
    <div class="keypad">
      <template v-for="(k, i) in KEYS" :key="i">
        <span v-if="!k" aria-hidden="true" />
        <button
          v-else
          type="button"
          class="key"
          :class="{ 'key--del': k === 'borrar' }"
          :aria-label="k === 'borrar' ? 'Borrar' : k"
          :disabled="k === 'borrar' ? !model.length : model.length >= 4"
          @click="press(k)"
        >
          <i v-if="k === 'borrar'" class="fa-solid fa-delete-left" aria-hidden="true" />
          <template v-else>{{ k }}</template>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
.pin-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.pin {
  display: inline-flex;
  gap: 0.6rem;
}

.pin-box {
  width: 56px;
  height: 60px;
  display: grid;
  place-items: center;
  font-size: 1.6rem;
  font-weight: 700;
  border-radius: var(--radius-sm);
  border: 2px solid var(--ink-400);
  background: #fff;
  color: var(--navy-800);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;

  &.current {
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

.keypad {
  width: 100%;
  max-width: 300px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.6rem;
}

.key {
  min-height: 60px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
  background: var(--powder-100);
  color: var(--navy-900);
  font-size: 1.5rem;
  font-weight: 600;
  touch-action: manipulation;
  transition: background 0.12s ease, transform 0.12s ease;

  &:active:not(:disabled) {
    background: var(--powder-200);
    transform: scale(0.96);
  }

  &:disabled {
    opacity: 0.4;
  }

  &--del {
    background: transparent;
    font-size: 1.3rem;
  }
}
</style>
