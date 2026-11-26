import { apiWeeklyOrder, apiWeeklyOrderCurrent } from '@/services/api'
import type { WeeklyOrder, WeeklyOrderCurrent, WeeklyOrderDelivery } from '@/types'
import { TIMEZONE } from '@/utils/format'

/** Pedidos que todavía piden algo a alguien (por revisar, por atender, en camino o por recibir). */
const OPEN_PHASES = new Set(['bar', 'directora', 'atender', 'en_curso'])

/** El pedido de la semana y los anteriores abiertos, completos (con líneas y entregas). */
export async function loadOpenOrders(): Promise<{ current: WeeklyOrderCurrent; orders: WeeklyOrder[] }> {
  const current = await apiWeeklyOrderCurrent()
  const others = current.others.filter((o) => OPEN_PHASES.has(o.phase) || o.toReceive)
  const full = await Promise.all(others.map((o) => apiWeeklyOrder(o._id)))
  return { current, orders: [...(current.order ? [current.order] : []), ...full] }
}

/** Entregas o envíos que esperan que el bar confirme lo recibido (sin las que ya recibió y esperan a la directora). */
export function awaitingBar(order: WeeklyOrder): WeeklyOrderDelivery[] {
  return order.deliveries.filter((d) => !d.arrivedAt && !d.needsDirector && (d.kind === 'envio' || d.awaitsBar))
}

/** Recepciones que el mismo bartender compró y recibió: confirma además la directora (Bar-stock, 24-nov-2026). */
export function awaitingDirector(order: WeeklyOrder): WeeklyOrderDelivery[] {
  return order.deliveries.filter((d) => !d.arrivedAt && d.needsDirector)
}

/** Horas desde el envío sin que el bar confirme (a las 24 h le llega a Gerencia). */
export function hoursWaiting(d: WeeklyOrderDelivery, now = Date.now()): number {
  return Math.floor((now - new Date(d.at).getTime()) / 3_600_000)
}

/** Reemplaza un pedido en la lista por su versión nueva. */
export function replaceOrder(list: WeeklyOrder[], next: WeeklyOrder): WeeklyOrder[] {
  return list.map((o) => (o._id === next._id ? next : o))
}

export function dayText(iso: string): string {
  return new Date(iso).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TIMEZONE })
}

/**
 * Categorías del pedido y la compra, en el orden del bar (Bar-stock, 24-nov-2026):
 * licores, vinos, cervezas, gaseosas, insumos y frescos.
 */
export const ORDER_GROUPS = [
  { key: 'licor', label: 'Licores' },
  { key: 'vino', label: 'Vinos' },
  { key: 'cerveza', label: 'Cervezas' },
  { key: 'gaseosa', label: 'Gaseosas y agua' },
  { key: 'insumo', label: 'Insumos' },
  { key: 'fresco', label: 'Frescos' },
] as const
export type OrderGroup = (typeof ORDER_GROUPS)[number]['key']

const FRESH_UNITS = new Set(['ramita', 'rodaja', 'cucharadita', 'cucharada', 'gota', 'golpe', 'porción'])
export function orderGroupOf(category: string | undefined, stockUnit: string, name: string): OrderGroup {
  if (FRESH_UNITS.has(stockUnit) || /clara de huevo|\(fruta\)/i.test(name)) return 'fresco'
  const cat = category ?? 'insumo'
  if (cat === 'licor' || (/\(botella\)/i.test(name) && cat === 'insumo')) return 'licor'
  if (cat === 'agua' || /^soda\b/i.test(name)) return 'gaseosa'
  return cat === 'vino' || cat === 'cerveza' || cat === 'gaseosa' ? cat : 'insumo'
}

/** Agrupa por categoría; dentro, el orden de la repisa (countOrder) y luego el nombre. */
export function groupByCategory<T extends { name: string; group: OrderGroup; shelf?: number }>(items: T[]) {
  return ORDER_GROUPS.map((g) => ({
    ...g,
    items: items.filter((i) => i.group === g.key).sort((a, b) => (a.shelf ?? 9999) - (b.shelf ?? 9999) || a.name.localeCompare(b.name, 'es')),
  })).filter((g) => g.items.length)
}
