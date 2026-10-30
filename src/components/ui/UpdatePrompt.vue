<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { useAppUpdate } from '@/composables/useAppUpdate'

const router = useRouter()
const { available, snoozedUntil, start, update, later } = useAppUpdate()

// Reloj para que "Más tarde" vuelva a mostrar el aviso al vencer.
const now = shallowRef(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  start(router)
  timer = setInterval(() => (now.value = Date.now()), 30_000)
})
onBeforeUnmount(() => clearInterval(timer))

const visible = computed(() => available.value && now.value >= snoozedUntil.value)
const updating = shallowRef(false)

function onUpdate() {
  updating.value = true
  update()
}

function onLater() {
  later()
  now.value = Date.now()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="update" appear>
      <div v-if="visible" class="update-overlay">
        <section class="update-card" role="alertdialog" aria-labelledby="update-title" aria-describedby="update-text">
          <span class="update-icon" aria-hidden="true">
            <i class="fa-solid fa-arrows-rotate" />
          </span>
          <h3 id="update-title">Hay una actualización del sistema</h3>
          <p id="update-text">
            Publicamos mejoras. Actualiza para usar la versión más reciente. Lo que tengas pendiente de
            enviar no se pierde.
          </p>
          <div class="update-actions">
            <button type="button" class="btn btn-primary" :disabled="updating" @click="onUpdate">
              <i class="fa-solid fa-arrows-rotate" :class="{ 'fa-spin': updating }" aria-hidden="true" />
              Actualizar ahora
            </button>
            <button type="button" class="btn btn-ghost" :disabled="updating" @click="onLater">
              Más tarde
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.update-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 1rem;
  background: rgba(8, 26, 44, 0.45);

  @include tablet {
    align-items: center;
  }
}

.update-card {
  width: 100%;
  max-width: 440px;
  padding: 1.5rem;
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  border-top: 4px solid var(--navy-800);

  h3 {
    font-size: 1.35rem;
    margin: 0.75rem 0 0.4rem;
  }

  p {
    margin: 0;
    color: var(--ink-600);
    line-height: 1.5;
  }
}

.update-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--powder-300);
  color: var(--navy-800);
  font-size: 1.2rem;
}

.update-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 1.25rem;

  .btn {
    flex: 1 1 160px;
  }
}

.update-enter-active,
.update-leave-active {
  transition: opacity 0.2s ease;

  .update-card {
    transition: transform 0.22s ease;
  }
}

.update-enter-from,
.update-leave-to {
  opacity: 0;

  .update-card {
    transform: translateY(12px);
  }
}
</style>
