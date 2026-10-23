import { computed, ref, shallowRef } from 'vue'
import type { Product } from '@/types'
import { newKey } from '@/utils/format'

export interface CartLine {
  product: Product
  qty: number
  courtesy: boolean
}

/**
 * Comanda en curso. Cada borrador tiene su clave: si el clic de "Registrar"
 * se repite o la red reintenta, el servidor no crea un segundo pedido.
 */
export function usePosCart() {
  const lines = ref<CartLine[]>([])
  const draftKey = shallowRef(newKey())

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
    if (!line) return
    const twin = lines.value.find(
      (l, i) => i !== index && l.product._id === line.product._id && l.courtesy !== line.courtesy,
    )
    if (twin) {
      twin.qty += line.qty
      lines.value.splice(index, 1)
    } else {
      line.courtesy = !line.courtesy
    }
  }

  function clear() {
    lines.value = []
    draftKey.value = newKey()
  }

  return { lines, total, itemCount, draftKey, add, setQty, toggleCourtesy, clear }
}
