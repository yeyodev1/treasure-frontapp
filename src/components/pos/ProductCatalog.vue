<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { Availability, Product, ProductCategory, WineStyle } from '@/types'
import {
  BAR_GROUP_LABELS,
  CATEGORY_LABELS,
  SERVING_ICON_LABELS,
  WINE_STYLE_LABELS,
  barGroupOf,
  drinkFormat,
  servingIconOf,
  type BarGroup,
  type DrinkFormat,
} from '@/stores/catalog'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import ServingIcon from '@/components/ui/ServingIcon.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import { formatMoney } from '@/utils/format'

/**
 * Carta del bar: el producto es el botón (un toque suma una unidad).
 * Favoritos, Todas, Sin alcohol y categorías; lo que no tiene stock a bordo
 * aparece "No disponible" con lo que falta, sin bloquear el resto.
 * En celular (checklist 29-oct, 12) solo quedan Favoritos, Todas, Sin alcohol
 * y "Más" (resto de categorías y Editar favoritos) para que las bebidas se
 * vean sin desplazarse; las zonas táctiles no se achican.
 * Vinos se dividen en tinto, blanco, rosado y espumante (pedido del
 * cliente, 31-oct-2026), cada tipo con su título y su filtro.
 * Color e iconos (Especificación · Pantalla Bar, 7-nov-2026): el color dice
 * la categoría (franja, cuadro del icono y punto), el icono cómo se sirve; el
 * trago o la copa y su botella van en una sola tarjeta con zona «Botella».
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
    /** Unidades registradas hoy en la cabina, por producto («×2 hoy»). */
    todayCounts?: Record<string, number>
    /** "la Cabina 1": para confirmar una botella completa. */
    target?: string
  }>(),
  {
    availability: () => ({}),
    favorites: () => [],
    pinned: () => [],
    pulse: '',
    confirmed: '',
    disabled: false,
    todayCounts: () => ({}),
    target: '',
  },
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
// Trago y botella van en una tarjeta (7-nov-2026): ya no se filtra por formato.
type WineStyleFilter = 'todos' | WineStyle | 'sin_tipo'
const wineStyle = shallowRef<WineStyleFilter>('todos')

const FORMAT_ORDER: DrinkFormat[] = ['trago', 'copa', 'botella', 'botella_pequena']
const STYLE_ORDER: WineStyle[] = ['tinto', 'blanco', 'rosado', 'espumante']
const STYLE_GROUP: Record<WineStyle | 'sin_tipo', string> = {
  tinto: 'Tintos',
  blanco: 'Blancos',
  rosado: 'Rosados',
  espumante: 'Espumantes',
  sin_tipo: 'Sin tipo',
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

const wines = computed(() => props.products.filter((p) => p.category === 'vino'))

const wineStyleOptions = computed(() => {
  const inFormat = wines.value
  const opts: Array<{ value: WineStyleFilter; label: string; count: number }> = [
    { value: 'todos', label: 'Todos', count: inFormat.length },
    ...STYLE_ORDER.map((st) => ({ value: st, label: WINE_STYLE_LABELS[st], count: inFormat.filter((p) => p.wineStyle === st).length })),
    { value: 'sin_tipo', label: 'Sin tipo', count: inFormat.filter((p) => !p.wineStyle).length },
  ]
  return opts.filter((o) => o.value === 'todos' || o.count || o.value === wineStyle.value)
})

function passesSubFilter(p: Product): boolean {
  return filter.value !== 'vino' || wineStyle.value === 'todos' || styleOf(p) === wineStyle.value
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

const GROUP_ORDER: BarGroup[] = ['coctel', 'licor', 'vino', 'cerveza', 'sin_alcohol', 'servicio', 'otro']

/** Filtros de categoría con su punto de color; las sin alcohol van juntas. */
const groupChips = computed(() => {
  const present = new Set(props.products.map(barGroupOf))
  type Chip = { value: Filter; group: BarGroup; label: string; cat: boolean }
  return GROUP_ORDER.filter((g) => present.has(g)).flatMap((g): Chip[] => {
    if (g === 'sin_alcohol') return [{ value: 'sin_alcohol', group: g, label: BAR_GROUP_LABELS[g], cat: false }]
    const cats = categories.value.filter((c) => !NON_ALCOHOLIC.includes(c) && barGroupOf({ category: c } as Product) === g)
    return cats.map((c) => ({ value: c, group: g, label: CATEGORY_LABELS[c], cat: true }))
  })
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
    return GROUP_ORDER.map((g) => {
      const items = visible.value.filter((p) => barGroupOf(p) === g)
      return { key: g, label: BAR_GROUP_LABELS[g], items: g === 'licor' || g === 'vino' ? items.sort(byFormat) : items }
    }).filter((g) => g.items.length)
  }
  // Vinos: por tipo (tintos, blancos…), copa antes que botella.
  if (filter.value === 'vino' && wineStyle.value === 'todos') {
    return [...STYLE_ORDER, 'sin_tipo' as const]
      .map((st) => ({ key: st, label: STYLE_GROUP[st], items: visible.value.filter((p) => styleOf(p) === st).sort(byFormat) }))
      .filter((g) => g.items.length)
  }
  return single
})

function isOff(p: Product) {
  return props.availability[p._id]?.available === false
}

// ---- Tarjetas: trago/copa y botella juntos (sección 7) ----
interface Card {
  key: string
  main: Product
  /** Botella del mismo licor o vino, en la zona «Botella» de la tarjeta. */
  bottle: Product | null
}

/** "Absolut (trago)" → "Absolut"; "Adobe Reserva Carmenere mini 375ml" → "Adobe Reserva Carmenere". */
function baseName(p: Product) {
  if (p.category !== 'licor' && p.category !== 'vino') return p.name
  return p.name.replace(/\s*\((trago|botella|copa)\)\s*$/i, '').replace(/\s+(mini\s+)?\d+\s?ml$/i, '')
}

function cardsOf(items: Product[]): Card[] {
  const cards = new Map<string, Card>()
  for (const p of items) {
    const format = drinkFormat(p)
    const pairs = format === 'trago' || format === 'copa' || format === 'botella'
    const key = pairs ? `${p.category}|${baseName(p).toLowerCase()}` : p._id
    const card = cards.get(key)
    if (!card) cards.set(key, { key, main: p, bottle: null })
    else if (format === 'botella' && !card.bottle && card.main.kind === 'receta') card.bottle = p
    else if (p.kind === 'receta' && card.main.kind !== 'receta' && !card.bottle) cards.set(key, { key, main: p, bottle: card.main })
    else cards.set(p._id, { key: p._id, main: p, bottle: null })
  }
  return [...cards.values()]
}

const groupCards = computed(() => groups.value.map((g) => ({ ...g, cards: cardsOf(g.items) })))

const FORMAT_TEXT: Record<string, string> = {
  ...SERVING_ICON_LABELS,
  botvino: 'Botella',
  botlicor: 'Botella',
  cerveza: 'Botella',
  agua: 'Botella',
  descorche: 'Servicio',
}

/** Línea pequeña bajo el nombre: «Vaso alto», «Trago», «Copa», «Mini 375 ml». */
function formatText(card: Card) {
  const p = card.main
  const format = drinkFormat(p)
  if (format === 'trago') return card.bottle ? 'Trago' : 'Trago · sin botella'
  if (format === 'copa') return 'Copa'
  if (format === 'botella_pequena') return `Mini ${p.containerSize} ml`
  if (format === 'botella') return p.wineStyle === 'espumante' ? 'Espumante · botella' : 'Botella'
  const icon = servingIconOf(p)
  return icon ? FORMAT_TEXT[icon] : ''
}

function todayOf(card: Card) {
  return (props.todayCounts[card.main._id] ?? 0) + (card.bottle ? (props.todayCounts[card.bottle._id] ?? 0) : 0)
}

function hasId(card: Card, id: string) {
  return Boolean(id) && (card.main._id === id || card.bottle?._id === id)
}

/** La botella completa se confirma antes de cargarla (sección 7). */
const pendingBottle = shallowRef<{ product: Product; name: string } | null>(null)

function onBottle(card: Card) {
  if (!card.bottle) return
  if (editingFavorites.value) {
    emit('toggleFavorite', card.bottle)
    return
  }
  pendingBottle.value = { product: card.bottle, name: baseName(card.bottle) }
}

function confirmBottle() {
  const pending = pendingBottle.value
  pendingBottle.value = null
  if (pending) emit('add', pending.product)
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
        v-for="chip in groupChips"
        :key="chip.value"
        type="button"
        class="chip"
        :class="[`cat-${chip.group}`, { 'chip--cat': chip.cat, 'chip--active': filter === chip.value }]"
        @click="filter = chip.value"
      >
        <span class="cat-dot" aria-hidden="true" /> {{ chip.label }}
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

    <!-- Vinos: por tipo -->
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
          v-for="chip in groupChips.filter((c) => c.cat)"
          :key="chip.value"
          type="button"
          class="chip"
          :class="[`cat-${chip.group}`, { 'chip--active': filter === chip.value }]"
          @click="pickMore(chip.value)"
        >
          <span class="cat-dot" aria-hidden="true" /> {{ chip.label }}
        </button>
      </div>
      <button type="button" class="chip chip--edit-more" @click="editFromMore">
        <i class="fa-solid fa-pen" aria-hidden="true" /> Editar favoritos
      </button>
    </BaseModal>

    <section v-for="group in groupCards" :key="group.key" class="group" :aria-label="group.label || undefined">
      <h3 v-if="group.label" class="group-title" :class="GROUP_ORDER.includes(group.key as BarGroup) ? `cat-${group.key}` : ''">
        <span v-if="GROUP_ORDER.includes(group.key as BarGroup)" class="cat-dot" aria-hidden="true" />
        {{ group.label }} <span class="group-count">{{ group.cards.length }}</span>
      </h3>
      <TransitionGroup name="tile" tag="div" class="grid">
        <div
          v-for="card in group.cards"
          :key="card.key"
          class="drink"
          :class="[
            `cat-${barGroupOf(card.main)}`,
            {
              'drink--off': isOff(card.main) && !editingFavorites,
              'drink--today': todayOf(card) > 0 && !editingFavorites,
              'drink--pulse': hasId(card, pulse),
              'drink--confirmed': hasId(card, confirmed),
              'drink--disabled': disabled && !editingFavorites,
              'drink--fav': editingFavorites && pinned.includes(card.main._id),
            },
          ]"
        >
          <span v-if="todayOf(card) && !editingFavorites" class="today-badge">×{{ todayOf(card) }} hoy</span>
          <template v-if="isOff(card.main) && !editingFavorites">
            <div class="product">
              <span class="product-icon">
                <ServingIcon v-if="servingIconOf(card.main)" :kind="servingIconOf(card.main)!" />
                <ProductIcon v-else :icon="card.main.icon" :size="30" />
              </span>
              <span class="product-name">{{ baseName(card.main) }}</span>
              <span class="product-format">{{ formatText(card) }}</span>
              <span class="product-off">No disponible · falta {{ availability[card.main._id]?.missing }}</span>
            </div>
            <button type="button" class="review-btn" @click="emit('requestReview', card.main)">Pedir revisión</button>
          </template>
          <template v-else>
            <button type="button" class="product" :data-product="card.main._id" @click="onTap(card.main)">
              <i
                v-if="editingFavorites"
                class="fa-star fav-mark"
                :class="pinned.includes(card.main._id) ? 'fa-solid' : 'fa-regular'"
                aria-hidden="true"
              />
              <span class="product-icon">
                <ServingIcon v-if="servingIconOf(card.main)" :kind="servingIconOf(card.main)!" />
                <ProductIcon v-else :icon="card.main.icon" :size="30" />
              </span>
              <span class="product-name">{{ baseName(card.main) }}</span>
              <span class="product-format">{{ formatText(card) }}</span>
              <span class="product-price">{{ formatMoney(card.main.price) }}</span>
            </button>
            <button
              v-if="card.bottle"
              type="button"
              class="bottle"
              :class="{ 'bottle--fav': editingFavorites && pinned.includes(card.bottle._id) }"
              :data-product="card.bottle._id"
              :disabled="isOff(card.bottle) && !editingFavorites"
              :aria-label="`Botella de ${baseName(card.bottle)}, ${formatMoney(card.bottle.price)}`"
              @click="onBottle(card)"
            >
              <ServingIcon :kind="servingIconOf(card.bottle) ?? 'botlicor'" :size="20" />
              <span class="bottle-label">{{ isOff(card.bottle) ? 'Botella · no disp.' : 'Botella' }}</span>
              <span class="bottle-price">{{ formatMoney(card.bottle.price) }}</span>
            </button>
          </template>
        </div>
      </TransitionGroup>
    </section>

    <BaseModal v-if="pendingBottle" title="¿Botella completa?" @close="pendingBottle = null">
      <p class="bottle-confirm">
        <strong>{{ pendingBottle.name }} {{ formatMoney(pendingBottle.product.price) }}</strong>
        <template v-if="target"> para {{ target }}</template>
      </p>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="pendingBottle = null">Cancelar</button>
        <button type="button" class="btn btn-primary" @click="confirmBottle">Sí, botella completa</button>
      </template>
    </BaseModal>
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
  min-height: 44px;
  padding: 0 0.8rem;
  border-radius: 999px;
  background: var(--surface);
  border: 1.5px solid var(--bar-line);
  font-weight: 600;
  font-size: 0.88rem;
  white-space: nowrap;
  color: var(--ink-600);
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;

  &--active {
    background: #27445a;
    border-color: #27445a;
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

// ---- Color por categoría (Especificación de color e iconos, 7-nov-2026) ----
// Solo acento: franja, cuadro del icono y punto. Nunca fondo completo.
.catalog {
  --bar-line: #c9d6df;
  --bar-muted: #5f6d77;
  --bar-ink: #1b2b25;
  --bar-price: #7f5c38;
  --bar-navy: #1b3142;
  --bar-bottle-bg: #e6eef4;
  --bar-ok: #3f7a57;
  --bar-ok-bg: #f1f8f3;
  --cat-color: #8a96a0;
  --cat-tint: #eef1f3;
}

.cat-coctel { --cat-color: #1d7a78; --cat-tint: #e4f1f0; }
.cat-licor { --cat-color: #a8742a; --cat-tint: #f5ecdf; }
.cat-vino { --cat-color: #6e2639; --cat-tint: #f3e4e8; }
.cat-cerveza { --cat-color: #55611f; --cat-tint: #ecefdf; }
.cat-sin_alcohol { --cat-color: #3a6ea5; --cat-tint: #e3ecf6; }
.cat-servicio,
.cat-otro { --cat-color: #8a96a0; --cat-tint: #eef1f3; }

.cat-dot {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--cat-color);
}

.chip--active .cat-dot {
  box-shadow: 0 0 0 2px #fff;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.6rem;

  @include tablet {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 0.7rem;
  }
}

.drink {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1.5px solid var(--bar-line);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(27, 49, 66, 0.06);
  overflow: hidden;
  min-height: 168px;
  transition:
    transform 0.12s ease,
    border-color 0.15s ease,
    background 0.2s ease,
    opacity 0.2s ease;

  // Franja superior del color de la categoría, de borde a borde.
  &::before {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 4px;
    background: var(--cat-color);
  }

  &:active:not(.drink--off) {
    transform: scale(0.97);
  }

  @include tablet {
    min-height: 188px;
  }

  &--today {
    border: 2px solid var(--bar-ok);
    background: var(--bar-ok-bg);
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

  &--off {
    --cat-color: #8c99a2;
    --cat-tint: #edf1f4;
    border-style: dashed;
    background: transparent;
    box-shadow: none;

    .product-name {
      color: var(--bar-muted);
    }
  }
}

.today-badge {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  z-index: 1;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: var(--bar-navy);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.product {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  padding: 0.95rem 0.8rem 0.75rem;
  text-align: left;
  background: transparent;
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
  top: 0.6rem;
  right: 0.6rem;
  color: var(--gold-500);
}

// Cuadro tintado de 64 px con el vaso del color de la categoría.
.product-icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-bottom: 0.45rem;
  border-radius: 16px;
  background: var(--cat-tint);
  color: var(--cat-color);
}

.product-name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 16.5px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--bar-ink);
  overflow-wrap: break-word;
}

.product-format {
  font-size: 12px;
  color: var(--bar-muted);
}

.product-price {
  margin-top: auto;
  padding-top: 0.4rem;
  font-size: 17px;
  font-weight: 700;
  color: var(--bar-price);
  font-variant-numeric: tabular-nums;
}

.product-off {
  margin-top: 0.2rem;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  color: #9a3a2e;
}

// Zona «Botella»: botón aparte, pide confirmación.
.bottle {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 46px;
  padding: 0 0.8rem;
  background: var(--bar-bottle-bg);
  color: var(--bar-navy);
  border-top: 1px solid var(--bar-line);
  transition: background 0.15s ease;

  &:hover:not(:disabled) {
    background: #d9e5ee;
  }

  &:disabled {
    opacity: 0.5;
  }

  &--fav {
    background: rgba(159, 107, 60, 0.15);
  }

  svg {
    flex: 0 0 auto;
  }
}

.bottle-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.bottle-price {
  margin-left: auto;
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.bottle-confirm {
  margin: 0;
  font-size: 1.05rem;
  color: var(--ink-900);
}

.group + .group {
  margin-top: 1.3rem;
}

.group-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.6rem;
  font-family: var(--font-serif);
  font-size: 23px;
  font-weight: 400;
  color: var(--ink-900);

  .cat-dot {
    width: 11px;
    height: 11px;
  }
}

.group-count {
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--bar-muted);
  font-variant-numeric: tabular-nums;
}

.review-btn {
  min-height: 44px;
  margin: 0 0.8rem 0.8rem;
  padding: 0 0.6rem;
  border-radius: 9px;
  border: 1.5px solid var(--navy-600);
  font-size: 0.82rem;
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
