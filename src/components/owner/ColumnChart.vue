<script setup lang="ts">
import { computed } from 'vue'

export interface Column {
  key: string
  label: string
  /** null = sin información (no es $0): se dibuja solo la base. */
  value: number | null
  /** Texto del tooltip debajo del valor. */
  detail?: string
}

/**
 * Columnas verticales de una sola serie (resumen de Gerencia). Al pasar o
 * enfocar una columna se ve su valor; con `pickable` se toca para abrir su
 * detalle. Solo se rotulan la mayor y la elegida, nunca todas.
 */
const props = withDefaults(
  defineProps<{
    columns: Column[]
    format: (v: number) => string
    selected?: string
    pickable?: boolean
    label: string
  }>(),
  { selected: '', pickable: false },
)
const emit = defineEmits<{ pick: [key: string] }>()

const max = computed(() => Math.max(0, ...props.columns.map((c) => c.value ?? 0)))
const maxKey = computed(() => (max.value > 0 ? props.columns.find((c) => c.value === max.value)?.key : ''))
const height = (v: number | null) => (v && max.value ? Math.max(3, (v / max.value) * 100) : 0)
const valueText = (c: Column) => (c.value === null ? 'Sin información' : props.format(c.value))
</script>

<template>
  <div class="cols" role="group" :aria-label="label">
    <component
      :is="pickable ? 'button' : 'div'"
      v-for="c in columns"
      :key="c.key"
      :type="pickable ? 'button' : undefined"
      class="col"
      :class="{
        'col--on': c.key === selected,
        'col--empty': !c.value,
        'col--pick': pickable,
      }"
      :aria-label="`${c.label}: ${valueText(c)}${c.detail ? `, ${c.detail}` : ''}`"
      :aria-pressed="pickable ? c.key === selected : undefined"
      @click="pickable && emit('pick', c.key)"
    >
      <span class="col-plot" aria-hidden="true">
        <span v-if="c.value && (c.key === maxKey || c.key === selected)" class="col-value">{{ format(c.value) }}</span>
        <span class="col-bar" :style="{ height: `${height(c.value)}%` }" />
      </span>
      <span class="col-label" aria-hidden="true">{{ c.label }}</span>
      <span class="col-tip" aria-hidden="true">
        <b>{{ c.label }}</b> {{ valueText(c) }}<template v-if="c.detail"><br />{{ c.detail }}</template>
      </span>
    </component>
  </div>
</template>

<style scoped lang="scss">
.cols {
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 200px;
  padding-top: 1.4rem;
  border-bottom: 1px solid var(--line-strong);
}

.col {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 0;
  border: 0;
  border-radius: 6px 6px 0 0;
  background: none;
  color: inherit;
  font: inherit;

  &--pick {
    cursor: pointer;
  }

  &:hover,
  &:focus-visible {
    background: var(--powder-100);
  }
}

.col-plot {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
}

.col-bar {
  width: min(70%, 36px);
  border-radius: 4px 4px 0 0;
  background: var(--teal-400);
  transition: height 0.35s ease;

  .col--on &,
  .col:hover &,
  .col:focus-visible & {
    background: var(--navy-700);
  }

  .col--empty & {
    height: 2px !important;
    background: var(--line-strong);
  }
}

.col-value {
  margin-bottom: 0.25rem;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--ink-900);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.col-label {
  padding: 0.35rem 0 0.2rem;
  font-size: 0.75rem;
  color: var(--ink-600);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  .col--on & {
    color: var(--ink-900);
    font-weight: 700;
  }
}

.col-tip {
  position: absolute;
  bottom: calc(100% - 1rem);
  left: 50%;
  z-index: 5;
  translate: -50% 0;
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  background: var(--navy-900);
  color: #fff;
  font-size: 0.8rem;
  line-height: 1.35;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s ease;

  .col:hover &,
  .col:focus-visible & {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .col-bar {
    transition: none;
  }
}
</style>
