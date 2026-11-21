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

/** Entregas o envíos que esperan que el bar confirme lo recibido. */
export function awaitingBar(order: WeeklyOrder): WeeklyOrderDelivery[] {
  return order.deliveries.filter((d) => !d.arrivedAt && (d.kind === 'envio' || d.awaitsBar))
}

/** Reemplaza un pedido en la lista por su versión nueva. */
export function replaceOrder(list: WeeklyOrder[], next: WeeklyOrder): WeeklyOrder[] {
  return list.map((o) => (o._id === next._id ? next : o))
}

export function dayText(iso: string): string {
  return new Date(iso).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TIMEZONE })
}
