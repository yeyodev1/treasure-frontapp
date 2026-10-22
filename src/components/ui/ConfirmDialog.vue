<script setup lang="ts">
import { watch } from 'vue'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'

const confirmStore = useConfirmStore()
const { play } = useSound()

watch(
  () => confirmStore.visible,
  (open) => {
    if (open) play('tap')
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="confirmStore.visible && confirmStore.current"
        class="overlay"
        @click.self="confirmStore.settle(false)"
        @keydown.escape="confirmStore.settle(false)"
      >
        <section class="dialog" role="alertdialog" :aria-label="confirmStore.current.title">
          <span class="dialog-icon" :class="{ 'dialog-icon--danger': confirmStore.current.danger }">
            <i
              class="fa-solid"
              :class="confirmStore.current.icon ?? 'fa-circle-question'"
              aria-hidden="true"
            />
          </span>
          <h3 class="dialog-title">{{ confirmStore.current.title }}</h3>
          <p class="dialog-message">{{ confirmStore.current.message }}</p>
          <div class="dialog-actions">
            <button type="button" class="btn btn-ghost" @click="confirmStore.settle(false)">
              {{ confirmStore.current.cancelLabel ?? 'Cancelar' }}
            </button>
            <button
              type="button"
              class="btn"
              :class="confirmStore.current.danger ? 'btn-danger' : 'btn-gold'"
              @click="confirmStore.settle(true)"
            >
              {{ confirmStore.current.confirmLabel ?? 'Confirmar' }}
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 29, 22, 0.55);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.25rem;
  z-index: 60;
}

.dialog {
  width: 100%;
  max-width: 380px;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 1.75rem 1.5rem 1.4rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
}

.dialog-icon {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: rgba(195, 161, 105, 0.16);
  color: var(--gold-500);
  font-size: 1.3rem;

  &--danger {
    background: rgba(192, 91, 77, 0.14);
    color: var(--danger);
  }
}

.dialog-title {
  font-size: 1.2rem;
}

.dialog-message {
  margin: 0;
  color: var(--ink-600);
  font-size: 0.92rem;
  line-height: 1.5;
}

.dialog-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
  width: 100%;
  margin-top: 0.8rem;
}

.dialog-enter-active {
  transition: opacity 0.2s ease;

  .dialog {
    transition: transform 0.22s cubic-bezier(0.34, 1.4, 0.64, 1);
  }
}

.dialog-leave-active {
  transition: opacity 0.16s ease;

  .dialog {
    transition: transform 0.16s ease;
  }
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;

  .dialog {
    transform: scale(0.92) translateY(10px);
  }
}
</style>
