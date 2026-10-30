/**
 * Hora local de Galápagos (UTC−6): el barco opera allí. Cuenta, bitácora,
 * filtros y gráficos usan la misma fecha (checklist 29-oct, 04).
 */
export const TIMEZONE = 'America/Galapagos'

const money = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' })
const number = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 })
const containers = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 1 })

export function formatMoney(value: number): string {
  return money.format(value)
}

export function formatNumber(value: number): string {
  return number.format(value)
}

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: TIMEZONE,
  })
}

export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString('es-EC', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIMEZONE,
  })
}

export function formatTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString('es-EC', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: TIMEZONE,
  })
}

/** 'YYYY-MM-DD' de hoy en Galápagos. */
export function todayKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE })
}

/** 'YYYY-MM-DD' (día ya agrupado en Galápagos) → "29 oct 2026", sin correrse de día. */
export function formatDayKey(dateKey: string): string {
  return formatDate(`${dateKey}T12:00:00-06:00`)
}

/** 'YYYY-MM-DD' → "jueves 23 de octubre de 2026". */
export function formatLongDate(dateKey: string): string {
  const text = new Date(`${dateKey}T12:00:00-06:00`).toLocaleDateString('es-EC', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TIMEZONE,
  })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const UNIT_SHORT: Record<string, string> = {
  ml: 'ml',
  unidad: 'u',
  g: 'g',
  cucharadita: 'cdta',
  cucharada: 'cda',
  ramita: 'ramita',
  rodaja: 'rodaja',
  gota: 'gota',
  golpe: 'golpe',
  porción: 'porción',
}

export function unitShort(unit: string): string {
  return UNIT_SHORT[unit] ?? unit
}

/**
 * Cantidad en unidad base y, si aplica, su equivalente en envases:
 * 1440 ml de una botella de 750 → "1.440 ml · 1,9 botellas".
 */
export function formatStock(
  qty: number,
  unit: string,
  containerSize: number,
  containerLabel: string,
): string {
  const base = `${formatNumber(qty)} ${unitShort(unit)}`
  if (!containerSize || containerSize <= 1) return base
  const n = qty / containerSize
  const label = Math.abs(n) === 1 ? containerLabel : `${containerLabel}s`
  return `${base} · ${containers.format(n)} ${label}`
}

/** Clave única por acción del usuario (evita duplicar al repetir el clic). */
export function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
