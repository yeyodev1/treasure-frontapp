<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { Product, ProductCategory } from '@/types'
import { CATEGORY_LABELS } from '@/stores/catalog'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import { formatMoney } from '@/utils/format'

const props = defineProps<{ products: Product[] }>()
const emit = defineEmits<{ add: [Product]; createCocktail: [] }>()

const activeCategory = shallowRef<ProductCategory | 'todas'>('todas')
const query = shallowRef('')

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const categories = computed(() => {
  const present = new Set(props.products.map((p) => p.category))
  return (Object.keys(CATEGORY_LABELS) as ProductCategory[]).filter((c) => present.has(c))
})

const visible = computed(() => {
  const q = normalize(query.value.trim())
  return props.products.filter(
    (p) =>
      (activeCategory.value === 'todas' || p.category === activeCategory.value) &&
      (!q || normalize(p.name).includes(q)),
  )
})
</script>

<template>
  <div class="catalog">
    <label class="search">
      <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
      <input v-model="query" type="search" placeholder="Buscar bebida" aria-label="Buscar bebida" />
      <button v-if="query" type="button" class="search-clear" aria-label="Limpiar búsqueda" @click="query = ''">
        <i class="fa-solid fa-xmark" aria-hidden="true" />
      </button>
    </label>

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

    <p v-if="!visible.length" class="empty">
      No hay bebidas con "{{ query }}". Prueba otro nombre o crea un cóctel.
    </p>

    <div class="grid">
      <button
        v-for="product in visible"
        :key="product._id"
        type="button"
        class="product"
        @click="emit('add', product)"
      >
        <ProductIcon :icon="product.icon" :size="28" class="product-icon" />
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

.catalog {
  min-width: 0;
}

.search {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 48px;
  padding: 0 0.9rem;
  margin-bottom: 0.7rem;
  background: var(--surface);
  border: 1.5px solid var(--cream-200);
  border-radius: 999px;
  color: var(--ink-400);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;

  &:focus-within {
    border-color: var(--gold-500);
    box-shadow: 0 0 0 3px rgba(159, 107, 60, 0.15);
  }

  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 0.98rem;
    color: var(--ink-900);
  }
}

.search-clear {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--ink-400);

  &:hover {
    background: var(--cream-100);
  }
}

.chips {
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  padding-bottom: 0.55rem;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.chip {
  flex-shrink: 0;
  min-height: 40px;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  background: var(--surface);
  border: 1.5px solid var(--cream-200);
  font-weight: 600;
  font-size: 0.85rem;
  white-space: nowrap;
  color: var(--ink-600);
  transition: all 0.14s ease;

  &--active {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }
}

.empty {
  margin: 0.5rem 0 0.8rem;
  color: var(--ink-400);
  font-size: 0.9rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 0.5rem;

  @include tablet {
    grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  }
}

.product {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  padding: 0.75rem 0.4rem;
  background: var(--surface);
  border: 2px solid var(--cream-200);
  border-radius: var(--radius-sm);
  min-height: 100px;
  transition: transform 0.1s ease, border-color 0.1s ease;

  &:active {
    border-color: var(--gold-500);
    transform: scale(0.96);
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
  font-size: 1.35rem;
  color: var(--gold-500);
}

.product-name {
  font-size: 0.78rem;
  font-weight: 600;
  text-align: center;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.product-price {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--gold-500);
  font-variant-numeric: tabular-nums;
}
</style>
