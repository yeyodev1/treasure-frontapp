<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { Availability, Product, ProductCategory } from '@/types'
import { CATEGORY_LABELS } from '@/stores/catalog'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import { formatMoney } from '@/utils/format'

/**
 * Carta del bar: el producto es el botón (un toque suma una unidad).
 * Favoritos, Todas, Sin alcohol y categorías; lo que no tiene stock a bordo
 * aparece "No disponible" con lo que falta, sin bloquear el resto.
 */
const props = withDefaults(
  defineProps<{
    products: Product[]
    availability?: Availability
    favorites?: string[]
    pinned?: string[]
    pulse?: string
    disabled?: boolean
  }>(),
  { availability: () => ({}), favorites: () => [], pinned: () => [], pulse: '', disabled: false },
)
const emit = defineEmits<{
  add: [Product]
  toggleFavorite: [Product]
  requestReview: [Product]
  createCocktail: []
}>()

const NON_ALCOHOLIC: ProductCategory[] = ['gaseosa', 'agua', 'jugo', 'snack']

type Filter = 'favoritos' | 'todas' | 'sin_alcohol' | ProductCategory
const filter = shallowRef<Filter>(props.favorites.length ? 'favoritos' : 'todas')
const query = shallowRef('')
const editingFavorites = shallowRef(false)

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const categories = computed(() => {
  const present = new Set(props.products.map((p) => p.category))
  return (Object.keys(CATEGORY_LABELS) as ProductCategory[]).filter((c) => present.has(c))
})

const visible = computed(() => {
  const q = normalize(query.value.trim())
  const favs = new Set(props.favorites)
  const list = props.products.filter((p) => {
    if (q) return normalize(p.name).includes(q)
    if (filter.value === 'favoritos') return favs.has(p._id)
    if (filter.value === 'todas') return true
    if (filter.value === 'sin_alcohol') return NON_ALCOHOLIC.includes(p.category)
    return p.category === filter.value
  })
  if (filter.value === 'favoritos' && !q) {
    return list.sort((a, b) => props.favorites.indexOf(a._id) - props.favorites.indexOf(b._id))
  }
  return list
})

function isOff(p: Product) {
  return props.availability[p._id]?.available === false
}

function onTap(p: Product) {
  if (editingFavorites.value) {
    emit('toggleFavorite', p)
    return
  }
  emit('add', p)
}
</script>

<template>
  <div class="catalog">
    <label class="search">
      <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
      <input v-model="query" type="search" placeholder="Buscar bebida…" aria-label="Buscar bebida" />
      <button v-if="query" type="button" class="search-clear" aria-label="Limpiar búsqueda" @click="query = ''">
        <i class="fa-solid fa-xmark" aria-hidden="true" />
      </button>
    </label>

    <div class="chips" role="tablist">
      <button
        type="button"
        class="chip"
        :class="{ 'chip--active': filter === 'favoritos' }"
        @click="filter = 'favoritos'"
      >
        <i class="fa-solid fa-star" aria-hidden="true" /> Favoritos
      </button>
      <button type="button" class="chip" :class="{ 'chip--active': filter === 'todas' }" @click="filter = 'todas'">
        Todas
      </button>
      <button
        type="button"
        class="chip"
        :class="{ 'chip--active': filter === 'sin_alcohol' }"
        @click="filter = 'sin_alcohol'"
      >
        Sin alcohol
      </button>
      <button
        v-for="cat in categories"
        :key="cat"
        type="button"
        class="chip"
        :class="{ 'chip--active': filter === cat }"
        @click="filter = cat"
      >
        {{ CATEGORY_LABELS[cat] }}
      </button>
      <button
        type="button"
        class="chip chip--edit"
        :class="{ 'chip--active': editingFavorites }"
        :aria-pressed="editingFavorites"
        @click="editingFavorites = !editingFavorites"
      >
        <i class="fa-solid" :class="editingFavorites ? 'fa-check' : 'fa-pen'" aria-hidden="true" />
        {{ editingFavorites ? 'Listo' : 'Editar favoritos' }}
      </button>
    </div>

    <Transition name="fade">
      <p v-if="editingFavorites" class="edit-help">
        Toca una bebida para marcarla o quitarla de Favoritos.
      </p>
    </Transition>

    <p v-if="!visible.length" class="empty">
      <template v-if="query">No hay bebidas con "{{ query }}".</template>
      <template v-else-if="filter === 'favoritos'">Aún no hay favoritos: toca "Editar favoritos" o usa Todas.</template>
      <template v-else>No hay bebidas en este grupo.</template>
    </p>

    <TransitionGroup name="tile" tag="div" class="grid">
      <template v-for="product in visible" :key="product._id">
        <div v-if="isOff(product) && !editingFavorites" class="product product--off">
          <ProductIcon :icon="product.icon" :size="26" class="product-icon" />
          <span class="product-name">{{ product.name }}</span>
          <span class="product-off">No disponible · falta {{ availability[product._id]?.missing }}</span>
          <button type="button" class="review-btn" @click="emit('requestReview', product)">Pedir revisión</button>
        </div>
        <button
          v-else
          type="button"
          class="product"
          :class="{
            'product--pulse': pulse === product._id,
            'product--disabled': disabled && !editingFavorites,
            'product--fav': editingFavorites && pinned.includes(product._id),
          }"
          @click="onTap(product)"
        >
          <i v-if="editingFavorites" class="fa-star fav-mark" :class="pinned.includes(product._id) ? 'fa-solid' : 'fa-regular'" aria-hidden="true" />
          <ProductIcon :icon="product.icon" :size="28" class="product-icon" />
          <span class="product-name">{{ product.name }}</span>
          <span class="product-price">{{ formatMoney(product.price) }}</span>
        </button>
      </template>
    </TransitionGroup>
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
  min-height: 52px;
  padding: 0 0.9rem;
  margin-bottom: 0.7rem;
  background: var(--surface);
  border: 1.5px solid var(--cream-200);
  border-radius: 999px;
  color: var(--ink-400);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;

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
    font-size: 1rem;
    color: var(--ink-900);
  }
}

.search-clear {
  width: 44px;
  height: 44px;
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
  flex-wrap: wrap;
  gap: 0.4rem;
  padding-bottom: 0.6rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 48px;
  padding: 0 1rem;
  border-radius: 999px;
  background: var(--surface);
  border: 1.5px solid var(--cream-200);
  font-weight: 600;
  font-size: 0.88rem;
  white-space: nowrap;
  color: var(--ink-600);
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;

  &--active {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }

  &--edit {
    margin-left: auto;
    border-style: dashed;
  }
}

.edit-help {
  margin: 0 0 0.6rem;
  font-size: 0.88rem;
  color: var(--gold-500);
  font-weight: 600;
}

.empty {
  margin: 0.5rem 0 0.8rem;
  color: var(--ink-400);
  font-size: 0.9rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 0.55rem;

  @include desktop {
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  }
}

.product {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 0.3rem;
  padding: 0.8rem 0.75rem;
  background: var(--surface);
  border: 2px solid var(--cream-200);
  border-radius: var(--radius-sm);
  min-height: 112px;
  text-align: left;
  transition:
    transform 0.12s ease,
    border-color 0.15s ease,
    background 0.2s ease,
    opacity 0.2s ease;

  &:active {
    border-color: var(--gold-500);
    transform: scale(0.96);
  }

  &--pulse {
    animation: tap-pulse 0.38s ease;
  }

  &--disabled {
    opacity: 0.55;
  }

  &--fav {
    border-color: var(--gold-500);
    background: rgba(159, 107, 60, 0.07);
  }

  &--off {
    background: var(--cream-100);
    border-style: dashed;
    justify-content: flex-start;

    .product-name {
      color: var(--ink-400);
    }
  }
}

@keyframes tap-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(63, 122, 87, 0.45);
    border-color: var(--success);
  }
  100% {
    box-shadow: 0 0 0 14px rgba(63, 122, 87, 0);
  }
}

.fav-mark {
  position: absolute;
  top: 0.55rem;
  right: 0.6rem;
  color: var(--gold-500);
}

.product-icon {
  color: var(--navy-700);
}

.product-name {
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.product-price {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--gold-500);
  font-variant-numeric: tabular-nums;
}

.product-off {
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--danger);
  line-height: 1.25;
}

.review-btn {
  min-height: 40px;
  margin-top: auto;
  padding: 0 0.6rem;
  border-radius: 9px;
  border: 1.5px solid var(--navy-600);
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--navy-600);
  background: var(--surface);
  transition: background 0.15s ease;

  &:hover {
    background: var(--powder-100);
  }
}

.tile-enter-active,
.tile-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.tile-enter-from,
.tile-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
