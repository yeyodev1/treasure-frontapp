<script setup lang="ts">
import { onBeforeUnmount, onMounted, useSlots, useTemplateRef } from 'vue'

withDefaults(
  defineProps<{
    title: string
    /** Una línea bajo el título: qué se hace aquí o de qué objeto se trata. */
    subtitle?: string
    /** Ancho en tableta y escritorio. En celular siempre es una hoja inferior. */
    size?: 'md' | 'lg' | 'xl'
  }>(),
  { subtitle: undefined, size: 'md' },
)
const emit = defineEmits<{ close: [] }>()
const slots = useSlots()
const dialog = useTemplateRef<HTMLElement>('dialog')

// Varios modales abiertos a la vez comparten un solo bloqueo del fondo.
const LOCK_KEY = '__treasureModalLocks'

function lockBody(delta: 1 | -1) {
  const w = window as unknown as Record<string, number>
  const count = Math.max(0, (w[LOCK_KEY] ?? 0) + delta)
  w[LOCK_KEY] = count
  document.documentElement.style.overflow = count > 0 ? 'hidden' : ''
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  // Solo el modal de más arriba responde a Escape.
  const all = document.querySelectorAll('.modal-overlay')
  if (all[all.length - 1] === dialog.value?.parentElement) emit('close')
}

onMounted(() => {
  lockBody(1)
  document.addEventListener('keydown', onKey)
  // Foco en el diálogo, sin abrir el teclado del celular sobre un campo.
  requestAnimationFrame(() => dialog.value?.focus({ preventScroll: true }))
})

onBeforeUnmount(() => {
  lockBody(-1)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal" appear>
      <div class="modal-overlay" @click.self="emit('close')">
        <section
          ref="dialog"
          class="modal"
          :class="`modal--${size}`"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
        >
          <span class="modal-grabber" aria-hidden="true" />
          <header class="modal-head">
            <div class="modal-titles">
              <h3>{{ title }}</h3>
              <p v-if="subtitle" class="modal-subtitle">{{ subtitle }}</p>
            </div>
            <button class="modal-close" type="button" aria-label="Cerrar" @click="emit('close')">
              <i class="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </header>
          <div class="modal-body">
            <slot />
          </div>
          <footer v-if="slots.footer" class="modal-foot">
            <slot name="footer" />
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(14, 28, 38, 0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 50;

  @include tablet {
    align-items: center;
    padding: 1.5rem;
  }
}

// Celular: hoja que sube desde abajo. Tableta en adelante: diálogo centrado.
.modal {
  background: var(--surface);
  width: 100%;
  max-height: 92dvh;
  border-radius: 18px 18px 0 0;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  outline: none;

  @include tablet {
    max-width: 580px;
    max-height: 88dvh;
    border-radius: var(--radius);
  }

  &--lg {
    @include tablet {
      max-width: 720px;
    }
  }

  &--xl {
    @include tablet {
      max-width: 920px;
    }
  }
}

.modal-grabber {
  align-self: center;
  width: 44px;
  height: 5px;
  margin-top: 8px;
  border-radius: 999px;
  background: var(--line-strong);

  @include tablet {
    display: none;
  }
}

.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 0.75rem 0.85rem 1.25rem;
  border-bottom: 1px solid var(--rule);

  h3 {
    font-size: 1.3rem;
    line-height: 1.25;
  }

  @include tablet {
    padding: 1.1rem 0.9rem 1rem 1.5rem;
  }
}

.modal-titles {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
  padding-top: 0.55rem;
}

.modal-subtitle {
  margin: 0;
  font-size: 0.95rem;
  color: var(--ink-600);
}

.modal-close {
  @include touch-target;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--ink-600);
  font-size: 1.2rem;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;

  &:hover {
    background: var(--cream-100);
    color: var(--ink-900);
  }
}

.modal-body {
  padding: 1.1rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom));
  overflow-y: auto;
  overscroll-behavior: contain;

  @include tablet {
    padding: 1.25rem 1.5rem 1.5rem;
  }
}

.modal-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 0.85rem 1.25rem calc(0.85rem + env(safe-area-inset-bottom));
  border-top: 1px solid var(--rule);
  background: var(--surface);
  border-radius: 0 0 var(--radius) var(--radius);

  @include tablet {
    padding: 1rem 1.5rem;
  }
}

// Si hay pie, el cuerpo ya no necesita el margen inferior del área segura.
.modal-body:has(+ .modal-foot) {
  padding-bottom: 1.25rem;
}

.modal-enter-active {
  transition: opacity 0.22s ease;

  .modal {
    transition: transform 0.3s var(--ease-sheet);
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
    transform: translateY(40px);

    @include tablet {
      transform: translateY(14px) scale(0.985);
    }
  }
}
</style>
