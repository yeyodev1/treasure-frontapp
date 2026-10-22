<script setup lang="ts">
import { computed } from 'vue'

export interface BarRow {
  label: string
  value: number
  detail?: string
}

const props = defineProps<{ rows: BarRow[]; format?: (v: number) => string }>()

const max = computed(() => Math.max(...props.rows.map((r) => r.value), 1))
const fmt = (v: number) => (props.format ? props.format(v) : String(v))
</script>

<template>
  <div class="bars">
    <div v-for="row in rows" :key="row.label" class="bar-row">
      <div class="bar-meta">
        <span class="bar-label">{{ row.label }}</span>
        <span class="bar-value">{{ fmt(row.value) }}<em v-if="row.detail"> · {{ row.detail }}</em></span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" :style="{ width: `${(row.value / max) * 100}%` }" />
      </div>
    </div>
    <p v-if="!rows.length" class="bars-empty">Sin datos todavía.</p>
  </div>
</template>

<style scoped lang="scss">
.bars {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.bar-meta {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.85rem;
  margin-bottom: 0.2rem;
}

.bar-label {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-value {
  font-weight: 700;
  white-space: nowrap;

  em {
    font-style: normal;
    font-weight: 500;
    color: var(--ink-400);
  }
}

.bar-track {
  height: 8px;
  border-radius: 999px;
  background: var(--cream-200);
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--navy-700), var(--teal-400));
}

.bars-empty {
  margin: 0;
  color: var(--ink-400);
  font-size: 0.9rem;
}
</style>
