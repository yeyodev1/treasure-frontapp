<script setup lang="ts">
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()

const ICONS = {
  success: 'fa-circle-check',
  error: 'fa-circle-exclamation',
  info: 'fa-circle-info',
} as const
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
        :aria-label="`${toast.message}. Tocar para cerrar`"
        @click="toastStore.dismiss(toast.id)"
      >
        <i class="fa-solid toast-icon" :class="ICONS[toast.kind]" aria-hidden="true" />
        <span class="toast-text">{{ toast.message }}</span>
        <i class="fa-solid fa-xmark toast-close" aria-hidden="true" />
      </button>
    </TransitionGroup>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.toasts {
  position: fixed;
  bottom: calc(20px + env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  z-index: 100;
  width: min(92vw, 460px);

  @include desktop {
    bottom: 1.5rem;
  }
}

.toast {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 56px;
  padding: 0.75rem 0.9rem 0.75rem 1rem;
  border-radius: var(--radius-sm);
  background: var(--navy-900);
  color: #fff;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.35;
  box-shadow: var(--shadow-lg);
  text-align: left;

  &--success .toast-icon {
    color: #9fd4b3;
  }

  &--error {
    background: var(--danger-ink);

    .toast-icon {
      color: #fff;
    }
  }

  &--info .toast-icon {
    color: var(--powder-300);
  }
}

.toast-icon {
  flex: none;
  font-size: 1.15rem;
}

.toast-text {
  flex: 1;
  min-width: 0;
}

.toast-close {
  flex: none;
  opacity: 0.6;
  font-size: 0.9rem;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.26s var(--ease-out);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

.toast-move {
  transition: transform 0.22s var(--ease-out);
}
</style>
