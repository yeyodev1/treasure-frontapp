<script setup lang="ts">
defineProps<{ title: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <Transition name="modal" appear>
    <div class="overlay" @click.self="emit('close')">
      <section class="modal" role="dialog" :aria-label="title">
        <header class="modal-head">
          <h3>{{ title }}</h3>
          <button class="modal-close" type="button" aria-label="Cerrar" @click="emit('close')">
            <i class="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>
        <div class="modal-body">
          <slot />
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
  background: rgba(8, 26, 44, 0.55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 50;

  @include tablet {
    align-items: center;
    padding: 1.5rem;
  }
}

.modal {
  background: var(--surface);
  width: 100%;
  max-height: 92dvh;
  border-radius: var(--radius) var(--radius) 0 0;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);

  @include tablet {
    max-width: 560px;
    border-radius: var(--radius);
  }
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--cream-200);

  h3 {
    font-size: 1.05rem;
  }
}

.modal-close {
  @include touch-target;
  display: grid;
  place-items: center;
  color: var(--ink-400);
  font-size: 1.1rem;
}

.modal-body {
  padding: 1rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom));
  overflow-y: auto;
}

.modal-enter-active {
  transition: opacity 0.2s ease;

  .modal {
    transition: transform 0.24s cubic-bezier(0.32, 0.72, 0.25, 1);
  }
}

.modal-leave-active {
  transition: opacity 0.16s ease;

  .modal {
    transition: transform 0.16s ease;
  }
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;

  .modal {
    transform: translateY(26px);
  }
}
</style>
