<script setup lang="ts">
import { computed, watch } from 'vue'
import { formatNumber, unitShort } from '@/utils/format'
import QtyStepper from './QtyStepper.vue'
import { baseText, hasContainer, plural, toBase, toContainers, type QtyMode, type UnitInfo } from './units'

/**
 * Cantidad con unidad elegible: envases (botellas, latas) o unidad base (ml).
 * El tope llega en unidad base y se convierte a la unidad elegida.
 */
const props = defineProps<{
  product: UnitInfo
  label: string
  /** Tope en unidad base (p. ej. lo que hay en bodega o lo pendiente). */
  maxBase?: number
  /** Permitir elegir ml además de envases. */
  allowBase?: boolean
}>()

const qty = defineModel<number>({ default: 1 })
const mode = defineModel<QtyMode>('mode', { default: 'envase' })

const container = computed(() => hasContainer(props.product))
const max = computed(() => {
  if (props.maxBase === undefined) return undefined
  const top = Math.max(0, props.maxBase)
  return mode.value === 'envase' ? toContainers(top, props.product) : top
})
const step = computed(() => (mode.value === 'base' && container.value ? 10 : 1))
const unit = computed(() =>
  mode.value === 'envase' ? plural(props.product.containerLabel || 'unidad', qty.value) : unitShort(props.product.stockUnit),
)
const base = computed(() => toBase(qty.value, mode.value, props.product))

/** Al cambiar de unidad se conserva la misma cantidad física. */
watch(mode, (next, prev) => {
  if (next === prev) return
  qty.value =
    next === 'base'
      ? toBase(qty.value, 'envase', props.product)
      : toContainers(qty.value, props.product)
})
</script>

<template>
  <div class="uq">
    <div v-if="container && allowBase" class="seg" role="group" :aria-label="`Unidad de ${label}`">
      <button type="button" :class="{ on: mode === 'envase' }" :aria-pressed="mode === 'envase'" @click="mode = 'envase'">
        {{ plural(product.containerLabel, 2) }}
      </button>
      <button type="button" :class="{ on: mode === 'base' }" :aria-pressed="mode === 'base'" @click="mode = 'base'">
        {{ unitShort(product.stockUnit) }}
      </button>
    </div>
    <QtyStepper v-model="qty" :min="0" :max="max" :step="step" :label="label" :unit="unit" />
    <span class="conv">
      <template v-if="container && mode === 'envase'">
        {{ formatNumber(qty) }} {{ unit }} = {{ baseText(base, product.stockUnit) }}
      </template>
      <template v-else-if="container">
        {{ baseText(base, product.stockUnit) }} ≈ {{ formatNumber(toContainers(base, product)) }} {{ plural(product.containerLabel, toContainers(base, product)) }}
      </template>
      <template v-else>{{ formatNumber(qty) }} {{ unit }}</template>
    </span>
  </div>
</template>

<style scoped lang="scss">
.uq {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.45rem;
}

.seg {
  display: inline-flex;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: #fff;

  button {
    min-height: 48px;
    min-width: 88px;
    padding: 0 1rem;
    font-weight: 700;
    font-size: 0.9rem;
    color: var(--ink-600);
    transition:
      background 0.15s ease,
      color 0.15s ease;

    &.on {
      background: var(--navy-800);
      color: #fff;
    }
  }
}

.conv {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--navy-700);
}
</style>
