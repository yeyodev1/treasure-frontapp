<script setup lang="ts">
// Sello oficial de Treasure of Galápagos, extraído del menú impreso.
// pine: sobre fondos claros · cream: sobre el pino · caramel: acento.
withDefaults(defineProps<{ size?: number; variant?: 'pine' | 'cream' | 'caramel' }>(), {
  size: 84,
  variant: 'pine',
})
</script>

<template>
  <img
    :src="`/brand/seal-${variant}.png`"
    :width="size"
    :style="{ width: `${size}px`, height: 'auto' }"
    alt="Treasure of Galápagos"
    class="seal"
    draggable="false"
  />
</template>

<style scoped>
.seal {
  display: block;
  user-select: none;
}
</style>
