<script setup lang="ts">
defineProps<{ label: string; value: string; hint?: string }>()
</script>

<template>
  <article class="stat card">
    <p class="stat-label">{{ label }}</p>
    <p class="stat-value">{{ value }}</p>
    <p v-if="hint" class="stat-hint">{{ hint }}</p>
  </article>
</template>

<style scoped lang="scss">
.stat-label {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-400);
}

.stat-value {
  margin: 0.25rem 0 0;
  font-size: 1.7rem;
  font-weight: 800;
  color: var(--navy-800);
}

.stat-hint {
  margin: 0.15rem 0 0;
  font-size: 0.8rem;
  color: var(--ink-400);
}
</style>
