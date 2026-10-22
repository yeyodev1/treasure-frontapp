import { http } from './httpBase'
import type {
  AccountSummary,
  Cruise,
  CruiseSales,
  CruiseStockItem,
  LivePulse,
  Order,
  Payment,
  PaymentMethod,
  Product,
  PublicAccount,
  SalesSummary,
  SessionUser,
  StockMovement,
  TeamUser,
  UserRole,
} from '@/types'

// Autenticación
export async function apiLogin(email: string, password: string) {
  const { data } = await http.post<{ token: string; user: SessionUser }>('/auth/login', {
    email,
    password,
  })
  return data
}

export async function apiMe() {
  const { data } = await http.get<{ user: SessionUser }>('/auth/me')
  return data.user
}

// Catálogo
export async function apiProducts(all = false) {
  const { data } = await http.get<{ products: Product[] }>('/products', {
    params: all ? { all: '1' } : {},
  })
  return data.products
}

export async function apiCreateProduct(payload: Record<string, unknown>) {
  const { data } = await http.post<{ product: Product }>('/products', payload)
  return data.product
}

export async function apiUpdateProduct(id: string, payload: Record<string, unknown>) {
  const { data } = await http.patch<{ product: Product }>(`/products/${id}`, payload)
  return data.product
}

export async function apiCreateCustomCocktail(name: string, recipe: Array<{ product: string; qty: number }>) {
  const { data } = await http.post<{ product: Product }>('/products/custom-cocktail', {
    name,
    recipe,
  })
  return data.product
}

// Cruceros
export async function apiCruises() {
  const { data } = await http.get<{ cruises: Cruise[] }>('/cruises')
  return data.cruises
}

export async function apiActiveCruise() {
  const { data } = await http.get<{ cruise: Cruise | null }>('/cruises/active')
  return data.cruise
}

export async function apiCreateCruise(payload: { name: string; startDate: string; cabinCount?: number; notes?: string }) {
  const { data } = await http.post<{ cruise: Cruise }>('/cruises', payload)
  return data.cruise
}

export async function apiUpdateCruise(id: string, payload: Record<string, unknown>) {
  const { data } = await http.patch<{ cruise: Cruise }>(`/cruises/${id}`, payload)
  return data.cruise
}

export async function apiUpdateCabin(cruiseId: string, cabinNumber: number, payload: Record<string, unknown>) {
  const { data } = await http.patch(`/cruises/${cruiseId}/cabins/${cabinNumber}`, payload)
  return data.cabin
}

export async function apiLoadStock(cruiseId: string, items: Array<{ productId: string; qty: number }>, fromWarehouse = true) {
  const { data } = await http.post<{ stock: CruiseStockItem[] }>(`/cruises/${cruiseId}/load-stock`, {
    items,
    fromWarehouse,
  })
  return data.stock
}

// Comandas
export async function apiCreateOrder(payload: {
  cruiseId: string
  cabinNumber: number
  items: Array<{ productId: string; qty: number; courtesy?: boolean }>
}) {
  const { data } = await http.post<{ order: Order }>('/orders', payload)
  return data.order
}

export async function apiOrders(params: {
  cruiseId?: string
  cabinNumber?: number
  status?: string
  before?: string
  limit?: number
}) {
  const { data } = await http.get<{ orders: Order[]; hasMore: boolean }>('/orders', { params })
  return data
}

export async function apiCancelOrder(id: string, reason: string) {
  const { data } = await http.post<{ order: Order }>(`/orders/${id}/cancel`, { reason })
  return data.order
}

export async function apiCabinAccount(cruiseId: string, cabinNumber: number) {
  const { data } = await http.get<{ account: AccountSummary }>(`/accounts/${cruiseId}/${cabinNumber}`)
  return data.account
}

// Cobros
export async function apiCollectCabin(payload: {
  cruiseId: string
  cabinNumber: number
  method: PaymentMethod
  cashConfirmed?: boolean
  billing: { name: string; idNumber: string; email?: string; country?: string }
}) {
  const { data } = await http.post<{ payment: Payment }>('/payments/collect', payload)
  return data.payment
}

export async function apiPayments(
  params: { cruiseId?: string; from?: string; to?: string; before?: string; limit?: number } = {},
) {
  const { data } = await http.get<{ payments: Payment[]; hasMore: boolean }>('/payments', {
    params,
  })
  return data
}

export async function apiRetryInvoice(id: string) {
  const { data } = await http.post<{ payment: Payment }>(`/payments/${id}/retry-invoice`)
  return data.payment
}

// Inventario
export async function apiCruiseStock(cruiseId: string) {
  const { data } = await http.get<{ stock: CruiseStockItem[] }>(`/inventory/cruise/${cruiseId}`)
  return data.stock
}

export async function apiRegisterWaste(payload: { cruiseId: string; productId: string; qty: number; reason: string }) {
  await http.post('/inventory/waste', payload)
}

export async function apiAdjustStock(payload: { cruiseId: string; productId: string; qty: number; reason: string }) {
  await http.post('/inventory/adjust', payload)
}

export async function apiWarehousePurchase(items: Array<{ productId: string; qty: number }>) {
  await http.post('/inventory/warehouse-purchase', { items })
}

export async function apiMovements(
  params: { cruiseId?: string; productId?: string; type?: string; before?: string; limit?: number } = {},
) {
  const { data } = await http.get<{ movements: StockMovement[]; hasMore: boolean }>(
    '/inventory/movements',
    { params },
  )
  return data
}

// Pulso en vivo (admin y dirección)
export async function apiLive(since?: string) {
  const { data } = await http.get<LivePulse>('/live', { params: since ? { since } : {} })
  return data
}

// Reportes
export async function apiSalesSummary(params: { cruiseId?: string; from?: string; to?: string } = {}) {
  const { data } = await http.get<SalesSummary>('/reports/sales', { params })
  return data
}

export async function apiSalesByCruise() {
  const { data } = await http.get<{ cruises: CruiseSales[] }>('/reports/by-cruise')
  return data.cruises
}

// Usuarios
export async function apiUsers() {
  const { data } = await http.get<{ users: TeamUser[] }>('/users')
  return data.users
}

export async function apiCreateUser(payload: { name: string; email: string; password: string; role: UserRole }) {
  const { data } = await http.post('/users', payload)
  return data.user
}

export async function apiUpdateUser(id: string, payload: Record<string, unknown>) {
  const { data } = await http.patch(`/users/${id}`, payload)
  return data.user
}

// Pública (pasajero)
export async function apiPublicAccount(token: string) {
  const { data } = await http.get<PublicAccount>(`/public/account/${token}`)
  return data
}
