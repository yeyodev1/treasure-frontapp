<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Product } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { formatMoney } from '@/utils/format'

/**
 * Cóctel con cambio (pedido del cliente, 9-nov-2026): «Cuba Libre con Coca-Cola
 * Zero» o «con Abuelo en vez de Bacardí». Se cambia la gaseosa o el licor por
 * otro de su misma categoría; cambiar el licor suma $3. El servidor valida y
 * cobra: aquí solo se muestra.
 */
const LIQUOR_SURCHARGE = 3
const SWAPPABLE = ['licor', 'gaseosa']

const props = defineProps<{
  product: Product
  /** Insumos físicos activos. */
  physical: Product[]
  target?: string
}>()
const emit = defineEmits<{
  close: []
  confirm: [swaps: Array<{ from: string; to: string }>, name: string, price: number]
}>()

const clean = (name: string) => name.replace(/\s*\(botella\)\s*$/i, '')
const byId = computed(() => new Map(props.physical.map((p) => [p._id, p])))

/** Ingredientes de la receta que se pueden cambiar y por cuáles. */
const lines = computed(() =>
  props.product.recipe.flatMap((r) => {
    const from = byId.value.get(typeof r.product === 'string' ? r.product : r.product._id)
    if (!from || !SWAPPABLE.includes(from.category)) return []
    const options = props.physical
      .filter((p) => p.category === from.category && p.stockUnit === from.stockUnit)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map((p) => ({ value: p._id, label: clean(p.name), hint: p._id === from._id ? 'de la receta' : undefined }))
    return options.length > 1 ? [{ from, options }] : []
  }),
)

const choice = ref<Record<string, string>>({})
const swaps = computed(() =>
  lines.value
    .map((l) => ({ from: l.from._id, to: choice.value[l.from._id] || l.from._id }))
    .filter((s) => s.from !== s.to),
)
const liquorChanged = computed(() => swaps.value.some((s) => byId.value.get(s.from)?.category === 'licor'))
const price = computed(() => props.product.price + (liquorChanged.value ? LIQUOR_SURCHARGE : 0))
const name = computed(() =>
  swaps.value.length
    ? `${props.product.name} (con ${swaps.value.map((s) => clean(byId.value.get(s.to)?.name ?? '')).join(', ')})`
    : props.product.name,
)
</script>

<template>
  <BaseModal :title="`Cambiar en ${product.name}`" :subtitle="target ? `Para ${target}` : undefined" @close="emit('close')">
    <p v-if="!lines.length" class="swap-empty">Este cóctel no tiene gaseosa ni licor que se pueda cambiar.</p>
    <div v-for="l in lines" :key="l.from._id" class="swap-line">
      <span class="swap-label">
        {{ l.from.category === 'licor' ? 'Licor' : 'Gaseosa' }}
        <small v-if="l.from.category === 'licor'">cambiarlo suma {{ formatMoney(LIQUOR_SURCHARGE) }}</small>
      </span>
      <BaseSelect
        :model-value="choice[l.from._id] || l.from._id"
        :options="l.options"
        searchable
        @update:model-value="(v: string) => (choice[l.from._id] = v)"
      />
    </div>
    <div class="swap-price">
      <span>{{ name }}</span>
      <strong>{{ formatMoney(price) }}</strong>
    </div>
    <template #footer>
      <button type="button" class="btn btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="button" class="btn btn-primary" :disabled="!swaps.length" @click="emit('confirm', swaps, name, price)">
        Agregar a la cuenta
      </button>
    </template>
  </BaseModal>
</template>

<style scoped lang="scss">
.swap-empty {
  margin: 0;
  color: var(--ink-600);
}

.swap-line {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 1rem;
}

.swap-label {
  font-weight: 600;
  color: var(--ink-900);

  small {
    margin-left: 0.4rem;
    font-weight: 400;
    color: var(--ink-600);
  }
}

.swap-price {
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
