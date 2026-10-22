<script setup lang="ts">
// Sello circular inspirado en el logotipo del menú impreso:
// doble anillo, "TREASURE OF GALÁPAGOS" en arco y la T serif al centro.
withDefaults(defineProps<{ size?: number }>(), { size: 84 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 100 100" aria-hidden="true" class="seal">
    <defs>
      <path id="seal-arc-top" d="M 14,50 A 36,36 0 0 1 86,50" fill="none" />
      <path id="seal-arc-bottom" d="M 16.5,50 A 33.5,33.5 0 0 0 83.5,50" fill="none" />
    </defs>
    <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" stroke-width="1.4" />
    <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="0.7" />
    <text class="seal-arc">
      <textPath href="#seal-arc-top" startOffset="50%" text-anchor="middle">
        · TREASURE OF GALÁPAGOS ·
      </textPath>
    </text>
    <text class="seal-arc">
      <textPath href="#seal-arc-bottom" startOffset="50%" text-anchor="middle">
        · TREASURE OF GALÁPAGOS ·
      </textPath>
    </text>
    <text x="50" y="63" text-anchor="middle" class="seal-t">T</text>
  </svg>
</template>

<style scoped>
.seal {
  display: block;
}

.seal-arc {
  font-family: var(--font-sans);
  font-size: 7.2px;
  font-weight: 500;
  letter-spacing: 0.22em;
  fill: currentColor;
}

.seal-t {
  font-family: var(--font-serif);
  font-size: 38px;
  fill: currentColor;
}
</style>
