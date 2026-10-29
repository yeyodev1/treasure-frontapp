<script setup lang="ts">
import BaseModal from '@/components/ui/BaseModal.vue'
import type { SaveState } from '@/composables/useSaveAttempt'
import SaveStatus from './SaveStatus.vue'

/**
 * Confirmación con resumen: se revisa, se confirma y el mismo modal
 * muestra Guardando… / Guardado o el error con Reintentar.
 */
const props = defineProps<{
  title: string
  state: SaveState
  message?: string
  offline?: boolean
  savedText?: string
  confirmLabel: string
  /** Aviso destacado arriba del botón (p. ej. "Aprobar no suma stock"). */
  notice?: string
  danger?: boolean
}>()

const emit = defineEmits<{ confirm: []; close: []; done: [] }>()

function close() {
  if (props.state === 'saving') return
  if (props.state === 'saved') emit('done')
  else emit('close')
}
</script>

<template>
  <BaseModal :title="title" @close="close">
    <div class="summary">
      <slot />

      <p v-if="notice && state !== 'saved'" class="notice">
        <i class="fa-solid fa-circle-info" aria-hidden="true" /> {{ notice }}
      </p>

      <SaveStatus
        :state="state"
        :message="message"
        :offline="offline"
        :saved-text="savedText"
        @retry="emit('confirm')"
      />

      <Transition name="swap" mode="out-in">
        <div v-if="state === 'saved'" key="done" class="actions">
          <slot name="saved" />
          <button type="button" class="btn btn-primary wide" @click="emit('done')">
            <i class="fa-solid fa-check" aria-hidden="true" /> Listo
          </button>
        </div>
        <p v-else-if="state === 'error' && offline" key="unsure" class="unsure">
          Hay un envío sin confirmar. Reintenta antes de cambiar algo: así no se guarda dos veces.
        </p>
        <div v-else key="ask" class="actions">
          <button type="button" class="btn btn-ghost" :disabled="state === 'saving'" @click="emit('close')">
            <i class="fa-solid fa-pen" aria-hidden="true" /> Volver a editar
          </button>
          <button
            type="button"
            class="btn"
            :class="danger ? 'btn-danger' : 'btn-gold'"
            :disabled="state === 'saving'"
            @click="emit('confirm')"
          >
            <i class="fa-solid fa-check" aria-hidden="true" />
            {{ state === 'saving' ? 'Guardando…' : confirmLabel }}
          </button>
        </div>
      </Transition>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">
.summary {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.notice {
  margin: 0;
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  padding: 0.7rem 0.85rem;
  border-radius: var(--radius-sm);
  background: rgba(185, 128, 47, 0.12);
  color: #7a521a;
  font-size: 0.92rem;
  font-weight: 600;

  i {
    margin-top: 0.15rem;
  }
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;

  .btn {
    min-height: 56px;
    font-size: 1rem;
  }
}

.unsure {
  margin: 0;
  font-size: 0.88rem;
  color: var(--ink-600);
}

.wide {
  grid-column: 1 / -1;
}

.swap-enter-active,
.swap-leave-active {
  transition: opacity 0.16s ease;
}

.swap-enter-from,
.swap-leave-to {
  opacity: 0;
}
</style>
