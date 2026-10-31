<script setup lang="ts">
import { computed } from 'vue'

export interface OwnerBarRow {
  label: string
  value: number
  detail?: string
}

/**
 * Lista con barra fina proporcional al mayor valor. `main` lleva el azul de
 * la marca (la serie principal del resumen); el resto va en gris con la
 * primera fila en tinta, para que el orden se vea y no solo se lea.
 */
const props = withDefaults(
  defineProps<{ rows: OwnerBarRow[]; format?: (v: number) => string; tone?: 'main' | 'quiet'; empty?: string }>(),
  { tone: 'quiet', empty: 'Sin datos en este alcance.' },
)

const max = computed(() => Math.max(...props.rows.map((r) => r.value), 0))
const fmt = (v: number) => (props.format ? props.format(v) : String(v))
const share = (v: number) => (max.value > 0 ? Math.max(0, (v / max.value) * 100) : 0)
</script>

<template>
  <ul v-if="rows.length" class="bars" :class="`bars--${tone}`">
    <li v-for="(row, i) in rows" :key="`${row.label}-${i}`" class="bar" :class="{ 'bar--top': i === 0 }">
      <span class="bar-label">{{ row.label }}</span>
      <span class="bar-value">{{ fmt(row.value) }}</span>
      <span v-if="row.detail" class="bar-detail">{{ row.detail }}</span>
      <span class="bar-track" aria-hidden="true">
        <span class="bar-fill" :style="{ width: `${share(row.value)}%` }" />
      </span>
    </li>
  </ul>
  <p v-else class="bars-empty">{{ empty }}</p>
</template>

<style scoped lang="scss">
.bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 0.75rem;
  row-gap: 0.15rem;
  align-items: baseline;
}

.bar-label {
  min-width: 0;
  font-size: 1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-value {
  font-size: 1rem;
  font-weight: 500;
  white-space: nowrap;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.bar-detail {
  grid-column: 1 / -1;
  font-size: 0.875rem;
  color: #55636d;
}

.bar-track {
  grid-column: 1 / -1;
  display: block;
  height: 4px;
  margin-top: 0.3rem;
  border-radius: 999px;
  background: var(--powder-100);
  overflow: hidden;
}

.bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: #a9b8c4;
  transition: width 0.35s ease;

  .bars--main & {
    background: var(--navy-700);
  }

  .bars--quiet .bar--top & {
    background: var(--ink-600);
  }
}

.bars-empty {
  margin: 0;
  padding: 0.75rem 0;
  font-size: 1rem;
  color: #55636d;
}
</style>
