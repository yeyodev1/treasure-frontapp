<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'

const confirmStore = useConfirmStore()
const { play } = useSound()
const reasonInput = useTemplateRef<HTMLTextAreaElement>('reasonInput')

const needsReason = computed(() => Boolean(confirmStore.current?.reason))
const canConfirm = computed(
  () =>
    (!needsReason.value || confirmStore.reasonText.trim().length > 0) &&
    (!confirmStore.current?.choice || Boolean(confirmStore.choiceValue)),
)

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
          <header class="dialog-head">
            <span class="dialog-icon" :class="{ 'dialog-icon--danger': confirmStore.current.danger }">
              <i
                class="fa-solid"
                :class="confirmStore.current.icon ?? 'fa-circle-question'"
                aria-hidden="true"
              />
            </span>
            <h3 class="dialog-title">{{ confirmStore.current.title }}</h3>
          </header>
          <p class="dialog-message">{{ confirmStore.current.message }}</p>

          <div v-if="confirmStore.current.details" class="dialog-details">
            <ul>
              <li v-for="(row, i) in confirmStore.current.details.rows" :key="i">
                <span>
                  {{ row.label }}
                  <small v-if="row.note">{{ row.note }}</small>
                </span>
                <strong>{{ row.value }}</strong>
              </li>
            </ul>
            <p v-if="confirmStore.current.details.total" class="dialog-details-total">
              <span>{{ confirmStore.current.details.total.label }}</span>
              <strong>{{ confirmStore.current.details.total.value }}</strong>
            </p>
          </div>

          <fieldset v-if="confirmStore.current.choice" class="dialog-choice">
            <legend>{{ confirmStore.current.choice.label }}</legend>
            <button
              v-for="option in confirmStore.current.choice.options"
              :key="option.value"
              type="button"
              class="dialog-option"
              :class="{ 'dialog-option--on': confirmStore.choiceValue === option.value }"
              :aria-pressed="confirmStore.choiceValue === option.value"
              @click="confirmStore.choiceValue = option.value"
            >
              <strong>{{ option.label }}</strong>
              <small v-if="option.hint">{{ option.hint }}</small>
            </button>
          </fieldset>

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
            <button type="button" class="btn btn-secondary" @click="confirmStore.settle(false)">
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
  background: rgba(14, 28, 38, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.25rem;
  z-index: 60;
}

.dialog {
  width: 100%;
  max-width: 460px;
  max-height: calc(100dvh - 2.5rem);
  overflow-y: auto;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 1.4rem 1.4rem 1.25rem;
  text-align: left;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.7rem;

  @include tablet {
    padding: 1.6rem 1.6rem 1.4rem;
  }
}

.dialog-head {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.dialog-icon {
  flex: none;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--pill-info-bg);
  color: var(--navy-800);
  font-size: 1.1rem;

  &--danger {
    background: var(--pill-danger-bg);
    color: var(--danger-ink);
  }
}

.dialog-title {
  font-size: 1.35rem;
  line-height: 1.2;
}

.dialog-message {
  margin: 0;
  color: var(--ink-600);
  font-size: 1rem;
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
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--ink-600);
  }

  textarea {
    width: 100%;
    min-height: 72px;
    resize: vertical;
    padding: 0.65rem 0.8rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    font-size: 1rem;

    &:focus {
      outline: none;
      border-color: var(--navy-600);
      box-shadow: var(--focus-ring);
    }
  }
}

.dialog-details {
  width: 100%;
  text-align: left;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--cream-100);

  ul {
    list-style: none;
    margin: 0;
    padding: 0.35rem 0.8rem;
    max-height: 38vh;
    overflow-y: auto;
  }

  li {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.45rem 0;
    font-size: 0.95rem;

    & + li {
      border-top: 1px solid var(--rule);
    }

    small {
      display: block;
      color: var(--ink-400);
      font-size: 0.82rem;
    }

    strong {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
  }
}

.dialog-details-total {
  display: flex;
  justify-content: space-between;
  margin: 0;
  padding: 0.6rem 0.8rem;
  border-top: 1px solid var(--line-strong);
  font-size: 1.05rem;
  color: var(--navy-900);

  strong {
    font-variant-numeric: tabular-nums;
  }
}

.dialog-choice {
  width: 100%;
  margin: 0.3rem 0 0;
  padding: 0;
  border: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.45rem;
  text-align: left;

  legend {
    padding: 0;
    margin-bottom: 0.45rem;
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--ink-600);
  }
}

.dialog-option {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-height: 52px;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
  text-align: left;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;

  strong {
    font-size: 0.97rem;
  }

  small {
    font-size: 0.82rem;
    color: var(--ink-400);
  }

  &--on {
    border-color: var(--navy-800);
    background: var(--powder-100);
    box-shadow: inset 0 0 0 1px var(--navy-800);
  }
}

.dialog-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.dialog-chip {
  min-height: 40px;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  font-size: 0.92rem;
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
  margin-top: 0.5rem;
}

.dialog-enter-active {
  transition: opacity 0.2s ease;

  .dialog {
    transition: transform 0.24s var(--ease-out);
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
    transform: scale(0.96) translateY(10px);
  }
}
</style>
