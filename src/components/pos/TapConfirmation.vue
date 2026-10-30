<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'

/**
 * Confirmación grande del bar (pedido de Gerencia, 30-oct-2026): la barra
 * inferior pasaba desapercibida y se repetían bebidas. Aparece sobre el
 * catálogo con el estado real del último toque: "Enviando…" mientras el
 * servidor responde y "Producto agregado a la cuenta" solo cuando confirmó.
 * Si no se guardó o queda sin conexión, lo dice aquí mismo. No intercepta
 * toques: el siguiente se registra aunque esté visible.
 */
export type TapState = 'enviando' | 'pendiente' | 'guardado' | 'retenido' | 'rechazado'

const props = defineProps<{
  state: TapState | null
  cabin: number
  units: number
  name: string
  message?: string
  offline?: boolean
  /** Cambia con cada toque o respuesta: reinicia el tiempo visible. */
  stamp: string
  /** Dónde va (px desde arriba o desde abajo) para no tapar la bebida tocada. */
  anchor?: { top?: number; bottom?: number }
}>()

const placement = computed(() =>
  props.anchor?.top !== undefined
    ? { top: `${props.anchor.top}px` }
    : props.anchor?.bottom !== undefined
      ? { top: 'auto', bottom: `${props.anchor.bottom}px` }
      : {},
)

/** Cuánto queda visible cada estado; "Enviando" se queda hasta la respuesta. */
const VISIBLE_MS: Record<TapState, number> = {
  enviando: 0,
  guardado: 2500,
  pendiente: 5000,
  retenido: 5000,
  rechazado: 6000,
}

const visible = shallowRef(false)
let timer: ReturnType<typeof setTimeout> | null = null

watch(
  () => [props.state, props.stamp] as const,
  ([state]) => {
    if (timer) clearTimeout(timer)
    timer = null
    visible.value = Boolean(state)
    const ms = state ? VISIBLE_MS[state] : 0
    if (ms) timer = setTimeout(() => (visible.value = false), ms)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

const title = computed(() => {
  switch (props.state) {
    case 'enviando':
      return 'Enviando…'
    case 'guardado':
      return 'Producto agregado a la cuenta'
    case 'pendiente':
      return props.offline ? 'Sin conexión: no se agregó todavía' : 'Sin confirmar: no se agregó todavía'
    case 'retenido':
      return 'Retenido para revisión'
    default:
      return 'No se agregó a la cuenta'
  }
})

const detail = computed(() => {
  const what = `Cabina ${props.cabin} · ${props.units} ${props.name}`
  if (props.state === 'pendiente') {
    return `${what} · ${props.offline ? 'se envía solo al volver la conexión' : 'se reintenta solo'}`
  }
  if (props.state === 'retenido') return `${what} · el crucero ya estaba finalizado`
  if (props.state === 'rechazado' && props.message) return `${what} · ${props.message}`
  return what
})

const icon = computed(() => {
  switch (props.state) {
    case 'enviando':
      return 'fa-spinner fa-spin'
    case 'guardado':
      return 'fa-circle-check'
    case 'pendiente':
      return props.offline ? 'fa-wifi' : 'fa-cloud-arrow-up'
    case 'retenido':
      return 'fa-hourglass-half'
    default:
      return 'fa-circle-exclamation'
  }
})
</script>

<template>
  <!-- Región viva siempre presente para que el lector de pantalla anuncie cada cambio. -->
  <div class="tap-confirm" :style="placement" role="status" :aria-live="state === 'rechazado' ? 'assertive' : 'polite'" aria-atomic="true">
    <Transition name="pop">
      <div v-if="visible && state" class="card" :class="`card--${state}`">
        <i class="fa-solid card-icon" :class="icon" aria-hidden="true" />
        <div class="card-text">
          <strong>{{ title }}</strong>
          <span>{{ detail }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

// Sobre el catálogo (por defecto al centro; el bar la ubica donde no tape la
// bebida tocada); no recibe toques.
.tap-confirm {
  position: fixed;
  left: 0;
  right: 0;
  top: 42%;
  z-index: 30;
  display: flex;
  justify-content: center;
  padding: 0 14px;
  pointer-events: none;

  @include desktop {
    left: var(--shell-rail, 76px);
  }
}

.card {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  width: min(100%, 520px);
  padding: 1rem 1.15rem;
  border-radius: var(--radius);
  background: var(--navy-800);
  color: #fff;
  box-shadow: var(--shadow-lg);
  border: 2px solid transparent;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;

  &--guardado {
    background: var(--success);
    border-color: rgba(255, 255, 255, 0.35);
  }

  &--pendiente,
  &--retenido {
    background: var(--warning);
  }

  &--rechazado {
    background: var(--danger);
  }

  @include tablet {
    padding: 1.2rem 1.4rem;
  }
}

.card-icon {
  flex-shrink: 0;
  font-size: 2rem;

  @include tablet {
    font-size: 2.3rem;
  }
}

.card-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
  text-align: left;

  strong {
    font-size: 1.15rem;
    line-height: 1.25;

    @include tablet {
      font-size: 1.3rem;
    }
  }

  span {
    font-size: 0.95rem;
    font-weight: 600;
    opacity: 0.92;
    overflow-wrap: anywhere;

    @include tablet {
      font-size: 1.02rem;
    }
  }
}

.pop-enter-active {
  transition:
    opacity 0.16s ease,
    transform 0.2s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

.pop-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.pop-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}

.pop-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .pop-enter-active,
  .pop-leave-active {
    transition: opacity 0.12s ease;
  }

  .pop-enter-from,
  .pop-leave-to {
    transform: none;
  }
}
</style>
