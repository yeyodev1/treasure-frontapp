import type { PaymentMethod } from '@/types'
import type { CollectLine } from '@/services/api'

/**
 * Formas de pago de un cobro (pedido del cliente, 31-oct-2026: "a veces
 * pagan 10 dólares en efectivo y lo demás con tarjeta"). La última forma
 * cubre lo que falta salvo que se escriba su monto.
 */
export interface PayLine {
  key: number
  method: PaymentMethod
  /** Texto del monto; vacío en la última = lo que falta. */
  amount: string
  reference: string
  cashConfirmed: boolean
}

export const METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string; icon: string }> = [
  { value: 'efectivo', label: 'Efectivo', icon: 'fa-money-bill-wave' },
  { value: 'tarjeta', label: 'Tarjeta', icon: 'fa-credit-card' },
  { value: 'transferencia', label: 'Transferencia', icon: 'fa-building-columns' },
  { value: 'online', label: 'Pago en línea', icon: 'fa-globe' },
]

let seq = 0
export function newLine(method: PaymentMethod = 'efectivo'): PayLine {
  return { key: ++seq, method, amount: '', reference: '', cashConfirmed: false }
}

const cents = (v: number) => Math.round(v * 100)

export function parseMoney(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const v = Number(t.replace(',', '.'))
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN
}

export interface LinesState {
  /** Monto de cada forma (la última vacía = lo que falta). */
  amounts: number[]
  total: number
  /** Queda saldo después de este cobro (solo si se permite parcial). */
  partial: boolean
  error: string
  valid: boolean
}

export function linesState(lines: PayLine[], target: number, allowPartial: boolean): LinesState {
  const parsed = lines.map((l) => parseMoney(l.amount))
  const lastOpen = parsed[parsed.length - 1] === null
  const fixed = parsed.slice(0, lastOpen ? -1 : undefined).reduce<number>((s, v) => s + (v ?? 0), 0)
  const amounts = parsed.map((v, i) => (i === parsed.length - 1 && v === null ? Math.round((target - fixed) * 100) / 100 : (v ?? 0)))
  const total = Math.round(amounts.reduce((s, v) => s + v, 0) * 100) / 100
  let error = ''
  if (parsed.some((v, i) => Number.isNaN(v) || (v === null && i < parsed.length - 1))) {
    error = 'Escribe el monto de cada forma de pago (la última puede ir vacía: cubre lo que falta).'
  } else if (amounts.some((v) => cents(v) <= 0)) {
    error = 'Cada forma de pago debe ser mayor que cero.'
  } else if (cents(total) > cents(target)) {
    error = `Suma más de lo que se cobra ($${target.toFixed(2).replace('.', ',')}).`
  } else if (!allowPartial && cents(total) !== cents(target)) {
    error = `Las formas de pago deben sumar $${target.toFixed(2).replace('.', ',')}.`
  } else {
    const missingRef = lines.find((l) => l.method === 'transferencia' && !l.reference.trim())
    const missingCash = lines.find((l) => l.method === 'efectivo' && !l.cashConfirmed)
    if (missingRef) error = 'Indica la referencia de la transferencia.'
    else if (missingCash) error = 'Confirma que el efectivo ingresó a caja.'
  }
  return { amounts, total, partial: cents(total) < cents(target), error, valid: !error }
}

export function toPayload(lines: PayLine[], state: LinesState): CollectLine[] {
  return lines.map((l, i) => ({
    method: l.method,
    amount: state.amounts[i],
    reference: l.reference.trim() || undefined,
    cashConfirmed: l.method === 'efectivo' ? l.cashConfirmed : undefined,
  }))
}

export function methodsLabel(lines: PayLine[], state: LinesState, money: (v: number) => string): string {
  return lines
    .map((l, i) => `${METHOD_OPTIONS.find((m) => m.value === l.method)?.label ?? l.method}${lines.length > 1 ? ` ${money(state.amounts[i] ?? 0)}` : ''}`)
    .join(' + ')
}

/**
 * Quién paga: los mismos datos que se llenan al registrar pasajeros en el
 * zarpe (nombre, cédula o pasaporte, país y correo).
 */
export interface Billing {
  passengerId: string
  name: string
  idNumber: string
  email: string
  country: string
}

export function emptyBilling(): Billing {
  return { passengerId: '', name: '', idNumber: '', email: '', country: '' }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

export function billingError(b: Billing): string {
  if (!b.name.trim()) return 'Falta el nombre para la factura.'
  if (!b.idNumber.trim()) return 'Falta la cédula, pasaporte o RUC para la factura.'
  if (b.email.trim() && !EMAIL_RE.test(b.email.trim())) return 'Revisa el correo. Ejemplo: nombre@dominio.com.'
  return ''
}

