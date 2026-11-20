<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Product } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import { formatMoney } from '@/utils/format'

/**
 * Trago o cóctel con acompañante (pedido del bar, 19-nov-2026): «Aperol con Sprite»,
 * «whisky con agua tónica». El acompañante se descuenta del inventario (el envase
 * entero) y no cambia el precio. El servidor valida: aquí solo se elige.
 */
const MIXER_CATEGORIES = ['gaseosa', 'agua', 'jugo']
const MAX = 3

const props = defineProps<{
  product: Product
  /** Insumos físicos activos. */
  physical: Product[]
  target?: string
}>()
const emit = defineEmits<{
  close: []
  confirm: [mixers: string[], name: string, price: number]
}>()

const options = computed(() =>
  props.physical
    .filter((p) => MIXER_CATEGORIES.includes(p.category))
    .sort((a, b) => a.name.localeCompare(b.name, 'es')),
)
const picked = ref<string[]>([])
const byId = computed(() => new Map(options.value.map((p) => [p._id, p])))

function toggle(id: string) {
  if (picked.value.includes(id)) picked.value = picked.value.filter((x) => x !== id)
  else if (picked.value.length < MAX) picked.value = [...picked.value, id]
}

const name = computed(() =>
  picked.value.length
    ? `${props.product.name} + ${picked.value.map((id) => byId.value.get(id)?.name ?? '').join(', ')}`
    : props.product.name,
)
</script>

<template>
  <BaseModal :title="`${product.name} con acompañante`" :subtitle="target ? `Para ${target}` : undefined" @close="emit('close')">
    <p class="mix-help">Elige con qué se sirve (hasta {{ MAX }}). Se descuenta del inventario y no cambia el precio.</p>
    <p v-if="!options.length" class="mix-empty">No hay gaseosas, aguas ni jugos activos en el catálogo.</p>
    <div v-else class="mix-grid">
      <button
        v-for="p in options"
        :key="p._id"
        type="button"
        class="mix-opt"
        :aria-pressed="picked.includes(p._id)"
        :disabled="!picked.includes(p._id) && picked.length >= MAX"
        @click="toggle(p._id)"
      >
        <i class="fa-solid" :class="picked.includes(p._id) ? 'fa-check' : 'fa-plus'" aria-hidden="true" />
        {{ p.name }}
      </button>
    </div>
    <div class="mix-price">
      <span>{{ name }}</span>
      <strong>{{ formatMoney(product.price) }}</strong>
    </div>
    <template #footer>
      <button type="button" class="btn btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="button" class="btn btn-primary" :disabled="!picked.length" @click="emit('confirm', picked, name, product.price)">
        Agregar a la cuenta
      </button>
    </template>
  </BaseModal>
</template>

<style scoped lang="scss">
.mix-help,
.mix-empty {
  margin: 0 0 1rem;
  color: var(--ink-600);
}

.mix-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.mix-opt {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 46px;
  padding: 0 0.9rem;
  border: 1px solid var(--bar-line, var(--ink-200));
  border-radius: var(--radius-sm);
  background: var(--surface, #fff);
  color: var(--ink-900);
  font-weight: 600;
  text-align: left;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;

  &[aria-pressed='true'] {
    background: var(--powder-200);
    border-color: var(--ink-900);
  }

  &:disabled {
    opacity: 0.45;
  }
}

.mix-price {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: var(--powder-100);
  border-radius: var(--radius-sm);
  font-variant-numeric: tabular-nums;
}
</style>
