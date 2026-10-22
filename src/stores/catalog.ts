import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { Product, ProductCategory } from '@/types'
import { apiProducts } from '@/services/api'

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  cerveza: 'Cervezas',
  vino: 'Vinos',
  licor: 'Licores',
  coctel: 'Cócteles',
  gaseosa: 'Gaseosas',
  agua: 'Aguas',
  jugo: 'Jugos',
  snack: 'Snacks',
  otro: 'Otros',
}

export const useCatalogStore = defineStore('catalog', () => {
  const products = ref<Product[]>([])
  const loaded = shallowRef(false)

  const byCategory = computed(() => {
    const groups = new Map<ProductCategory, Product[]>()
    for (const product of products.value) {
      const list = groups.get(product.category) ?? []
      list.push(product)
      groups.set(product.category, list)
    }
    return groups
  })

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

  return { products, loaded, byCategory, load, upsert }
})
