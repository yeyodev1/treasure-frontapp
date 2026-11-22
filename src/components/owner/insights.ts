import { apiCruiseCalendar, apiShipStops, type CruiseCalendarRow, type ShipStopRow } from '@/services/api'
import { TIMEZONE, dayKeyOf } from '@/utils/format'

/**
 * Datos compartidos del Resumen por pestañas (pedido del cliente, 21-nov-2026):
 * cada crucero es la unidad de información y cada año la de evaluación.
 */

export const STATUS_LABEL: Record<CruiseCalendarRow['status'], string> = {
  planificado: 'Programado',
  abordo: 'En curso',
  cerrado: 'Finalizado',
}

export const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

let cache: Promise<{ rows: CruiseCalendarRow[]; stops: ShipStopRow[] }> | null = null

/** Cruceros y paras/dique, una sola carga por visita al Resumen. */
export function loadCalendar(fresh = false) {
  if (!cache || fresh) {
    cache = Promise.all([apiCruiseCalendar(), apiShipStops()]).then(([rows, stops]) => ({ rows, stops }))
    cache.catch(() => (cache = null))
  }
  return cache
}

export const dayKey = dayKeyOf
/** Días entre dos AAAA-MM-DD, ambos incluidos. */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1

export function addDays(key: string, n: number) {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(d.length === 10 ? `${d}T12:00:00-06:00` : d).toLocaleDateString('es-EC', { ...opts, timeZone: TIMEZONE })

export function monthTitle(month: string) {
  const label = fmt(`${month}-15`, { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export const cruiseStart = (c: CruiseCalendarRow) => dayKey(c.startDate)
export const cruiseEnd = (c: CruiseCalendarRow) => dayKey(c.endDate ?? c.startDate)

/** Tipo del crucero: el código empieza con la letra del tramo («C-003» es tipo C). */
export const legOf = (c: CruiseCalendarRow) => (c.code.charAt(0) || c.leg || '?').toUpperCase()

export function cruiseRange(c: CruiseCalendarRow) {
  const start = fmt(c.startDate, { day: 'numeric', month: 'short' })
  return c.endDate ? `${start} – ${fmt(c.endDate, { day: 'numeric', month: 'short' })}` : start
}

export function stopRange(s: ShipStopRow) {
  const from = dayKey(s.from)
  const to = dayKey(s.to)
  const days = daysBetween(from, to)
  const end = fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })
  return `${days === 1 ? end : `${fmt(from, { day: 'numeric', month: 'short' })} – ${end}`} · ${days} ${days === 1 ? 'día' : 'días'}`
}

/**
 * En qué crucero cayó la para o el dique: el que se cruza con esas fechas o,
 * si el barco estaba entre salidas, el anterior y el siguiente.
 */
export function stopCruise(s: ShipStopRow, rows: CruiseCalendarRow[]) {
  const from = dayKey(s.from)
  const to = dayKey(s.to)
  const during = rows.filter((c) => cruiseStart(c) <= to && cruiseEnd(c) >= from)
  if (during.length) return `Durante ${during.map((c) => `el crucero ${c.code}`).join(' y ')}`
  const sorted = [...rows].sort((a, b) => cruiseStart(a).localeCompare(cruiseStart(b)))
  const before = sorted.filter((c) => cruiseEnd(c) < from).at(-1)
  const after = sorted.find((c) => cruiseStart(c) > to)
  if (before && after) return `Entre el crucero ${before.code} y el ${after.code}`
  if (before) return `Después del crucero ${before.code}`
  if (after) return `Antes del crucero ${after.code}`
  return 'Sin cruceros registrados cerca'
}

/** Países sumados de varios cruceros, de mayor a menor. */
export function countriesOf(rows: CruiseCalendarRow[]) {
  const m = new Map<string, number>()
  for (const c of rows) for (const k of c.countries) m.set(k.country, (m.get(k.country) ?? 0) + k.count)
  return [...m].map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count)
}

/** Las primeras `n` filas y el resto sumado en «Otros». */
export function topWithOthers<T extends { label: string; value: number }>(list: T[], n: number) {
  if (list.length <= n + 1) return list
  const rest = list.slice(n)
  return [
    ...list.slice(0, n),
    {
      label: `Otros ${rest.length}`,
      value: rest.reduce((s, x) => s + x.value, 0),
    },
  ]
}
