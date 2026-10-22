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
  background: linear-gradient(
    100deg,
    var(--cream-200) 40%,
    rgba(255, 255, 255, 0.75) 50%,
    var(--cream-200) 60%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}

.skeleton--circle {
  border-radius: 50%;
}

@keyframes shimmer {
  0% {
    background-position: 120% 0;
  }

  100% {
    background-position: -80% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
  }
}
</style>
