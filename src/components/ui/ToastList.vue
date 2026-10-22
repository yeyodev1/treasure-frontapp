<script setup lang="ts">
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()
</script>

<template>
  <div class="toasts" aria-live="polite">
    <TransitionGroup name="toast">
      <button
        v-for="toast in toastStore.toasts"
        :key="toast.id"
        class="toast"
        :class="`toast--${toast.kind}`"
        type="button"
        @click="toastStore.dismiss(toast.id)"
      >
        {{ toast.message }}
      </button>
    </TransitionGroup>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.toasts {
  position: fixed;
  bottom: calc(72px + env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  z-index: 100;
  width: min(92vw, 420px);

  @include desktop {
    bottom: 1.5rem;
  }
}

.toast {
  padding: 0.75rem 1rem;
  border-radius: var(--radius-sm);
  color: #fff;
  font-weight: 600;
  box-shadow: var(--shadow-lg);
  text-align: left;

  &--success {
    background: var(--success);
  }

  &--error {
    background: var(--danger);
  }

  &--info {
    background: var(--navy-700);
  }
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
