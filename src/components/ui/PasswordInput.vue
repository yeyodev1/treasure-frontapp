<script setup lang="ts">
import { shallowRef } from 'vue'

defineProps<{ id: string; autocomplete?: string; placeholder?: string }>()
const model = defineModel<string>({ default: '' })
const visible = shallowRef(false)
</script>

<template>
  <div class="password">
    <input
      :id="id"
      v-model="model"
      :type="visible ? 'text' : 'password'"
      :autocomplete="autocomplete ?? 'current-password'"
      :placeholder="placeholder"
    />
    <button
      type="button"
      class="password-eye"
      :aria-label="visible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
      :title="visible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
      @click="visible = !visible"
    >
      <i class="fa-regular" :class="visible ? 'fa-eye-slash' : 'fa-eye'" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.password {
  position: relative;
  width: 100%;
}

.password input {
  padding-right: 3rem !important;
}

.password-eye {
  position: absolute;
  top: 50%;
  right: 0.35rem;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  color: var(--ink-400);
  transition: color 0.15s ease, background 0.15s ease;
}

.password-eye:hover {
  color: var(--navy-800);
  background: var(--cream-100);
}
</style>
