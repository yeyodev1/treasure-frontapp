import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { Product, ProductCategory } from '@/types'
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

  return { products, sellable, physical, loaded, load, upsert }
})
