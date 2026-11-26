import { shallowRef } from 'vue'
import { apiCruises } from '@/services/api'
import type { Cruise } from '@/types'

/**
 * Cómo se ve un crucero en toda la app (pedido de Gerencia, 26-nov-2026): siempre con
 * el color de su tipo (A, B, C) y de dónde a dónde va, para identificarlo de un vistazo.
 */
export const LEG_COLORS: Record<string, { bg: string; fg: string }> = {
  A: { bg: '#0f766e', fg: '#ffffff' },
  B: { bg: '#b45309', fg: '#ffffff' },
  C: { bg: '#6d28d9', fg: '#ffffff' },
}
const OTHER = { bg: '#475569', fg: '#ffffff' }

export const legOf = (code: string) => (code || '').charAt(0).toUpperCase()
export const legColor = (code: string) => LEG_COLORS[legOf(code)] ?? OTHER
/** Para `:style`: fondo y texto del color del tipo de crucero. */
export const legStyle = (code: string) => ({ background: legColor(code).bg, color: legColor(code).fg, borderColor: legColor(code).bg })

type CruiseLite = Pick<Cruise, 'code' | 'routeFrom' | 'routeTo' | 'startDate' | 'endDate'>
const byCode = shallowRef(new Map<string, CruiseLite>())
let loading: Promise<void> | null = null

/** Carga una vez la lista de cruceros (ruta y fechas por código). */
export function loadCruiseLook() {
  loading ??= apiCruises()
    .then((list) => {
      byCode.value = new Map(list.map((c) => [c.code, c]))
    })
    .catch(() => {
      loading = null
    })
  return loading
}

const shortDay = (iso: string) => {
  const d = new Date(iso)
  return { d: d.toLocaleDateString('es-EC', { day: 'numeric', timeZone: 'Pacific/Galapagos' }), m: d.toLocaleDateString('es-EC', { month: 'short', timeZone: 'Pacific/Galapagos' }).replace('.', '') }
}

/** «San Cristóbal → Baltra · 14–20 nov» (vacío si el crucero no está en la lista). */
export function cruiseRouteText(code: string) {
  const c = byCode.value.get(code)
  if (!c) return ''
  const route = c.routeFrom ? `${c.routeFrom} → ${c.routeTo}` : ''
  const a = shortDay(c.startDate)
  const b = c.endDate ? shortDay(c.endDate) : null
  const dates = !b ? `${a.d} ${a.m}` : a.m === b.m ? `${a.d}–${b.d} ${b.m}` : `${a.d} ${a.m}–${b.d} ${b.m}`
  return [route, dates].filter(Boolean).join(' · ')
}
