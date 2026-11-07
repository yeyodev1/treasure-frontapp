import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { Product, ProductCategory, ServingIconKind, WineStyle } from '@/types'
import { apiProducts } from '@/services/api'

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  coctel: 'Cócteles',
  licor: 'Licores',
  vino: 'Vinos',
  cerveza: 'Cervezas',
  gaseosa: 'Gaseosas',
  agua: 'Aguas',
  jugo: 'Jugos',
  snack: 'Snacks',
  insumo: 'Insumos',
  servicio: 'Servicios',
  otro: 'Otros',
}

export const WINE_STYLE_LABELS: Record<WineStyle, string> = {
  tinto: 'Tinto',
  blanco: 'Blanco',
  rosado: 'Rosado',
  espumante: 'Espumante',
}

/**
 * Cómo se sirve una bebida de la carta (pedido del cliente, 31-oct-2026):
 * licores por trago o botella; vinos por copa, botella o botella pequeña.
 * Se deduce del producto: la receta es el trago o la copa; el físico es la
 * botella cerrada, pequeña si trae menos de 750 ml.
 */
export type DrinkFormat = 'trago' | 'copa' | 'botella' | 'botella_pequena'

export const DRINK_FORMAT_LABELS: Record<DrinkFormat, string> = {
  trago: 'Trago',
  copa: 'Copa',
  botella: 'Botella',
  botella_pequena: 'Botella pequeña',
}

const FULL_BOTTLE_ML = 750

export function drinkFormat(p: Product): DrinkFormat | null {
  if (p.category === 'licor') return p.kind === 'receta' ? 'trago' : p.kind === 'fisico' ? 'botella' : null
  if (p.category === 'vino') {
    if (p.kind === 'receta') return 'copa'
    if (p.kind !== 'fisico') return null
    return p.stockUnit === 'ml' && p.containerSize > 0 && p.containerSize < FULL_BOTTLE_ML ? 'botella_pequena' : 'botella'
  }
  return null
}

/** Nombre del icono en el Catálogo y formato bajo el nombre en el Bar. */
export const SERVING_ICON_LABELS: Record<ServingIconKind, string> = {
  martini: 'Copa de cóctel',
  alto: 'Vaso alto',
  corto: 'Vaso corto',
  copa: 'Copa',
  flauta: 'Espumante',
  botvino: 'Botella de vino',
  botlicor: 'Botella de licor',
  mini: 'Botella pequeña',
  cerveza: 'Cerveza',
  lata: 'Lata',
  agua: 'Agua',
  descorche: 'Descorche',
}

const MARTINI = ['classic margarita', 'cosmopolitan', 'daiquiri', 'manhattan', 'martini']
const CORTO = ['caipirinha', 'negroni', 'new york sour', 'old fashioned', 'pisco sour']

/**
 * Icono del Bar: el elegido en el Catálogo o la regla por categoría de la
 * especificación (sección 6). null = sin icono de vaso (snacks, otros).
 */
export function servingIconOf(p: Product): ServingIconKind | null {
  if (p.servingIcon) return p.servingIcon
  const name = p.name.toLowerCase()
  switch (p.category) {
    case 'coctel':
      return MARTINI.includes(name) ? 'martini' : CORTO.includes(name) ? 'corto' : 'alto'
    case 'licor':
      return drinkFormat(p) === 'botella' ? 'botlicor' : 'corto'
    case 'vino': {
      const format = drinkFormat(p)
      if (format === 'copa') return 'copa'
      if (format === 'botella_pequena') return 'mini'
      return p.wineStyle === 'espumante' ? 'flauta' : 'botvino'
    }
    case 'cerveza':
      return 'cerveza'
    case 'gaseosa':
      return 'lata'
    case 'agua':
      return 'agua'
    case 'jugo':
      return 'alto'
    case 'servicio':
      return 'descorche'
    default:
      return null
  }
}

/** Grupo de color del Bar: las bebidas sin alcohol comparten uno. */
export type BarGroup = 'coctel' | 'licor' | 'vino' | 'cerveza' | 'sin_alcohol' | 'servicio' | 'otro'
export const BAR_GROUP_LABELS: Record<BarGroup, string> = {
  coctel: 'Cócteles',
  licor: 'Licores',
  vino: 'Vinos',
  cerveza: 'Cervezas',
  sin_alcohol: 'Sin alcohol',
  servicio: 'Servicios',
  otro: 'Otros',
}

export function barGroupOf(p: Product): BarGroup {
  if (['gaseosa', 'agua', 'jugo', 'snack'].includes(p.category)) return 'sin_alcohol'
  if (p.category === 'coctel' || p.category === 'licor' || p.category === 'vino' || p.category === 'cerveza') return p.category
  return p.category === 'servicio' ? 'servicio' : 'otro'
}

/** Lo que se puede vender en el bar (las botellas-insumo no aparecen; los wetsuits van en su pestaña). */
export function isSellable(p: Product): boolean {
  return p.active && (p.kind !== 'fisico' || p.sellable) && !p.legs?.length
}

export const useCatalogStore = defineStore('catalog', () => {
  const products = ref<Product[]>([])
  const loaded = shallowRef(false)

  const sellable = computed(() => products.value.filter(isSellable))
  const physical = computed(() => products.value.filter((p) => p.kind === 'fisico' && p.active))

  async function load(force = false) {
    if (loaded.value && !force) return
    products.value = await apiProducts()
    loaded.value = true
  }

  function upsert(product: Product) {
    const idx = products.value.findIndex((p) => p._id === product._id)
    if (idx >= 0) products.value[idx] = product
    else products.value.push(product)
  }

  function remove(id: string) {
    products.value = products.value.filter((p) => p._id !== id)
  }

  return { products, sellable, physical, loaded, load, upsert, remove }
})
