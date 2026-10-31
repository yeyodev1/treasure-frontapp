<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { Availability, Product, ProductCategory, WineStyle } from '@/types'
import { CATEGORY_LABELS, DRINK_FORMAT_LABELS, WINE_STYLE_LABELS, drinkFormat, type DrinkFormat } from '@/stores/catalog'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import { formatMoney } from '@/utils/format'

/**
 * Carta del bar: el producto es el botón (un toque suma una unidad).
 * Favoritos, Todas, Sin alcohol y categorías; lo que no tiene stock a bordo
 * aparece "No disponible" con lo que falta, sin bloquear el resto.
 * En celular (checklist 29-oct, 12) solo quedan Favoritos, Todas, Sin alcohol
 * y "Más" (resto de categorías y Editar favoritos) para que las bebidas se
 * vean sin desplazarse; las zonas táctiles no se achican.
 * Licores se dividen en trago y botella; Vinos en tinto, blanco, rosado y
 * espumante, y por copa, botella o botella pequeña (pedido del cliente,
 * 31-oct-2026): cada división tiene su título y su filtro.
 */
const props = withDefaults(
  defineProps<{
    products: Product[]
    availability?: Availability
    favorites?: string[]
    pinned?: string[]
    pulse?: string
    /** Bebida recién confirmada por el servidor: se resalta un momento. */
    confirmed?: string
    disabled?: boolean
  }>(),
  { availability: () => ({}), favorites: () => [], pinned: () => [], pulse: '', confirmed: '', disabled: false },
)
const emit = defineEmits<{
  add: [Product]
  toggleFavorite: [Product]
  requestReview: [Product]
  createCocktail: []
}>()

const NON_ALCOHOLIC: ProductCategory[] = ['gaseosa', 'agua', 'jugo', 'snack']

export type CatalogFilter = 'favoritos' | 'todas' | 'sin_alcohol' | ProductCategory
type Filter = CatalogFilter
/** El filtro lo guarda la vista del bar para recuperarlo al recargar. */
const filter = defineModel<Filter>('filter', { default: 'todas' })
const query = shallowRef('')
const editingFavorites = shallowRef(false)
const showMore = shallowRef(false)

const isCategory = computed(() => !['favoritos', 'todas', 'sin_alcohol'].includes(filter.value))

// ---- Divisiones de Licores y Vinos ----
type LiquorFormat = 'todos' | 'trago' | 'botella'
type WineStyleFilter = 'todos' | WineStyle | 'sin_tipo'
type WineFormat = 'todos' | 'copa' | 'botella' | 'botella_pequena'
const liquorFormat = shallowRef<LiquorFormat>('todos')
const wineStyle = shallowRef<WineStyleFilter>('todos')
const wineFormat = shallowRef<WineFormat>('todos')

const FORMAT_ORDER: DrinkFormat[] = ['trago', 'copa', 'botella', 'botella_pequena']
const STYLE_ORDER: WineStyle[] = ['tinto', 'blanco', 'rosado', 'espumante']
const STYLE_GROUP: Record<WineStyle | 'sin_tipo', string> = {
  tinto: 'Tintos',
  blanco: 'Blancos',
  rosado: 'Rosados',
  espumante: 'Espumantes',
  sin_tipo: 'Sin tipo',
}
const FORMAT_GROUP: Record<DrinkFormat, string> = {
  trago: 'Tragos',
  copa: 'Por copa',
  botella: 'Botellas',
  botella_pequena: 'Botellas pequeñas',
}

function styleOf(p: Product): WineStyle | 'sin_tipo' {
  return p.wineStyle || 'sin_tipo'
}

/** Tragos y copas primero, luego botellas; dentro, por nombre. */
function byFormat(a: Product, b: Product) {
  const fa = FORMAT_ORDER.indexOf(drinkFormat(a) ?? 'botella')
  const fb = FORMAT_ORDER.indexOf(drinkFormat(b) ?? 'botella')
  return fa - fb || a.name.localeCompare(b.name, 'es')
}

const liquors = computed(() => props.products.filter((p) => p.category === 'licor'))
const wines = computed(() => props.products.filter((p) => p.category === 'vino'))

const liquorOptions = computed(() => {
  const count = (f: DrinkFormat) => liquors.value.filter((p) => drinkFormat(p) === f).length
  return [
    { value: 'todos' as LiquorFormat, label: 'Todos', count: liquors.value.length },
    { value: 'trago' as LiquorFormat, label: 'Tragos', count: count('trago') },
    { value: 'botella' as LiquorFormat, label: 'Botellas', count: count('botella') },
  ].filter((o) => o.value === 'todos' || o.count)
})

const wineStyleOptions = computed(() => {
  const inFormat = wines.value.filter((p) => wineFormat.value === 'todos' || drinkFormat(p) === wineFormat.value)
  const opts: Array<{ value: WineStyleFilter; label: string; count: number }> = [
    { value: 'todos', label: 'Todos', count: inFormat.length },
    ...STYLE_ORDER.map((st) => ({ value: st, label: WINE_STYLE_LABELS[st], count: inFormat.filter((p) => p.wineStyle === st).length })),
    { value: 'sin_tipo', label: 'Sin tipo', count: inFormat.filter((p) => !p.wineStyle).length },
  ]
  return opts.filter((o) => o.value === 'todos' || o.count || o.value === wineStyle.value)
})

const wineFormatOptions = computed(() => {
  const inStyle = wines.value.filter((p) => wineStyle.value === 'todos' || styleOf(p) === wineStyle.value)
  const opts: Array<{ value: WineFormat; label: string; count: number }> = [
    { value: 'todos', label: 'Copa y botella', count: inStyle.length },
    ...(['copa', 'botella', 'botella_pequena'] as const).map((f) => ({
      value: f,
      label: DRINK_FORMAT_LABELS[f],
      count: inStyle.filter((p) => drinkFormat(p) === f).length,
    })),
  ]
  return opts.filter((o) => o.value === 'todos' || o.count || o.value === wineFormat.value)
})

function passesSubFilter(p: Product): boolean {
  if (filter.value === 'licor') return liquorFormat.value === 'todos' || drinkFormat(p) === liquorFormat.value
  if (filter.value === 'vino') {
    return (
      (wineStyle.value === 'todos' || styleOf(p) === wineStyle.value) &&
      (wineFormat.value === 'todos' || drinkFormat(p) === wineFormat.value)
    )
  }
  return true
}

function pickMore(next: Filter) {
  filter.value = next
  showMore.value = false
}

function editFromMore() {
  showMore.value = false
  editingFavorites.value = true
}

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
    return p.category === filter.value && passesSubFilter(p)
  })
  if (filter.value === 'favoritos' && !q) {
    return list.sort((a, b) => props.favorites.indexOf(a._id) - props.favorites.indexOf(b._id))
  }
  return list
})

/**
 * En "Todas" la carta va por grupos con su título (Cócteles, Licores…) para
 * ubicar la bebida de un vistazo; buscando o en un filtro, una sola grilla.
 */
const groups = computed(() => {
  const single = [{ key: 'all', label: '', items: visible.value }]
  if (query.value.trim()) return single
  if (filter.value === 'todas') {
    return categories.value
      .map((cat) => {
        const items = visible.value.filter((p) => p.category === cat)
        return { key: cat, label: CATEGORY_LABELS[cat], items: cat === 'licor' || cat === 'vino' ? items.sort(byFormat) : items }
      })
      .filter((g) => g.items.length)
  }
  // Licores: Tragos y Botellas, cada uno con su título.
  if (filter.value === 'licor' && liquorFormat.value === 'todos') {
    return (['trago', 'botella'] as const)
      .map((f) => ({ key: f, label: FORMAT_GROUP[f], items: visible.value.filter((p) => drinkFormat(p) === f) }))
      .filter((g) => g.items.length)
  }
  // Vinos: por tipo (tintos, blancos…) y dentro copa antes que botella;
  // con un tipo elegido, por copa, botella y botella pequeña.
  if (filter.value === 'vino' && wineStyle.value === 'todos') {
    return [...STYLE_ORDER, 'sin_tipo' as const]
      .map((st) => ({ key: st, label: STYLE_GROUP[st], items: visible.value.filter((p) => styleOf(p) === st).sort(byFormat) }))
      .filter((g) => g.items.length)
  }
  if (filter.value === 'vino' && wineFormat.value === 'todos') {
    return (['copa', 'botella', 'botella_pequena'] as const)
      .map((f) => ({ key: f, label: FORMAT_GROUP[f], items: visible.value.filter((p) => drinkFormat(p) === f) }))
      .filter((g) => g.items.length)
  }
  return single
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
    <div class="toolbar">
      <label class="search">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
        <input v-model="query" type="search" placeholder="Buscar bebida…" aria-label="Buscar bebida" />
        <button v-if="query" type="button" class="search-clear" aria-label="Limpiar búsqueda" @click="query = ''">
          <i class="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </label>
      <!-- Crear cóctel a la vista (antes solo estaba en Menú y no se encontraba) -->
      <button type="button" class="create-cocktail" @click="emit('createCocktail')">
        <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
        <span>Crear cóctel</span>
      </button>
    </div>

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
        class="chip chip--cat"
        :class="{ 'chip--active': filter === cat }"
        @click="filter = cat"
      >
        {{ CATEGORY_LABELS[cat] }}
      </button>
      <!-- Celular: el resto de categorías va en "Más"; si hay una elegida, se nombra aquí -->
      <button
        type="button"
        class="chip chip--more"
        :class="{ 'chip--active': isCategory }"
        :aria-expanded="showMore"
        @click="showMore = true"
      >
        <template v-if="isCategory">{{ CATEGORY_LABELS[filter as ProductCategory] }}</template>
        <template v-else>Más</template>
        <i class="fa-solid fa-chevron-down" aria-hidden="true" />
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

    <!-- Licores: trago o botella -->
    <div v-if="filter === 'licor' && !query" class="subchips" role="group" aria-label="Licores por">
      <button
        v-for="opt in liquorOptions"
        :key="opt.value"
        type="button"
        class="subchip"
        :class="{ 'subchip--active': liquorFormat === opt.value }"
        :aria-pressed="liquorFormat === opt.value"
        @click="liquorFormat = opt.value"
      >
        {{ opt.label }} <span class="subchip-count">{{ opt.count }}</span>
      </button>
    </div>

    <!-- Vinos: tipo y cómo se sirve -->
    <div v-if="filter === 'vino' && !query" class="subchips" role="group" aria-label="Vinos por">
      <button
        v-for="opt in wineStyleOptions"
        :key="opt.value"
        type="button"
        class="subchip"
        :class="{ 'subchip--active': wineStyle === opt.value }"
        :aria-pressed="wineStyle === opt.value"
        @click="wineStyle = opt.value"
      >
        {{ opt.label }} <span class="subchip-count">{{ opt.count }}</span>
      </button>
      <span class="subchips-sep" aria-hidden="true" />
      <button
        v-for="opt in wineFormatOptions"
        :key="opt.value"
        type="button"
        class="subchip"
        :class="{ 'subchip--active': wineFormat === opt.value }"
        :aria-pressed="wineFormat === opt.value"
        @click="wineFormat = opt.value"
      >
        {{ opt.label }} <span class="subchip-count">{{ opt.count }}</span>
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

    <BaseModal v-if="showMore" title="Más categorías" @close="showMore = false">
      <div class="more-grid">
        <button
          v-for="cat in categories"
          :key="cat"
          type="button"
          class="chip"
          :class="{ 'chip--active': filter === cat }"
          @click="pickMore(cat)"
        >
          {{ CATEGORY_LABELS[cat] }}
        </button>
      </div>
      <button type="button" class="chip chip--edit-more" @click="editFromMore">
        <i class="fa-solid fa-pen" aria-hidden="true" /> Editar favoritos
      </button>
    </BaseModal>

    <section v-for="group in groups" :key="group.key" class="group" :aria-label="group.label || undefined">
      <h3 v-if="group.label" class="group-title">
        {{ group.label }} <span class="group-count">{{ group.items.length }}</span>
      </h3>
      <TransitionGroup name="tile" tag="div" class="grid">
        <template v-for="product in group.items" :key="product._id">
          <div v-if="isOff(product) && !editingFavorites" class="product product--off">
            <span class="product-name">{{ product.name }}</span>
            <span class="product-off">
              <strong><i class="fa-solid fa-ban" aria-hidden="true" /> No disponible</strong>
              Falta {{ availability[product._id]?.missing }}
            </span>
            <button type="button" class="review-btn" @click="emit('requestReview', product)">Pedir revisión</button>
          </div>
          <button
            v-else
            type="button"
            class="product"
            :data-product="product._id"
            :class="{
              'product--pulse': pulse === product._id,
              'product--confirmed': confirmed === product._id,
              'product--disabled': disabled && !editingFavorites,
              'product--fav': editingFavorites && pinned.includes(product._id),
            }"
            @click="onTap(product)"
          >
            <i v-if="editingFavorites" class="fa-star fav-mark" :class="pinned.includes(product._id) ? 'fa-solid' : 'fa-regular'" aria-hidden="true" />
            <ProductIcon :icon="product.icon" :size="26" class="product-icon" />
            <span class="product-name">{{ product.name }}</span>
            <span class="product-price">{{ formatMoney(product.price) }}</span>
          </button>
        </template>
      </TransitionGroup>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.catalog {
  min-width: 0;
}

.toolbar {
  display: flex;
  gap: 0.5rem;
  align-items: stretch;
  margin-bottom: 0.7rem;

  .search {
    flex: 1 1 auto;
    min-width: 0;
    margin-bottom: 0;
  }
}

.create-cocktail {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 48px;
  padding: 0 1rem;
  border-radius: 999px;
  background: var(--gold-500);
  color: #fff;
  font-weight: 700;
  font-size: 0.92rem;
  white-space: nowrap;
  transition:
    background 0.15s ease,
    transform 0.12s ease;

  &:hover {
    background: var(--gold-400);
  }

  &:active {
    transform: scale(0.97);
  }
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
  flex-wrap: nowrap;
  gap: 0.4rem;
  padding-bottom: 0.6rem;

  // Tableta: una sola fila que se desliza, sin segunda línea de filtros.
  @include tablet {
    overflow-x: auto;
    scrollbar-width: none;
    margin: 0 -2px;
    padding: 0 2px 0.6rem;

    &::-webkit-scrollbar {
      display: none;
    }
  }
}

// Celular: Favoritos, Todas, Sin alcohol y Más en una sola fila.
.chip--cat,
.chip--edit {
  display: none !important;

  @include tablet {
    display: inline-flex !important;
  }
}

.chips > .chip {
  flex: 1 1 auto;
  justify-content: center;
  min-width: 0;

  @include tablet {
    flex: 0 0 auto;
  }
}

.chip--more {

  @include tablet {
    display: none !important;
  }
}

.more-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.chip--edit-more {
  border-style: dashed;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 48px;
  padding: 0 0.8rem;
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

  @include tablet {
    padding: 0 1rem;
  }
}

// Divisiones de Licores y Vinos: más chicas que las categorías, misma fila deslizable.
.subchips {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  overflow-x: auto;
  scrollbar-width: none;
  margin: -0.15rem -2px 0.6rem;
  padding: 0 2px;

  &::-webkit-scrollbar {
    display: none;
  }
}

.subchips-sep {
  flex: 0 0 1px;
  align-self: stretch;
  margin: 0.45rem 0.3rem;
  background: var(--cream-200);
}

.subchip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 44px;
  padding: 0 0.85rem;
  border-radius: 999px;
  border: 1.5px solid transparent;
  background: var(--cream-100);
  font-weight: 600;
  font-size: 0.85rem;
  white-space: nowrap;
  color: var(--ink-600);
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    transform 0.12s ease;

  &:active {
    transform: scale(0.97);
  }

  &--active {
    background: var(--powder-100);
    border-color: var(--navy-700);
    color: var(--navy-800);
  }
}

.subchip-count {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ink-400);
  font-variant-numeric: tabular-nums;
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
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));

  @include tablet {
    grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  }

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
  min-height: 96px;
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

  &--confirmed {
    animation: tap-confirmed 1.4s ease;
  }

  &--disabled {
    opacity: 0.55;
  }

  &--fav {
    border-color: var(--gold-500);
    background: rgba(159, 107, 60, 0.07);
  }

  @include tablet {
    min-height: 112px;
  }

  &--off {
    background: var(--cream-100);
    border-style: dashed;
    justify-content: flex-start;

    .product-name {
      color: var(--ink-600);
    }
  }
}

@keyframes tap-confirmed {
  0%,
  60% {
    border-color: var(--success);
    background: rgba(63, 122, 87, 0.1);
    box-shadow: 0 0 0 3px rgba(63, 122, 87, 0.25);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(63, 122, 87, 0);
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
  // Ícono arriba, nombre y precio abajo: así las tarjetas de una fila alinean.
  margin-bottom: auto;
}

.product-name {
  font-size: 0.92rem;
  font-weight: 700;
  line-height: 1.2;
  overflow-wrap: break-word;
  hyphens: auto;

  @include tablet {
    font-size: 0.95rem;
  }
}

.product-price {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--gold-500);
  font-variant-numeric: tabular-nums;
}

.product-off {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--ink-600);
  line-height: 1.25;

  strong {
    font-weight: 700;
    color: var(--danger);
  }
}

.group + .group {
  margin-top: 1.1rem;
}

.group-title {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  margin: 0 0 0.5rem;
  font-family: var(--font-serif);
  font-size: 1.15rem;
  color: var(--ink-900);
}

.group-count {
  font-family: var(--font-sans);
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--ink-400);
  font-variant-numeric: tabular-nums;
}

.review-btn {
  min-height: 44px;
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
