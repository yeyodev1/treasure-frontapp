const money = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' })

export function formatMoney(value: number): string {
  return money.format(value)
}

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString('es-EC', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
