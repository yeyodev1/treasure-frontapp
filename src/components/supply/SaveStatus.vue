<script setup lang="ts">
import type { SaveState } from '@/composables/useSaveAttempt'

/** Franja de estado: Guardando… → Guardado (solo con respuesta del servidor). */
defineProps<{
  state: SaveState
  message?: string
  /** Texto de éxito: "Guardado · CP-0004". */
  savedText?: string
  offline?: boolean
}>()

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <Transition name="status" mode="out-in">
    <p v-if="state === 'saving'" key="saving" class="status status--saving" role="status">
      <span class="dot" aria-hidden="true" />
      Guardando…
    </p>
    <p v-else-if="state === 'saved'" key="saved" class="status status--saved" role="status">
      <i class="fa-solid fa-circle-check" aria-hidden="true" />
      {{ savedText ?? 'Guardado' }}
    </p>
    <div v-else-if="state === 'error'" key="error" class="status status--error" role="alert">
      <i
        class="fa-solid"
        :class="offline ? 'fa-wifi' : 'fa-circle-exclamation'"
        aria-hidden="true"
      />
      <span class="status-text">{{ message }}</span>
      <button v-if="offline" type="button" class="btn btn-primary retry" @click="emit('retry')">
        <i class="fa-solid fa-rotate-right" aria-hidden="true" /> Reintentar
      </button>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
.status {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  min-height: 52px;
  padding: 0.6rem 0.9rem;
  border-radius: var(--radius-sm);
  font-weight: 700;
  font-size: 0.98rem;

  &--saving {
    background: var(--powder-100);
    color: var(--navy-700);
  }

  &--saved {
    background: rgba(63, 122, 87, 0.12);
    color: var(--success);
  }

  &--error {
    background: rgba(180, 72, 59, 0.1);
    color: var(--danger);
  }
}

.status-text {
  flex: 1;
  min-width: 180px;
}

.retry {
  min-height: 48px;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--navy-700);
  animation: pulse 0.9s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.3;
    transform: scale(0.8);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

.status-enter-active,
.status-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.status-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.status-leave-to {
  opacity: 0;
}
</style>
