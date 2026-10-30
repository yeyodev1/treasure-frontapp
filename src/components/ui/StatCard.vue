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
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--ink-600);
}

.stat-value {
  margin: 0.25rem 0 0;
  font-size: 1.75rem;
  font-weight: 600;
  line-height: 1.15;
  color: var(--navy-800);
  font-variant-numeric: tabular-nums;
}

.stat-hint {
  margin: 0.2rem 0 0;
  font-size: 0.88rem;
  color: var(--ink-400);
}
</style>
