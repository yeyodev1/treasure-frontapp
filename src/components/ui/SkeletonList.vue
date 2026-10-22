<script setup lang="ts">
import SkeletonBlock from './SkeletonBlock.vue'

withDefaults(
  defineProps<{
    rows?: number
    /** 'card' pinta tarjetas, 'row' filas de tabla, 'tile' cuadrícula de productos. */
    variant?: 'card' | 'row' | 'tile'
  }>(),
  { rows: 4, variant: 'row' },
)
</script>

<template>
  <div class="sk" :class="`sk--${variant}`" aria-busy="true" aria-label="Cargando">
    <template v-if="variant === 'tile'">
      <div v-for="i in rows" :key="i" class="sk-tile">
        <SkeletonBlock circle height="30px" width="30px" />
        <SkeletonBlock height="0.7rem" width="70%" />
        <SkeletonBlock height="0.7rem" width="40%" />
      </div>
    </template>
    <template v-else-if="variant === 'card'">
      <div v-for="i in rows" :key="i" class="sk-card">
        <SkeletonBlock height="0.9rem" width="45%" />
        <SkeletonBlock height="1.6rem" width="60%" />
        <SkeletonBlock height="0.75rem" width="80%" />
      </div>
    </template>
    <template v-else>
      <div v-for="i in rows" :key="i" class="sk-row">
        <SkeletonBlock circle height="26px" width="26px" />
        <SkeletonBlock height="0.85rem" :width="i % 2 ? '55%' : '70%'" />
        <SkeletonBlock height="0.85rem" width="60px" />
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.sk--row {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.sk-row {
  display: grid;
  grid-template-columns: 26px 1fr 60px;
  align-items: center;
  gap: 0.75rem;
}

.sk--card {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.75rem;
}

.sk-card {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.sk--tile {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 0.5rem;
}

.sk-tile {
  background: var(--surface);
  border: 2px solid var(--cream-200);
  border-radius: var(--radius-sm);
  min-height: 104px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  padding: 0.6rem;
}
</style>
