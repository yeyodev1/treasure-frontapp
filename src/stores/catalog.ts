import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { Product, ProductCategory, WineStyle } from '@/types'
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

/** Lo que se puede vender en el bar (las botellas-insumo no aparecen). */
export function isSellable(p: Product): boolean {
  return p.active && (p.kind !== 'fisico' || p.sellable)
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
