import axios from 'axios'
import { formatNumber, unitShort } from '@/utils/format'
import type { PurchaseStatus, RequisitionLine, RequisitionStatus, StockUnit } from '@/types'

/** Lo mínimo para convertir envases ↔ unidad base. */
export interface UnitInfo {
  stockUnit: StockUnit | string
  containerSize: number
  containerLabel: string
}

export type QtyMode = 'envase' | 'base'

/** Tiene envase de más de una unidad base (botella de 750 ml, lata de 355 ml…). */
export function hasContainer(p: UnitInfo): boolean {
  return (p.containerSize || 1) > 1
}

/** "botella" → "botellas", "botella mini" → "botellas mini", "unidad" → "unidades". */
export function plural(label: string, n: number): string {
  if (!label) return ''
  if (Math.abs(n) === 1) return label
  const [first, ...rest] = label.split(' ')
  const word = first ?? label
  const pluralWord = /[aeiouáéó]$/i.test(word) ? `${word}s` : `${word}es`
  return [pluralWord, ...rest].join(' ')
}

/** 2 → "2 botellas". */
export function containerText(n: number, p: UnitInfo): string {
  return `${formatNumber(n)} ${plural(p.containerLabel || 'unidad', n)}`
}

/** 1500 → "1.500 ml". */
export function baseText(qty: number, unit: string): string {
  return `${formatNumber(qty)} ${unitShort(unit)}`
}

/** Cantidad legible en la unidad elegida. */
export function qtyText(qty: number, mode: QtyMode, p: UnitInfo): string {
  if (mode === 'envase' && hasContainer(p)) return containerText(qty, p)
  if (mode === 'envase') return containerText(qty, p)
  return baseText(qty, p.stockUnit)
}

/** Unidad base → texto con su equivalente en envases: "1.500 ml · 2 botellas". */
export function stockText(qty: number, p: UnitInfo): string {
  if (!hasContainer(p)) return containerText(qty, p)
  const n = Math.round((qty / p.containerSize) * 10) / 10
  return `${containerText(n, p)} · ${baseText(qty, p.stockUnit)}`
}

/** "2 botellas = 1.500 ml" (sin conversión si el envase es de una unidad). */
export function conversionText(n: number, p: UnitInfo): string {
  if (!hasContainer(p)) return containerText(n, p)
  return `${containerText(n, p)} = ${baseText(n * p.containerSize, p.stockUnit)}`
}

export function toBase(qty: number, mode: QtyMode, p: UnitInfo): number {
  const value = mode === 'envase' ? qty * (p.containerSize || 1) : qty
  return Math.round(value * 100) / 100
}

export function toContainers(base: number, p: UnitInfo): number {
  return Math.round((base / (p.containerSize || 1)) * 100) / 100
}

const precise = new Intl.NumberFormat('es-EC', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

/** Costos chicos por ml necesitan más de dos decimales. */
export function preciseMoney(value: number): string {
  return precise.format(value)
}

/** "$19,50 por botella · $0,026 por ml". */
export function costText(costPerUnit: number | undefined, p: UnitInfo): string {
  if (!costPerUnit || costPerUnit <= 0) return ''
  if (!hasContainer(p)) return `${preciseMoney(costPerUnit)} por ${p.containerLabel || 'unidad'}`
  return `${preciseMoney(costPerUnit * p.containerSize)} por ${p.containerLabel} · ${preciseMoney(costPerUnit)} por ${unitShort(p.stockUnit)}`
}

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export const PURCHASE_STATUS: Record<PurchaseStatus, string> = {
  registrada: 'Registrada',
  recibida_parcial: 'Recibida parcial',
  recibida: 'Recibida',
  anulada: 'Anulada',
  cerrada: 'Cerrada con faltante',
}

export const REQUISITION_STATUS: Record<RequisitionStatus, string> = {
  solicitado: 'Solicitada',
  aprobado: 'Aprobada',
  rechazado: 'Rechazada',
  recibido_parcial: 'Recibida parcial',
  recibido: 'Recibida',
  atendido: 'Atendida',
}

export const LOCATION_LABEL = { bodega: 'Bodega', abordo: 'A bordo' } as const

/** Falta de stock que devuelve el servidor (409 · sin_stock). */
export interface NoStockError {
  productId: string
  name: string
  location: string
  message: string
}

export function noStockError(err: unknown): NoStockError | null {
  if (!axios.isAxiosError(err) || err.response?.status !== 409) return null
  const data = err.response.data as Partial<NoStockError> & { code?: string }
  if (data?.code !== 'sin_stock') return null
  return {
    productId: data.productId ?? '',
    name: data.name ?? '',
    location: data.location ?? 'bodega',
    message: (data as { message?: string }).message ?? 'No hay stock suficiente',
  }
}

/** Nombre de quien hizo algo (puede venir poblado o como id). */
export function personName(value: { name: string } | string | null | undefined): string {
  if (!value) return ''
  return typeof value === 'string' ? '' : value.name
}

/** Línea de requerimiento → datos de unidad del producto (poblado o no). */
export function requisitionUnit(line: RequisitionLine): UnitInfo & { warehouseStock?: number; onboardStock?: number; icon?: string; _id?: string } {
  if (typeof line.product === 'string') return { stockUnit: 'unidad', containerSize: 1, containerLabel: 'unidad', _id: line.product }
  return line.product
}

/** "falta 1 botella" / "faltan 2 botellas". */
export function missingText(text: string, n: number): string {
  return `${Math.abs(n) === 1 ? 'falta' : 'faltan'} ${text}`
}
