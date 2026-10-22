<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: 'Cargando…' })
</script>

<template>
  <div class="spinner-wrap" role="status">
    <span class="spinner" aria-hidden="true" />
    <span class="spinner-label">{{ label }}</span>
  </div>
</template>

<style scoped>
.spinner-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  padding: 1rem;
  color: var(--ink-400);
  font-size: 0.85rem;
}

.spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2.5px solid var(--cream-200);
  border-top-color: var(--gold-500);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 1.6s;
  }
}
</style>
