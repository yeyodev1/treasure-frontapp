import { computed, ref } from 'vue'
import type { Product } from '@/types'

export interface CartLine {
  product: Product
  qty: number
  courtesy: boolean
}

/** Estado de la comanda en curso: líneas, totales y mutaciones. */
export function usePosCart() {
  const lines = ref<CartLine[]>([])

  const total = computed(() =>
    lines.value.reduce((sum, l) => sum + (l.courtesy ? 0 : l.qty * l.product.price), 0),
  )
  const itemCount = computed(() => lines.value.reduce((sum, l) => sum + l.qty, 0))

  function add(product: Product) {
    const line = lines.value.find((l) => l.product._id === product._id && !l.courtesy)
    if (line) line.qty++
    else lines.value.push({ product, qty: 1, courtesy: false })
  }

  function setQty(index: number, qty: number) {
    if (qty <= 0) lines.value.splice(index, 1)
    else lines.value[index]!.qty = qty
  }

  function toggleCourtesy(index: number) {
    const line = lines.value[index]
    if (line) line.courtesy = !line.courtesy
  }

  function clear() {
    lines.value = []
  }

  return { lines, total, itemCount, add, setQty, toggleCourtesy, clear }
}
