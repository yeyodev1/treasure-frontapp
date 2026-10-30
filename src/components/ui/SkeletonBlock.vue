<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Alto del bloque (CSS). */
    height?: string
    /** Ancho del bloque (CSS). */
    width?: string
    /** Forma redonda (avatares, iconos). */
    circle?: boolean
  }>(),
  { height: '1rem', width: '100%', circle: false },
)
</script>

<template>
  <span
    class="skeleton"
    :class="{ 'skeleton--circle': circle }"
    :style="{ height, width }"
    aria-hidden="true"
  />
</template>

<style scoped>
.skeleton {
  display: block;
  border-radius: 7px;
  /* Bloque plano que respira: sin brillo en degradé. */
  background: var(--cream-200);
  animation: breathe 1.6s ease-in-out infinite;
}

.skeleton--circle {
  border-radius: 50%;
}

@keyframes breathe {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
  }
}
</style>
