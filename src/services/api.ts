import { http } from './httpBase'
import type {
  AccountSummary,
  CabinAccountRow,
  Cruise,
  CruiseSales,
  CycleSettings,
  LivePulse,
  Order,
  Passenger,
  Payment,
  PaymentMethod,
  Product,
  PublicAccount,
  SalesSummary,
  SessionUser,
  StockCount,
  StockItem,
  StockLocation,
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
export async function apiProducts(options: { all?: boolean; kind?: string } = {}) {
  const { data } = await http.get<{ products: Product[] }>('/products', {
    params: { ...(options.all ? { all: '1' } : {}), ...(options.kind ? { kind: options.kind } : {}) },
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

export async function apiCreateCustomCocktail(
  name: string,
  recipe: Array<{ product: string; qty: number }>,
) {
  const { data } = await http.post<{ product: Product }>('/products/custom-cocktail', {
    name,
    recipe,
  })
  return data.product
}

// Salidas y pasajeros
export async function apiCruises(status?: string) {
  const { data } = await http.get<{ cruises: Cruise[] }>('/cruises', {
    params: status ? { status } : {},
  })
  return data.cruises
}

export async function apiActiveCruise() {
  const { data } = await http.get<{ cruise: Cruise | null }>('/cruises/active')
  return data.cruise
}

export async function apiCycleSettings() {
  const { data } = await http.get<{ settings: CycleSettings }>('/cruises/cycle-settings')
  return data.settings
}

export async function apiUpdateCycleSettings(payload: Partial<CycleSettings>) {
  const { data } = await http.put<{ settings: CycleSettings }>('/cruises/cycle-settings', payload)
  return data.settings
}

export async function apiGenerateCycle(startDate: string, until: string) {
  const { data } = await http.post<{ created: string[]; skipped: number }>('/cruises/generate', {
    startDate,
    until,
  })
  return data
}

export async function apiUpdateCruise(id: string, payload: Record<string, unknown>) {
  const { data } = await http.patch<{ cruise: Cruise }>(`/cruises/${id}`, payload)
  return data.cruise
}

export async function apiUpdatePassengers(
  cruiseId: string,
  cabinNumber: number,
  passengers: Passenger[],
) {
  const { data } = await http.put(`/cruises/${cruiseId}/cabins/${cabinNumber}/passengers`, {
    passengers,
  })
  return data.cabin
}

// Pedidos
export async function apiCreateOrder(payload: {
  cruiseId: string
  cabinNumber: number
  idempotencyKey: string
  items: Array<{ productId: string; qty: number; courtesy?: boolean }>
}) {
  const { data } = await http.post<{ order: Order; duplicated?: boolean }>('/orders', payload)
  return data
}

export async function apiOrders(params: {
  cruiseId?: string
  cabinNumber?: number
  status?: string
  annulment?: string
  before?: string
  limit?: number
}) {
  const { data } = await http.get<{ orders: Order[]; hasMore: boolean }>('/orders', { params })
  return data
}

export async function apiDeliverOrder(
  id: string,
  key: string,
  items?: Array<{ index: number; qty: number }>,
) {
  const { data } = await http.post<{ order: Order }>(`/orders/${id}/deliver`, { key, items })
  return data.order
}

export async function apiCancelOrder(
  id: string,
  reason: string,
  items?: Array<{ index: number; qty: number }>,
) {
  const { data } = await http.post<{ order: Order }>(`/orders/${id}/cancel`, { reason, items })
  return data.order
}

export async function apiRequestAnnulment(id: string, index: number, qty: number, reason: string) {
  const { data } = await http.post<{ order: Order }>(`/orders/${id}/annulments`, {
    index,
    qty,
    reason,
  })
  return data.order
}

export async function apiReviewAnnulment(
  orderId: string,
  annulmentId: string,
  decision: 'aprobar' | 'rechazar',
  restock = false,
  note = '',
) {
  const { data } = await http.post<{ order: Order }>(
    `/orders/${orderId}/annulments/${annulmentId}/review`,
    { decision, restock, note },
  )
  return data.order
}

// Cuentas
export async function apiCruiseAccounts(cruiseId: string) {
  const { data } = await http.get<{ cabins: CabinAccountRow[] }>(`/accounts/${cruiseId}`)
  return data.cabins
}

export async function apiCabinAccount(cruiseId: string, cabinNumber: number) {
  const { data } = await http.get<{ account: AccountSummary }>(
    `/accounts/${cruiseId}/${cabinNumber}`,
  )
  return data.account
}

export async function apiAccountAction(
  cruiseId: string,
  cabinNumber: number,
  action: 'submit' | 'approve' | 'return',
  reason?: string,
) {
  const { data } = await http.post<{ account: AccountSummary }>(
    `/accounts/${cruiseId}/${cabinNumber}/${action}`,
    reason ? { reason } : {},
  )
  return data.account
}

// Cobros
export async function apiCollectCabin(payload: {
  cruiseId: string
  cabinNumber: number
  method: PaymentMethod
  cashConfirmed?: boolean
  billing: { name?: string; idNumber?: string; email?: string; country?: string }
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

export async function apiReversePayment(id: string, reason: string) {
  const { data } = await http.post<{ payment: Payment }>(`/payments/${id}/reverse`, { reason })
  return data.payment
}

// Inventario
export async function apiStock(location: StockLocation) {
  const { data } = await http.get<{ items: StockItem[] }>('/inventory/stock', {
    params: { location },
  })
  return data.items
}

export async function apiRegisterWaste(payload: {
  productId: string
  qty: number
  reason: string
  location?: StockLocation
}) {
  await http.post('/inventory/waste', payload)
}

export async function apiAdjustStock(payload: {
  productId: string
  qty: number
  reason: string
  location: StockLocation
}) {
  await http.post('/inventory/adjust', payload)
}

export async function apiPurchase(payload: {
  supplier: string
  document: string
  items: Array<{ productId: string; containers: number; unitCost: number }>
}) {
  await http.post('/inventory/purchase', payload)
}

export async function apiTransfer(items: Array<{ productId: string; qty: number }>) {
  await http.post('/inventory/transfer', { items })
}

export async function apiMovements(
  params: {
    cruiseId?: string
    productId?: string
    type?: string
    location?: string
    before?: string
    limit?: number
  } = {},
) {
  const { data } = await http.get<{ movements: StockMovement[]; hasMore: boolean }>(
    '/inventory/movements',
    { params },
  )
  return data
}

// Conteos físicos
export async function apiCounts() {
  const { data } = await http.get<{ counts: StockCount[] }>('/counts')
  return data.counts
}

export async function apiCount(id: string) {
  const { data } = await http.get<{ count: StockCount }>(`/counts/${id}`)
  return data.count
}

export async function apiCreateCount(location: StockLocation) {
  const { data } = await http.post<{ count: StockCount }>('/counts', { location })
  return data.count
}

export async function apiSaveCount(
  id: string,
  lines: Array<{ product: string; physical: number | null; reason: string }>,
  notes?: string,
) {
  const { data } = await http.patch<{ count: StockCount }>(`/counts/${id}`, { lines, notes })
  return data.count
}

export async function apiCountAction(id: string, action: 'submit' | 'approve' | 'reject', note?: string) {
  const { data } = await http.post<{ count: StockCount }>(
    `/counts/${id}/${action}`,
    note ? { note } : {},
  )
  return data.count
}

// En vivo y reportes
export async function apiLive(since?: string) {
  const { data } = await http.get<LivePulse>('/live', { params: since ? { since } : {} })
  return data
}

export async function apiSalesSummary(
  params: { cruiseId?: string; from?: string; to?: string } = {},
) {
  const { data } = await http.get<SalesSummary>('/reports/sales', { params })
  return data
}

export async function apiSalesByCruise() {
  const { data } = await http.get<{ cruises: CruiseSales[] }>('/reports/by-cruise')
  return data.cruises
}

// Equipo
export async function apiUsers() {
  const { data } = await http.get<{ users: TeamUser[] }>('/users')
  return data.users
}

export async function apiCreateUser(payload: {
  name: string
  email: string
  password: string
  role: UserRole
  isCashier?: boolean
  position?: string
}) {
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
