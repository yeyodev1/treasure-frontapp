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
  CruiseStatus,
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
  BillingLine,
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

/** Bar por departamento + clave de 4 números (pedido del cliente, 12-nov-2026). */
export async function apiDepartmentLogin(department: string, pin: string, remember = false) {
  const { data } = await http.post<{ token: string; user: SessionUser }>('/auth/login/department', {
    department,
    pin,
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

/** Eliminar un crucero programado sin nada registrado (17-nov-2026). */
export async function apiDeleteCruise(id: string) {
  await http.delete(`/cruises/${id}`)
}

/** Cambio de cabina: sin passengerIds se mueve toda la cabina (con su cuenta si la de destino está vacía). */
export async function apiMoveCabin(cruiseId: string, cabinNumber: number, to: number, passengerIds?: string[]) {
  const { data } = await http.post<{ cruise: Cruise }>(`/cruises/${cruiseId}/cabins/${cabinNumber}/move`, { to, passengerIds })
  return data.cruise
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

/** Excel «Cobro bar» de un crucero: cobros con su factura y consumos (14-nov-2026). */
export async function apiCobroBar(cruiseId: string) {
  const { data, headers } = await http.get<Blob>(`/cruises/${cruiseId}/cobro-bar`, { responseType: 'blob' })
  const match = /filename="([^"]+)"/.exec(String(headers['content-disposition'] ?? ''))
  return { blob: data, fileName: match?.[1] ?? 'cobro-bar.xlsx' }
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
  billing: { name?: string; idNumber?: string; email?: string; country?: string; passengerId?: string; noEmail?: boolean }
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
/** Registro de cruceros de Gerencia: pasajeros y países por salida (16-nov-2026). */
export interface CruiseCalendarRow {
  id: string
  code: string
  name: string
  leg: string
  route: string
  startDate: string
  endDate: string | null
  status: CruiseStatus
  passengers: number
  /** Total consumido en el crucero (bar y wetsuits), sin pedidos cancelados. */
  consumed: number
  countries: Array<{ country: string; count: number }>
}

export async function apiCruiseCalendar() {
  const { data } = await http.get<{ cruises: CruiseCalendarRow[] }>('/reports/cruise-calendar')
  return data.cruises
}

/** Paras y dique del barco en el registro de cruceros (17-nov-2026). */
export interface ShipStopRow {
  id: string
  kind: 'para' | 'dique'
  from: string
  to: string
  note: string
  createdByName: string
}

export async function apiShipStops() {
  const { data } = await http.get<{ stops: ShipStopRow[] }>('/ship-stops')
  return data.stops
}

export async function apiCreateShipStop(payload: { kind: ShipStopRow['kind']; from: string; to: string; note: string }) {
  await http.post('/ship-stops', payload)
}

export async function apiDeleteShipStop(id: string) {
  await http.delete(`/ship-stops/${id}`)
}

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
    line?: BillingLine
    method?: string
    /** 'pendiente': efectivo que sigue en caja (sin depósito). */
    deposit?: 'pendiente'
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

/** Elimina la factura pendiente: el pago queda registrado sin factura. */
export async function apiDropInvoice(id: string, reason: string) {
  const { data } = await http.post<{ payment: Payment }>(`/payments/${id}/drop-invoice`, { reason })
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
  lines: Array<{ productId: string; qty: number; observation: string; counted: number | null }>,
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

/** El bar confirma lo recibido: por producto, cuántos envases llegaron. */
export async function apiArriveWeeklyOrder(
  id: string,
  key: string,
  items: Array<{ productId: string; source: DeliverySource; received: number }>,
  note = '',
  different = false,
) {
  const { data } = await http.post<{ order: WeeklyOrder }>(
    `/weekly-orders/${id}/deliveries/${encodeURIComponent(key)}/arrive`,
    { items, note, different },
  )
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
  email?: string
  password?: string
  role: UserRole
  isCashier?: boolean
  position?: string
  pin?: string
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
  /** Cóctel con cambio de gaseosa o licor (ids de insumos). */
  swaps?: Array<{ from: string; to: string }>
  /** Trago o cóctel con acompañante (ids de gaseosa, agua o jugo que también se descuentan). */
  mixers?: string[]
  /** Wetsuit con otro valor por persona (IVA incluido). */
  customPrice?: number
  /** Motivo del otro valor (solo Gerencia). */
  priceReason?: string
  /** Pasajero de la cabina que lo consume (cuentas separadas). */
  consumerId?: string
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

/** Cambia una cortesía por algo de más valor: se cobra solo la diferencia (16-nov-2026). */
export async function apiUpgradeCourtesy(id: string, productId: string, reason: string) {
  const { data } = await http.post<{ summary: CabinSummary }>(`/consumptions/${id}/upgrade`, { productId, reason })
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

export async function apiCreateCommissionPayment(payload: {
  cruiseIds: string[]
  paidAt: string
  note: string
  method?: 'transferencia' | 'efectivo'
  reference?: string
}) {
  const { data } = await http.post<CommissionSummary & { paymentId: string }>('/commissions/payments', payload)
  return data
}

export async function apiVoidCommissionPayment(id: string, reason: string) {
  const { data } = await http.post<CommissionSummary>(`/commissions/payments/${id}/void`, { reason })
  return data
}

// ── Resumen de Gerencia en dos vistas (especificación, 24-nov-2026) ──────────
export type SummaryPeriodKind = 'ano' | 'mes' | 'crucero'
export type Tone = 'verde' | 'amarillo' | 'rojo' | 'gris'

export interface SummaryPeriod {
  kind: SummaryPeriodKind
  value: string
  label: string
  from: string
  to: string
}

export interface SummaryAction {
  tone: 'rojo' | 'amarillo'
  text: string
  amount?: number
  count?: number
  to: string
  label: string
}

export interface BarSummary {
  period: SummaryPeriod
  partial: { since: string; label: string } | null
  cruise: { id: string; code: string; route: string; leg: string; status: string; start: string; end: string; bartender: string; agency: string } | null
  cruises: Array<{ id: string; code: string; status: string; start: string; end: string }>
  goals: Record<string, number | null>
  figures: {
    bar: number
    wetsuits: number
    services: number
    consumed: number
    collected: number
    collectedPct: number | null
    pendingCollection: number
    pendingCabins: number
    openCruises: string[]
    margin: number | null
    marginPct: number | null
    marginTone: Tone
    servedCost: number | null
    commissionCost: number
    productsWithoutCost: number
    compare: Array<{ label: string; value: number | null }>
  }
  actions: SummaryAction[]
  byMonth: Array<{ month: string; bar: number; wetsuits: number }>
  byDay: Array<{ day: string; total: number }>
  collectedRows: Array<{
    id: string
    code: string
    start: string
    end: string
    status: string
    consumed: number
    collected: number
    diff: number
    noInvoice: number
    tone: Tone
    /** Cobrado del crucero por forma de pago (el efectivo de un crucero no se mezcla con otro). */
    methods: { tarjeta: number; efectivo: number; transferencia: number }
  }>
  cabins: Array<{ cabin: number; consumed: number; paid: number; due: number; status: string }>
  wetsuits: {
    income: number
    rented: number
    passengers: number
    rentPct: number | null
    avgPrice: number | null
    rates: { ab: number | null; c: number | null }
    noInvoice: number
    rows: Array<{
      id: string
      code: string
      rented: number
      passengers: number
      income: number
      payer: string
      payerCabins: number[]
      state: string
      noInvoice: number
      offRate: boolean
      overCabins: Array<{ cabin: number; pax: number; rented: number }>
      tone: Tone
    }>
  }
  commissions: {
    rate: number
    divisor: number | null
    generated: number
    paid: number
    pending: number
    retained: number
    projected: number
    projectedFrom: string[]
    paidInYear: number
    rows: Array<{
      id: string
      code: string
      bartenderId: string | null
      bartenderName: string
      generic: boolean
      sales: number
      salesAll: number
      commission: number
      projected: number
      paid: number
      pending: number
      state: 'pagada' | 'parcial' | 'pendiente' | 'en_curso' | 'retenida'
    }>
    payments: Array<{ id: string; amount: number; paidAt: string; method: string; reference: string; status: string; bartenderName: string; items: Array<{ code: string; amount: number }>; voided: { reason: string } | null }>
  }
  agency: {
    rows: Array<{
      id: string
      code: string
      start: string
      end: string | null
      status: string
      agency: string
      agencyRuc: string
      agencyEmail: string
      bar: number
      barCount: number
      wetsuits: number
      wetsuitCount: number
      total: number
      pending: number
      state: string
    }>
    toInvoice: number
    invoicedUnpaid: number
    collected: number
    invoices: Array<{ id: string; number: string; month: string; agency: string; cruises: string[]; amount: number; paid: number; due: number; days: number; orphan: boolean; createdAt: string; tone: Tone }>
    maxDays: number
  }
  money: {
    methods: Array<{ method: string; count: number; total: number }>
    cashUndeposited: { count: number; total: number; oldestDays: number }
    depositsRegistered: number
    tone: Tone
  }
  perPaxDay: {
    value: number | null
    goal: number | null
    tone: Tone
    perCruise: Array<{ id: string; code: string; leg: string; value: number | null; tone: Tone }>
    perMonth: Array<{ month: string; value: number | null; tone: Tone }>
    byLeg: Array<{ leg: string; value: number | null }>
    compare: { label: string; value: number | null } | null
  }
  waste: {
    value: number | null
    pct: number | null
    finished: number
    counted: number
    missingCost: boolean
    belowZero: number
    belowZeroNames: string[]
    lastCount: string | null
    tone: Tone
  }
  team: Array<{ id: string; name: string; bar: number; wetsuits: number; annulments: number | null; unapproved: number; generic: boolean; tone: Tone }>
  served: Array<{ name: string; qty: number; amount: number }>
  commissionCruise: BarSummary['commissions']['rows'][number] | null
  agencyCruise: number | null
}

export interface OperationSummary {
  period: SummaryPeriod
  partial: { since: string; label: string } | null
  capacity: number
  figures: {
    cruises: number
    finished: number
    running: number
    passengers: number
    seats: number
    occupancy: number | null
    operatedDays: number
    paraDays: number
    diqueDays: number
    upcomingDays: number
    since: string | null
    compare: Array<{ label: string; cruises: number; pax: number }>
  }
  occupancy: Array<{ id: string; code: string; pax: number; capacity: number }>
  legs: Array<{ leg: string; pax: number }>
  countries: { total: number; rows: Array<{ country: string; count: number; pct: number }> }
  days: Array<{ day: string; state: 'navegando' | 'para' | 'dique' | 'por_venir' | 'sin_registro'; code: string; departs: boolean; arrives: boolean; today: boolean }>
  months: Array<{ month: string; navegando: number; para: number; dique: number; porVenir: number; sinRegistro: number; passengers: number; active: boolean }>
  years: Array<{ year: string; passengers: number; occupancy: number | null; nights: number }>
  cruise: {
    id: string
    code: string
    route: string
    leg: string
    status: string
    start: string
    end: string
    startTime: string
    endTime: string | null
    nights: number
    usedCabins: number
    cabinCount: number
    cabins: Array<{ number: number; holder: string; pax: number }>
  } | null
}

export interface GoalRow {
  key: string
  label: string
  unit: string
  initial: number | null
  value: number | null
}

export async function apiBarSummary(periodo: SummaryPeriodKind, valor: string) {
  const { data } = await http.get<BarSummary>('/reports/summary/bar', { params: { periodo, valor } })
  return data
}

export async function apiOperationSummary(periodo: SummaryPeriodKind, valor: string) {
  const { data } = await http.get<OperationSummary>('/reports/summary/operacion', { params: { periodo, valor } })
  return data
}

export async function apiGoals() {
  const { data } = await http.get<{ goals: GoalRow[]; history: Array<{ key: string; value: number | null; from: string; by: string }> }>('/goals')
  return data
}

export async function apiSaveGoal(key: string, value: number | null, from?: string) {
  await http.post('/goals', { key, value, from })
}

export async function apiDepositCash(ids: string[], reference: string, date?: string) {
  const { data } = await http.post<{ deposited: number; total: number }>('/payments/deposit', { ids, reference, date })
  return data
}

export async function apiAgencyInvoicePayment(id: string, payload: { amount: number; date?: string; reference?: string }) {
  await http.post(`/agency-billing/invoices/${id}/payments`, payload)
}

/** Recibo en PDF del pago de comisión (para firma): se abre en una pestaña nueva. */
export async function apiCommissionReceipt(id: string) {
  const { data } = await http.get<Blob>(`/commissions/payments/${id}/receipt`, { responseType: 'blob' })
  return data
}

// ── Bar-stock (especificación del 24-nov-2026) ─────────────────────────────
export async function apiUploadPhoto(file: File, folder = 'roturas') {
  const body = new FormData()
  body.append('file', file)
  body.append('folder', folder)
  const { data } = await http.post<{ url: string }>('/uploads', body, { timeout: 90000 })
  return data.url
}

export interface BarMovement {
  id: string
  at: string
  kind: 'rotura' | 'salida' | 'devolucion_tierra' | 'cortesia'
  exitKind: string
  product: string
  qty: number
  unit: string
  by: string
  authorizedBy: string
  note: string
  photo: string
  value: number
}

export async function apiCreateBarMovement(payload: {
  type: 'rotura' | 'salida' | 'devolucion_tierra'
  productId: string
  qty: number
  photo?: string
  note?: string
  exitKind?: 'cocina' | 'tripulacion' | 'brindis'
  authorizedById?: string
  key: string
}) {
  await http.post('/bar-stock/movements', payload)
}

export async function apiBarMovements(cruiseId?: string) {
  const { data } = await http.get<{ cruise: { id: string; code: string } | null; items: BarMovement[]; total: number }>(
    '/bar-stock/movements',
    { params: { cruiseId } },
  )
  return data
}

export type CountGroup = 'licores' | 'vinos' | 'cervezas' | 'gaseosas' | 'insumos'

export interface ClosingLine {
  product: string
  name: string
  group: CountGroup
  containerLabel: string
  containerSize: number
  caseSize: number
  countsOpen: boolean
  /** Lo que contó el bartender (envases); undefined = no lo ve quien mira (a ciegas). */
  physical?: number | null
  recount: number | null
  expected?: number
  result: '' | 'ok' | 'tolerancia' | 'corregido' | 'merma'
  motive: '' | 'rotura' | 'cortesia' | 'consumo' | 'faltante'
  value: number
  fullBottle: boolean
}

export interface ClosingCount {
  id: string
  code: string
  kind: 'cierre' | 'inicial' | 'admin'
  status: 'borrador' | 'enviado' | 'gerencia' | 'aprobado' | 'rechazado'
  cruise: string
  cutAt: string
  groups: Record<CountGroup, string>
  lines: ClosingLine[]
  pending: number
  toRecount: number
  wasteTotal: number
  toManagement: string[]
  submittedByName: string
  submittedAt: string | null
  verifiedByName: string
  verifiedAt: string | null
  decision: { approved: boolean; comment: string; byName: string; at: string } | null
}

export async function apiCurrentClosingCount() {
  const { data } = await http.get<{ count: ClosingCount | null; last: { id: string; code: string; verifiedAt: string; verifiedByName: string; wasteTotal: number } | null }>(
    '/bar-stock/counts/current',
  )
  return data
}

export async function apiStartInitialCount() {
  const { data } = await http.post<{ count: ClosingCount }>('/bar-stock/counts/initial')
  return data.count
}

export async function apiSaveClosingLines(id: string, lines: Array<{ productId: string; physical: number | null }>) {
  const { data } = await http.put<{ count: ClosingCount }>(`/bar-stock/counts/${id}/lines`, { lines })
  return data.count
}

export async function apiSendClosingCount(id: string) {
  const { data } = await http.post<{ count: ClosingCount }>(`/bar-stock/counts/${id}/send`)
  return data.count
}

export async function apiRecountLines(id: string, lines: Array<{ productId: string; recount?: number | null; motive?: string }>) {
  const { data } = await http.put<{ count: ClosingCount }>(`/bar-stock/counts/${id}/recount`, { lines })
  return data.count
}

export async function apiCloseClosingCount(id: string) {
  const { data } = await http.post<{ count: ClosingCount }>(`/bar-stock/counts/${id}/close`)
  return data.count
}

export async function apiDecideClosingCount(id: string, approved: boolean, comment: string) {
  const { data } = await http.post<{ count: ClosingCount }>(`/bar-stock/counts/${id}/decide`, { approved, comment })
  return data.count
}

export async function apiStartAuthorization(cruiseId: string, action: 'pedir' | 'autorizar' | 'negar', reason = '') {
  const { data } = await http.post<{ cruise: Cruise }>(`/cruises/${cruiseId}/start-authorization`, { action, reason })
  return data.cruise
}

export async function apiSignBarReceipt() {
  const { data } = await http.post<{ cruise: Cruise }>('/bar-stock/receipt')
  return data.cruise
}

/** Directoras y Gerencia: quién autoriza una salida del bar. */
export async function apiAuthorizers() {
  const { data } = await http.get<{ users: Array<{ _id: string; name: string; role: string }> }>('/users/authorizers')
  return data.users
}

/** Compra del jueves: por producto lo comprado, «no conseguido» o «reemplazado por…», sin costos. */
export async function apiPurchaseWeeklyOrder(
  id: string,
  key: string,
  items: Array<{ productId: string; qty: number; status: 'comprado' | 'no_conseguido' | 'reemplazado'; replacement?: string }>,
) {
  const { data } = await http.post<{ order: WeeklyOrder }>(`/weekly-orders/${id}/purchase`, { key, items })
  return data.order
}

export async function apiDirectorConfirmArrival(id: string, key: string) {
  const { data } = await http.post<{ order: WeeklyOrder }>(`/weekly-orders/${id}/deliveries/${key}/director-confirm`)
  return data.order
}

export async function apiDecideOutlier(id: string) {
  const { data } = await http.post<{ order: WeeklyOrder }>(`/weekly-orders/${id}/outlier-decision`, { accepted: true })
  return data.order
}

export async function apiDecideDifference(id: string, key: string, action: 'aceptada' | 'explicacion', note = '') {
  const { data } = await http.post<{ order: WeeklyOrder }>(`/weekly-orders/${id}/deliveries/${key}/difference-decision`, { action, note })
  return data.order
}

export interface BarStockSettings {
  purchaseResponsible: { id: string; name: string; role: string; until: string | null; isDefault: boolean } | null
  candidates: Array<{ id: string; name: string; role: string }>
}

export async function apiBarStockSettings() {
  const { data } = await http.get<BarStockSettings>('/bar-stock/settings')
  return data
}

export async function apiSaveBarStockSettings(userId: string | null, until: string | null) {
  const { data } = await http.put<Pick<BarStockSettings, 'purchaseResponsible'>>('/bar-stock/settings', { userId, until })
  return data
}
