import { http } from './httpBase'
import type {
  AccountSummary,
  CommissionSummary,
  AgencyBilling,
  AgencyCourtesy,
  CourtesyKind,
  Availability,
  CabinAccountRow,
  CabinSummary,
  ContificoInfo,
  Cruise,
  CruiseSales,
  FinishCheck,
  OwnerPanel,
  Purchase,
  WeeklyOrder,
  WeeklyOrderCurrent,
  DeliverySource,
  Requisition,
  RequisitionStatus,
  PurchaseStatus,
  StartCheck,
  CycleSettings,
  NewCruiseOptions,
  NewCruisePlan,
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
export async function apiLogin(email: string, password: string, remember = false) {
  const { data } = await http.post<{ token: string; user: SessionUser }>('/auth/login', {
    email,
    password,
    remember,
  })
  return data
}

/** Sesión deslizante: renueva el token con la misma duración. */
export async function apiRefresh() {
  const { data } = await http.post<{ token: string; user: SessionUser }>('/auth/refresh')
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
  price: number,
) {
  const { data } = await http.post<{ product: Product }>('/products/custom-cocktail', {
    name,
    recipe,
    price,
  })
  return data.product
}

/** Quita de la carta un cóctel creado en el bar (lo vendido queda en el historial). */
export async function apiRemoveCustomCocktail(id: string) {
  const { data } = await http.post<{ product: Product }>(`/products/${id}/remove-custom`)
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

/** Nuevo crucero: tipo + fecha de inicio → fecha de fin, ruta, código y avisos. */
export async function apiPlanCruise(leg: string, startDate: string) {
  const { data } = await http.get<{ plan: NewCruisePlan }>('/cruises/plan', { params: { leg, startDate } })
  return data.plan
}

/** Fechas válidas de cada tipo (solo su día de zarpe) y el crucero sugerido. */
export async function apiNewCruiseOptions() {
  const { data } = await http.get<NewCruiseOptions>('/cruises/plan/options')
  return data
}

export async function apiCreatePlannedCruise(leg: string, startDate: string, bartender?: string) {
  const { data } = await http.post<{ cruise: Cruise }>('/cruises/plan', { leg, startDate, bartender: bartender || undefined })
  return data.cruise
}

/** Bartenders activos para asignar a un crucero (comisiones). */
export async function apiBartenders() {
  const { data } = await http.get<{ bartenders: Array<{ _id: string; name: string }> }>('/users/bartenders')
  return data.bartenders
}

export async function apiUpdateCruise(id: string, payload: Record<string, unknown>) {
  const { data } = await http.patch<{ cruise: Cruise }>(`/cruises/${id}`, payload)
  return data.cruise
}

/** Crucero unido: de qué cabina de un crucero anterior sigue cada cabina (fromCruise null = desunir). */
export async function apiUpdateContinuations(
  cruiseId: string,
  links: Array<{ to: number; fromCruise: string | null; fromCabin?: number }>,
) {
  const { data } = await http.put<{ cruise: Cruise }>(`/cruises/${cruiseId}/continuations`, { links })
  return data.cruise
}

export async function apiUpdatePassengers(
  cruiseId: string,
  cabinNumber: number,
  passengers: Passenger[],
  capacity?: number,
) {
  const { data } = await http.put(`/cruises/${cruiseId}/cabins/${cabinNumber}/passengers`, {
    passengers,
    capacity,
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

/** Quién de la cabina consumió cada consumo sin pagar (null = sin asignar). */
export async function apiAssignConsumers(
  cruiseId: string,
  cabinNumber: number,
  assignments: Array<{ orderId: string; passengerId: string | null }>,
) {
  const { data } = await http.post<{ account: AccountSummary }>(`/accounts/${cruiseId}/${cabinNumber}/assign`, { assignments })
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

/**
 * Prefactura en inglés (PDF) de la cuenta: solo la genera, sin correo ni
 * Contífico. `download` la pide como archivo adjunto.
 */
export async function apiProforma(cruiseId: string, cabinNumber: number, download = false) {
  const { data, headers } = await http.get<Blob>(`/accounts/${cruiseId}/${cabinNumber}/proforma`, {
    params: download ? { download: 1 } : {},
    responseType: 'blob',
  })
  const match = /filename="([^"]+)"/.exec(String(headers['content-disposition'] ?? ''))
  return { blob: data, fileName: match?.[1] ?? `proforma-cabin-${cabinNumber}.pdf` }
}

// Cobros
/** Una forma de pago del cobro. Sin monto = lo que falta. */
export interface CollectLine {
  method: PaymentMethod
  amount?: number
  reference?: string
  cashConfirmed?: boolean
}

export async function apiCollectCabin(payload: {
  cruiseId: string
  cabinNumber: number
  /** Varias cabinas a un mismo pagador (una factura). */
  cabins?: number[]
  /** Solo estos consumos (lo de una persona). */
  orderIds?: string[]
  /** Porcentaje de la cuenta que paga esta persona (su propia factura). */
  percent?: number
  /** Formas de pago del cobro ($10 efectivo + el resto con tarjeta). */
  lines?: CollectLine[]
  method?: PaymentMethod
  cashConfirmed?: boolean
  reference?: string
  /** Monto de este pago (parcial o el saldo completo). */
  amount?: number
  /** Saldo que vio quien cobra: si cambió, el servidor rechaza (doble clic). */
  expectedDue?: number
  /** false: no se le envía el resumen por correo al cliente. */
  notify?: boolean
  billing: { name?: string; idNumber?: string; email?: string; country?: string; passengerId?: string }
}) {
  const { data } = await http.post<{
    payment: Payment
    payments: Payment[]
    settled: boolean
    due: number
    email: { status: 'enviado' | 'error' | 'omitido'; to: string; error: string } | null
  }>('/payments/collect', payload)
  return data
}

/** Cortesías de agencia del crucero (se le facturan a la agencia al final). */
export async function apiAgencyCourtesies(cruiseId: string) {
  const { data } = await http.get<{ items: AgencyCourtesy[]; total: number }>(`/accounts/${cruiseId}/agency-courtesies`)
  return data
}

/** Factura mensual a la agencia: cruceros con cortesías de agencia, lo facturado y el aviso del 28. */
export async function apiAgencyBilling() {
  const { data } = await http.get<AgencyBilling>('/agency-billing')
  return data
}

export async function apiCreateAgencyInvoice(payload: { cruiseIds: string[]; month: string; to: string; invoiceNumber: string; note: string }) {
  const { data } = await http.post<AgencyBilling & { email: { status: 'enviado' | 'error'; to: string; error: string } | null }>(
    '/agency-billing/invoices',
    payload,
  )
  return data
}

export async function apiVoidAgencyInvoice(id: string, reason: string) {
  const { data } = await http.post<AgencyBilling>(`/agency-billing/invoices/${id}/void`, { reason })
  return data
}

/** Reenvía el resumen de la cuenta pagada al correo del pagador. */
export async function apiResendSummary(paymentId: string) {
  const { data } = await http.post<{ email: { status: string; to: string; error: string } }>(
    `/payments/${paymentId}/resend-summary`,
  )
  return data.email
}

export async function apiPayments(
  params: {
    cruiseId?: string
    from?: string
    to?: string
    before?: string
    limit?: number
    /** 'pendiente': facturas pendientes o con error de cobros vigentes. */
    invoice?: 'pendiente'
  } = {},
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

/** Estado de Contífico y su catálogo (para vincular productos). */
export async function apiContifico() {
  const { data } = await http.get<ContificoInfo>('/contifico')
  return data
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
  /** Misma clave en un reintento sin señal = no se duplica. */
  key?: string
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

/** Traslado entre ubicaciones; se registra cuando la mercadería llega. */
export async function apiTransfer(
  items: Array<{ productId: string; qty: number }>,
  key?: string,
  from: StockLocation = 'puerto',
  to: StockLocation = 'abordo',
) {
  const { data } = await http.post<{ ok: boolean; transferId: string; duplicated?: boolean }>(
    '/inventory/transfer',
    { items, key, from, to },
  )
  return data
}

/** Cierra el saldo de "Bodega sin separar" tras los conteos de Quito y Puerto (solo Gerencia). */
export async function apiCloseUnsplit() {
  const { data } = await http.post<{ ok: boolean; closed: number }>('/inventory/close-unsplit')
  return data
}

// Pedido semanal
export async function apiWeeklyOrderCurrent() {
  const { data } = await http.get<WeeklyOrderCurrent>('/weekly-orders/current')
  return data
}

export async function apiWeeklyOrder(id: string) {
  const { data } = await http.get<{ order: WeeklyOrder }>(`/weekly-orders/${id}`)
  return data.order
}

export async function apiSaveWeeklyOrder(
  id: string,
  version: number,
  lines: Array<{ productId: string; qty: number; observation: string }>,
) {
  const { data } = await http.put<{ order: WeeklyOrder }>(`/weekly-orders/${id}/lines`, { version, lines })
  return data.order
}

export async function apiSendWeeklyOrder(id: string, version: number) {
  const { data } = await http.post<{ order: WeeklyOrder }>(`/weekly-orders/${id}/send`, { version })
  return data.order
}

export async function apiApproveWeeklyOrder(id: string, version: number, noNeeds = false) {
  const { data } = await http.post<{ order: WeeklyOrder }>(`/weekly-orders/${id}/approve`, { version, noNeeds })
  return data.order
}

/** "Confirmar mi entrega" (administradora) o "Confirmar mi envío" (dueña). `key` evita duplicar. */
export async function apiFulfillWeeklyOrder(
  id: string,
  kind: 'deliver' | 'ship',
  body: { key: string; document: string; items: Array<{ productId: string; source: DeliverySource; qty: number; cost?: number }> },
) {
  const { data } = await http.post<{ order: WeeklyOrder }>(`/weekly-orders/${id}/${kind}`, body)
  return data.order
}

export async function apiArriveWeeklyOrder(id: string, key: string) {
  const { data } = await http.post<{ order: WeeklyOrder }>(`/weekly-orders/${id}/deliveries/${encodeURIComponent(key)}/arrive`)
  return data.order
}

export async function apiCancelWeeklyOrder(id: string, reason: string) {
  const { data } = await http.post<{ order: WeeklyOrder }>(`/weekly-orders/${id}/cancel`, { reason })
  return data.order
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

export async function apiCountAction(id: string, action: 'submit' | 'approve' | 'reject' | 'confirm', note?: string) {
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

// Ciclo de la salida: Programada → En curso → Finalizada
export async function apiStartCheck(id: string) {
  const { data } = await http.get<StartCheck>(`/cruises/${id}/start-check`)
  return data
}

export async function apiStartCruise(id: string) {
  const { data } = await http.post<{ cruise: Cruise; warnings?: StartCheck['warnings'] }>(
    `/cruises/${id}/start`,
  )
  return data
}

export async function apiFinishCheck(id: string) {
  const { data } = await http.get<FinishCheck>(`/cruises/${id}/finish-check`)
  return data
}

export async function apiFinishCruise(id: string, reason?: string) {
  const { data } = await http.post<{ cruise: Cruise }>(`/cruises/${id}/finish`, { reason })
  return data
}

// Consumo directo (un toque)
export interface ConsumptionPayload {
  cruiseId: string
  cabinNumber: number
  productId: string
  qty?: number
  courtesy?: boolean
  /** Motivo de la cortesía registrada desde el bar. */
  courtesyReason?: string
  /** Quién paga la cortesía: la casa o la agencia. */
  courtesyKind?: CourtesyKind
  idempotencyKey: string
  clientAt?: string
}

/** Wetsuit con el precio del trayecto del crucero (A y B, o C); null si el crucero no tiene trayecto. */
export async function apiWetsuit(cruiseId: string) {
  const { data } = await http.get<{ product: Pick<Product, '_id' | 'name' | 'price' | 'legs'> | null; leg: string }>(
    '/wetsuits',
    { params: { cruiseId } },
  )
  return data
}

export async function apiConsume(payload: ConsumptionPayload) {
  const { data, status } = await http.post<{
    order: Order
    summary?: CabinSummary
    duplicated?: boolean
    held?: boolean
  }>('/consumptions', payload)
  return { ...data, status }
}

export async function apiUndoConsumption(id: string, reason?: string) {
  const { data } = await http.post<{ order: Order; summary: CabinSummary }>(
    `/consumptions/${id}/undo`,
    { reason },
  )
  return data
}

export async function apiBonifyConsumption(id: string, reason: string, kind: CourtesyKind = 'casa') {
  const { data } = await http.post<{ order: Order; summary?: CabinSummary }>(`/consumptions/${id}/bonify`, { reason, kind })
  return data
}

export async function apiReviewHeld(id: string, decision: 'aceptar' | 'rechazar', reason: string) {
  const { data } = await http.post<{ order: Order }>(`/consumptions/${id}/held-review`, {
    decision,
    reason,
  })
  return data.order
}

export async function apiCabinSummary(cruiseId: string, cabinNumber: number) {
  const { data } = await http.get<{ summary: CabinSummary }>(
    `/consumptions/summary/${cruiseId}/${cabinNumber}`,
  )
  return data.summary
}

export async function apiAvailability() {
  const { data } = await http.get<{ availability: Availability }>('/consumptions/availability')
  return data.availability
}

export async function apiHeartbeat(payload: {
  deviceId: string
  label?: string
  pending: number
  lastSyncAt: string | null
  cruiseId?: string | null
}) {
  await http.post('/devices/heartbeat', payload)
}

// Requerimientos del bar
export async function apiRequisitions(
  params: { status?: RequisitionStatus[]; kind?: 'abastecimiento' | 'revision'; mine?: boolean; before?: string } = {},
) {
  const { data } = await http.get<{ requisitions: Requisition[]; hasMore: boolean }>('/requisitions', {
    params: {
      status: params.status?.join(',') || undefined,
      kind: params.kind,
      mine: params.mine ? '1' : undefined,
      before: params.before,
    },
  })
  return data
}

export async function apiCreateRequisition(payload: {
  kind?: 'abastecimiento' | 'revision'
  lines: Array<{ productId: string; qty: number; unit?: 'envase' | 'base' }>
  note?: string
  idempotencyKey?: string
}) {
  const { data } = await http.post<{ requisition: Requisition }>('/requisitions', payload)
  return data.requisition
}

export async function apiReviewRequisition(id: string, decision: 'aprobar' | 'rechazar', note?: string) {
  const { data } = await http.post<{ requisition: Requisition }>(`/requisitions/${id}/review`, {
    decision,
    note,
  })
  return data.requisition
}

/** Recepción física: cantidades en unidad base (ml, unidad…). */
export async function apiReceiveRequisition(
  id: string,
  key: string,
  lines: Array<{ index: number; qty: number }>,
  note?: string,
  from: StockLocation = 'puerto',
) {
  const { data } = await http.post<{ requisition: Requisition }>(`/requisitions/${id}/receive`, {
    key,
    lines,
    note,
    from,
  })
  return data.requisition
}

export async function apiCancelRequisition(id: string, reason: string) {
  const { data } = await http.post<{ requisition: Requisition }>(`/requisitions/${id}/cancel`, { reason })
  return data.requisition
}

export async function apiResolveRequisition(id: string, note: string) {
  const { data } = await http.post<{ requisition: Requisition }>(`/requisitions/${id}/resolve`, { note })
  return data.requisition
}

// Compras: factura (sin stock) → recepción física (suma con costo)
export async function apiPurchases(params: { status?: PurchaseStatus[]; before?: string; weeklyOrder?: string } = {}) {
  const { data } = await http.get<{ purchases: Purchase[]; hasMore: boolean }>('/purchases', {
    params: { status: params.status?.join(',') || undefined, before: params.before, weeklyOrder: params.weeklyOrder },
  })
  return data
}

export async function apiCreatePurchase(payload: {
  supplier: string
  document: string
  documentDate?: string
  destination: StockLocation
  lines: Array<{ productId: string; containers: number; containerCost?: number }>
  note?: string
  idempotencyKey?: string
  weeklyOrderId?: string
}) {
  const { data } = await http.post<{ purchase: Purchase }>('/purchases', payload)
  return data.purchase
}

/** Recepción física: cantidades en envases (botellas, latas…). */
export async function apiReceivePurchase(
  id: string,
  key: string,
  lines: Array<{ index: number; containers: number }>,
  note?: string,
  location?: StockLocation,
) {
  const { data } = await http.post<{ purchase: Purchase }>(`/purchases/${id}/receive`, {
    key,
    lines,
    note,
    location,
  })
  return data.purchase
}

export async function apiCancelPurchase(id: string, reason: string) {
  const { data } = await http.post<{ purchase: Purchase }>(`/purchases/${id}/cancel`, { reason })
  return data.purchase
}

// Panel de la dueña
export async function apiOwnerPanel(params: { cruiseId?: string; from?: string; to?: string } = {}) {
  const { data } = await http.get<OwnerPanel>('/reports/owner', { params })
  return data
}

// Comisiones del bartender (solo Gerencia)
export async function apiCommissions() {
  const { data } = await http.get<CommissionSummary>('/commissions')
  return data
}

export async function apiCreateCommissionPayment(payload: { cruiseIds: string[]; paidAt: string; note: string }) {
  const { data } = await http.post<CommissionSummary>('/commissions/payments', payload)
  return data
}

export async function apiVoidCommissionPayment(id: string, reason: string) {
  const { data } = await http.post<CommissionSummary>(`/commissions/payments/${id}/void`, { reason })
  return data
}
