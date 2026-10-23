<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'

const confirmStore = useConfirmStore()
const { play } = useSound()
const reasonInput = useTemplateRef<HTMLTextAreaElement>('reasonInput')

const needsReason = computed(() => Boolean(confirmStore.current?.reason))
const canConfirm = computed(() => !needsReason.value || confirmStore.reasonText.trim().length > 0)

watch(
  () => confirmStore.visible,
  async (open) => {
    if (!open) return
    play('tap')
    if (needsReason.value) {
      await nextTick()
      reasonInput.value?.focus()
    }
  },
)

function pick(suggestion: string) {
  confirmStore.reasonText = suggestion
}
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

          <div v-if="confirmStore.current.reason" class="dialog-reason">
            <label for="confirm-reason">{{ confirmStore.current.reason.label }}</label>
            <div v-if="confirmStore.current.reason.suggestions?.length" class="dialog-chips">
              <button
                v-for="s in confirmStore.current.reason.suggestions"
                :key="s"
                type="button"
                class="dialog-chip"
                :class="{ 'dialog-chip--on': confirmStore.reasonText === s }"
                @click="pick(s)"
              >
                {{ s }}
              </button>
            </div>
            <textarea
              id="confirm-reason"
              ref="reasonInput"
              v-model="confirmStore.reasonText"
              rows="2"
              :placeholder="confirmStore.current.reason.placeholder ?? 'Escribe el motivo'"
            />
          </div>

          <div class="dialog-actions">
            <button type="button" class="btn btn-ghost" @click="confirmStore.settle(false)">
              <i class="fa-regular fa-clock" aria-hidden="true" />
              {{ confirmStore.current.cancelLabel ?? 'Volver' }}
            </button>
            <button
              type="button"
              class="btn"
              :class="confirmStore.current.danger ? 'btn-danger' : 'btn-primary'"
              :disabled="!canConfirm"
              @click="confirmStore.settle(true)"
            >
              <i
                class="fa-solid"
                :class="confirmStore.current.danger ? 'fa-triangle-exclamation' : 'fa-check'"
                aria-hidden="true"
              />
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
  background: rgba(18, 30, 25, 0.55);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.25rem;
  z-index: 60;
}

.dialog {
  width: 100%;
  max-width: 420px;
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
  background: rgba(159, 107, 60, 0.14);
  color: var(--gold-500);
  font-size: 1.3rem;

  &--danger {
    background: rgba(180, 72, 59, 0.13);
    color: var(--danger);
  }
}

.dialog-title {
  font-size: 1.22rem;
}

.dialog-message {
  margin: 0;
  color: var(--ink-600);
  font-size: 0.92rem;
  line-height: 1.5;
}

.dialog-reason {
  width: 100%;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-top: 0.3rem;

  label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--ink-600);
  }

  textarea {
    width: 100%;
    resize: vertical;
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--cream-200);
    border-radius: var(--radius-sm);
    font-size: 0.92rem;

    &:focus {
      outline: none;
      border-color: var(--gold-500);
      box-shadow: 0 0 0 3px rgba(159, 107, 60, 0.18);
    }
  }
}

.dialog-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.dialog-chip {
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  border: 1.5px solid var(--cream-200);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--ink-600);
  transition: all 0.14s ease;

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }
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
