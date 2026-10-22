<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { Product, ProductCategory } from '@/types'
import { CATEGORY_LABELS } from '@/stores/catalog'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import { formatMoney } from '@/utils/format'

const props = defineProps<{ products: Product[] }>()
const emit = defineEmits<{ add: [Product]; createCocktail: [] }>()

const activeCategory = shallowRef<ProductCategory | 'todas'>('todas')

const categories = computed(() => {
  const present = new Set(props.products.map((p) => p.category))
  return (Object.keys(CATEGORY_LABELS) as ProductCategory[]).filter((c) => present.has(c))
})

const visible = computed(() =>
  activeCategory.value === 'todas'
    ? props.products
    : props.products.filter((p) => p.category === activeCategory.value),
)
</script>

<template>
  <div class="catalog">
    <div class="chips" role="tablist">
      <button
        type="button"
        class="chip"
        :class="{ 'chip--active': activeCategory === 'todas' }"
        @click="activeCategory = 'todas'"
      >
        Todas
      </button>
      <button
        v-for="cat in categories"
        :key="cat"
        type="button"
        class="chip"
        :class="{ 'chip--active': activeCategory === cat }"
        @click="activeCategory = cat"
      >
        {{ CATEGORY_LABELS[cat] }}
      </button>
    </div>

    <div class="grid">
      <button
        v-for="product in visible"
        :key="product._id"
        type="button"
        class="product"
        @click="emit('add', product)"
      >
        <ProductIcon :icon="product.icon" :size="30" class="product-icon" />
        <span class="product-name">{{ product.name }}</span>
        <span class="product-price">{{ formatMoney(product.price) }}</span>
      </button>

      <button type="button" class="product product--new" @click="emit('createCocktail')">
        <i class="fa-solid fa-wand-magic-sparkles product-plus" aria-hidden="true" />
        <span class="product-name">Crear cóctel</span>
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.chips {
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  padding-bottom: 0.5rem;
  -webkit-overflow-scrolling: touch;
}

.chip {
  @include touch-target;
  min-width: auto;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  background: var(--surface);
  border: 1.5px solid var(--cream-200);
  font-weight: 600;
  font-size: 0.85rem;
  white-space: nowrap;
  color: var(--ink-600);

  &--active {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: var(--cream-100);
  }
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 0.5rem;

  @include tablet {
    grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
    gap: 0.65rem;
  }
}

.product {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  padding: 0.8rem 0.4rem;
  background: var(--surface);
  border: 2px solid var(--cream-200);
  border-radius: var(--radius-sm);
  min-height: 104px;
  transition: all 0.1s ease;

  &:active {
    border-color: var(--teal-400);
    transform: scale(0.97);
  }

  &--new {
    border-style: dashed;
    border-color: var(--gold-500);
    color: var(--navy-700);
  }
}

.product-icon {
  color: var(--navy-700);
}

.product-plus {
  font-size: 1.4rem;
  line-height: 1;
  color: var(--gold-500);
}

.product-name {
  font-size: 0.78rem;
  font-weight: 600;
  text-align: center;
  line-height: 1.15;
}

.product-price {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--ink-400);
}
</style>
