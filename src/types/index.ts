export type UserRole =
  | 'duena'
  | 'admin'
  | 'direccion'
  | 'bartender'
  | 'bodega'
  | 'capitan'
  | 'tripulante'
  | 'designada'

export interface SessionUser {
  id: string
  name: string
  email: string
  role: UserRole
  isCashier?: boolean
  position?: string
}

export type ProductCategory =
  | 'cerveza'
  | 'vino'
  | 'licor'
  | 'coctel'
  | 'gaseosa'
  | 'agua'
  | 'jugo'
  | 'snack'
  | 'insumo'
  | 'servicio'
  | 'otro'

export type ProductKind = 'fisico' | 'receta' | 'servicio'

/** Tipo de vino para dividir la carta del bar. */
export type WineStyle = 'tinto' | 'blanco' | 'rosado' | 'espumante'

export type StockUnit =
  | 'ml'
  | 'unidad'
  | 'g'
  | 'cucharadita'
  | 'cucharada'
  | 'ramita'
  | 'rodaja'
  | 'gota'
  | 'golpe'
  | 'porción'

/** Quito, Puerto en Galápagos y A bordo; "bodega" = saldo anterior sin separar (4-nov-2026). */
export type StockLocation = 'quito' | 'puerto' | 'abordo' | 'bodega'
export type ActiveLocation = Exclude<StockLocation, 'bodega'>

export interface RecipeIngredient {
  _id: string
  name: string
  kind: ProductKind
  stockUnit: StockUnit
  containerSize: number
  containerLabel: string
  servingSize: number
  servingPrice: number
}

export interface RecipeItem {
  product: RecipeIngredient | string
  qty: number
}

export interface PriceChange {
  price: number
  changedBy: { _id: string; name: string } | string
  at: string
}

/** Vaso o envase del icono del Bar (Especificación de color e iconos, 7-nov-2026). */
export type ServingIconKind =
  | 'martini'
  | 'alto'
  | 'corto'
  | 'copa'
  | 'flauta'
  | 'botvino'
  | 'botlicor'
  | 'mini'
  | 'cerveza'
  | 'lata'
  | 'agua'
  | 'descorche'

export interface Product {
  _id: string
  name: string
  category: ProductCategory
  icon: string
  kind: ProductKind
  price: number
  sellable: boolean
  stockUnit: StockUnit
  containerSize: number
  containerLabel: string
  warehouseStock: number
  quitoStock: number
  puertoStock: number
  onboardStock: number
  lowStockThreshold: number
  /** Envases a mantener en total (pedido semanal); 0 = sin objetivo. */
  stockTarget?: number
  servingSize: number
  servingPrice: number
  recipe: RecipeItem[]
  /** Solo vinos; vacío = sin clasificar. */
  wineStyle?: WineStyle | ''
  /** Icono de cómo se sirve en el Bar; vacío = regla por categoría. */
  servingIcon?: ServingIconKind | ''
  isCustom: boolean
  /** Trayectos donde se cobra (A, B, C); vacío = todos. Los wetsuits tienen precio por trayecto. */
  legs?: string[]
  active: boolean
  priceHistory: PriceChange[]
  /** Costo por unidad base (promedio de recepciones). */
  costPerUnit?: number
  /** Producto equivalente en Contífico para facturar. */
  contificoId?: string
  contificoCode?: string
}

export interface ContificoProduct {
  id: string
  codigo: string
  nombre: string
  pvp: number | null
  iva: number
}

export interface ContificoInfo {
  configured: boolean
  serie: string
  products: ContificoProduct[]
}

export type CruiseStatus = 'planificado' | 'abordo' | 'cerrado'

export interface Passenger {
  _id?: string
  name: string
  country: string
  nationality: string
  idNumber: string
  email: string
  phone: string
  isPayer: boolean
}

export interface Cabin {
  number: number
  passengers: Passenger[]
  guestName: string
  accountToken: string
  capacity?: number
  /** Crucero unido: viene de esta cabina de un crucero anterior (una sola cuenta). */
  continuesFrom?: { cruise: string; cabinNumber: number } | null
}

export interface Cruise {
  _id: string
  code: string
  leg: string
  routeFrom: string
  routeTo: string
  name: string
  startDate: string
  endDate: string | null
  status: CruiseStatus
  cabins: Cabin[]
  notes: string
  startedAt?: string | null
  closedAt?: string | null
  closeReason?: string
  /** Bartender del crucero (comisiones). */
  bartender?: string | null
  bartenderName?: string
}

export interface StartCheck {
  cruise: Cruise
  blockers: string[]
  warnings: { unavailable: string[]; low: string[] }
  occupancy: { cabins: number; occupied: number; passengers: number; empty: number[] }
}

export interface FinishCabin {
  number: number
  guestName: string
  passengers: number
  consumed: number
  paid: number
  due: number
  accountStatus: AccountStatus | 'sin_consumos' | 'continua'
  /** Crucero unido: "B-006 · cabina 3", se cobra allá. */
  continuesTo?: string | null
}

export interface FinishCheck {
  cruise: Cruise
  cabins: FinishCabin[]
  devices: Array<{
    deviceId: string
    label: string
    userName: string
    pending: number
    lastSyncAt: string | null
    lastSeenAt: string
    silent: boolean
  }>
  issues: string[]
  held: number
  finance: 'por_revisar' | 'por_cobrar' | 'liquidada'
  totals: { consumed: number; paid: number; due: number }
}

export interface CycleLeg {
  code: string
  label: string
  routeFrom: string
  routeTo: string
  durationDays: number
  departureTime: string
}

export interface CycleSettings {
  legs: CycleLeg[]
  cabinCount: number
}

/** Vista previa de Nuevo crucero: lo calcula el servidor con la regla del ciclo. */
export interface NewCruisePlan {
  code: string
  leg: string
  label: string
  routeFrom: string
  routeTo: string
  name: string
  startDate: string
  endDate: string
  endKey: string
  durationDays: number
  departureTime: string
  cabinCount: number
  weekday: { ok: boolean; expected: string; actual: string }
  overlap: {
    _id: string
    code: string
    name: string
    status: CruiseStatus
    startDate: string
    endDate: string | null
  } | null
}

/** Fechas válidas de zarpe de un tipo de crucero y cuáles están ocupadas. */
export interface CruiseLegOption {
  code: string
  label: string
  routeFrom: string
  routeTo: string
  durationDays: number
  departureTime: string
  /** Día de zarpe ("sábado", "martes"). */
  weekday: string
  dates: Array<{
    date: string
    endDate: string
    free: boolean
    conflict: NonNullable<NewCruisePlan['overlap']> | null
  }>
}

export interface NewCruiseOptions {
  legs: CruiseLegOption[]
  /** El que sigue en el ciclo, en su primera fecha libre. */
  suggestion: { leg: string; startDate: string } | null
  cabinCount: number
}

export interface OrderItem {
  product: string
  name: string
  qty: number
  unitPrice: number
  courtesy: boolean
  deliveredQty: number
  cancelledQty: number
  annulledQty: number
  applied?: Array<{ product: string; name: string; qty: number; stockUnit: string; unitCost: number }>
  unitCost?: number
  costComplete?: boolean
}

export type OrderStatus = 'pendiente' | 'entregada' | 'cancelada' | 'retenida'

export interface OrderAnnulment {
  _id: string
  index: number
  qty: number
  reason: string
  requestedBy: { _id: string; name: string } | string
  requestedAt: string
  status: 'pendiente' | 'aprobada' | 'rechazada'
  reviewNote: string
  restocked: boolean
}

export interface Order {
  _id: string
  cruise: string
  cabinNumber: number
  items: OrderItem[]
  status: OrderStatus
  total: number
  payment: string | null
  createdBy: { _id: string; name: string; role: UserRole } | string
  annulments: OrderAnnulment[]
  createdAt: string
  source?: 'directo' | 'pedido'
  clientAt?: string | null
  undo?: { by: string; at: string; reason: string } | null
  idempotencyKey?: string | null
}

/** Barra inferior del bar: último consumo y totales de la cabina. */
/** Consumo de la barra del bar; canUndo = se puede retirar, canCourtesy = marcar cortesía. */
export interface CabinConsumption {
  orderId: string
  /** Línea del pedido (los consumos directos tienen una sola: 0). */
  line?: number
  productId?: string
  name: string
  unitPrice?: number
  /** Registrado hoy (fecha comercial de Galápagos). */
  today?: boolean
  qty: number
  courtesy: boolean
  courtesyKind?: CourtesyKind
  total: number
  at: string
  /** Crucero unido: código del crucero anterior de donde viene el consumo. */
  fromCruise?: string | null
  by: string
  canUndo: boolean
  canCourtesy?: boolean
}

export interface CabinSummary {
  cabinNumber: number
  tripTotal: number
  todayTotal: number
  accountStatus: AccountStatus
  last: CabinConsumption | null
  /** Todos los consumos de la cabina en el viaje (el más nuevo primero). */
  recent?: CabinConsumption[]
}

export type Availability = Record<string, { available: boolean; missing: string }>

export type RequisitionStatus =
  | 'solicitado'
  | 'aprobado'
  | 'rechazado'
  | 'cancelado'
  | 'recibido_parcial'
  | 'recibido'
  | 'atendido'

export interface RequisitionLine {
  product:
    | {
        _id: string
        name: string
        stockUnit: StockUnit
        containerSize: number
        containerLabel: string
        icon: string
        warehouseStock: number
        quitoStock: number
        puertoStock: number
        onboardStock: number
      }
    | string
  name: string
  qty: number
  label: string
  receivedQty: number
}

export interface Requisition {
  _id: string
  code: string
  kind: 'abastecimiento' | 'revision'
  cruise: { _id: string; code: string; name: string } | string | null
  lines: RequisitionLine[]
  note: string
  status: RequisitionStatus
  requestedBy: { _id: string; name: string; role: UserRole } | string
  reviewedBy: { _id: string; name: string } | string | null
  reviewedAt: string | null
  reviewNote: string
  receipts: Array<{ key: string; lines: Array<{ index: number; qty: number }>; note: string; by: { name: string } | string; at: string }>
  createdAt: string
}

export type PurchaseStatus = 'registrada' | 'recibida_parcial' | 'recibida' | 'anulada' | 'cerrada'

export interface PurchaseLine {
  product: { _id: string; name: string; stockUnit: StockUnit; containerSize: number; containerLabel: string; icon: string } | string
  name: string
  containers: number
  containerSize: number
  containerLabel: string
  stockUnit: StockUnit
  qty: number
  containerCost: number
  receivedQty: number
}

export interface Purchase {
  _id: string
  code: string
  supplier: string
  document: string
  documentDate: string | null
  destination: StockLocation
  weeklyOrder?: { _id: string; code: string; week: string } | string | null
  lines: PurchaseLine[]
  total: number
  status: PurchaseStatus
  note: string
  receipts: Array<{ key: string; location?: StockLocation; lines: Array<{ index: number; qty: number }>; note: string; by: { name: string } | string; at: string }>
  createdBy: { _id: string; name: string } | string
  cancelReason: string
  createdAt: string
}

/** Resumen del negocio: un filtro (crucero o periodo) para todas las cifras. */
export interface OwnerPanel {
  scope: {
    mode: 'crucero' | 'periodo' | 'todo'
    cruise: {
      id: string
      code: string
      name: string
      route: string
      status: CruiseStatus
      startDate: string
      endDate: string | null
    } | null
    from: string | null
    cut: string
    generatedAt: string
    purchasesFrom: string | null
    purchasesTo: string
  }
  netConsumption: number
  collected: number
  byMethod: Record<string, number>
  pendingCollection: number
  pendingFromPeriod: number
  pendingFromBefore: number
  /** null = No disponible: faltan costos (un costo desconocido no vale cero). */
  consumedCost: number | null
  costsComplete: boolean
  /** Sin consumos en el alcance: costo y margen $0. */
  noConsumption?: boolean
  /** Retenidos y facturas: del crucero elegido o pendientes en total. */
  pendingScope?: 'alcance' | 'total'
  missingCost: string[]
  missingCostCount: number
  margin: number | null
  courtesy: number
  purchases: number
  heldConsumptions: number
  alerts: OwnerAlert[]
  byDay: Array<{ date: string; total: number; orders: number }>
  byBartender: Array<{ name: string; total: number; orders: number }>
  topProducts: Array<{ name: string; qty: number; total: number; courtesyQty: number }>
  byCruise: Array<{ id: string; name: string; startDate: string | null; collected: number; payments: number }>
  details: {
    consumption: OwnerConsumptionLine[]
    courtesy: OwnerConsumptionLine[]
    truncated: boolean
    payments: Array<{
      at: string
      cruise: string
      cabin: number
      method: PaymentMethod
      total: number
      invoiceStatus: InvoiceStatus
    }>
    pending: Array<{
      cruiseId: string
      cruise: string
      cabin: number
      amount: number
      orders: number
      oldest: string
      previous: boolean
    }>
    cost: Array<{ name: string; qty: number; cost: number | null }>
    purchases: Array<{
      code: string
      supplier: string
      document: string
      at: string
      status: PurchaseStatus
      partial: boolean
      invoiceTotal: number
      amount: number
      lines: Array<{ name: string; containers: number; label: string; amount: number }>
    }>
  }
}

export interface OwnerAlert {
  kind: 'cuentas' | 'costos' | 'conteos' | 'facturas' | 'retenidos'
  count: number
  amount?: number
  text: string
  action: string
  /** alcance: sigue el filtro; total: pendientes de todo el sistema. */
  scope?: 'alcance' | 'total'
}

export interface OwnerConsumptionLine {
  at: string
  cruise: string
  cabin: number
  item: string
  qty: number
  unitPrice: number
  amount: number
  courtesy: boolean
  by: string
}

export type AccountStatus = 'abierta' | 'en_revision' | 'aprobada' | 'cobrada'

export interface AccountLineItem {
  index: number
  name: string
  qty: number
  deliveredQty: number
  pendingQty: number
  cancelledQty: number
  annulledQty: number
  chargeableQty: number
  unitPrice: number
  courtesy: boolean
  /** Con cortesía: la casa la absorbe o se le factura a la agencia. */
  courtesyKind?: CourtesyKind
}

export type CourtesyKind = 'casa' | 'agencia'

export interface AccountSummary {
  cabinNumber: number
  status: AccountStatus
  version: number
  approvedVersion: number | null
  approvedTotal: number | null
  readyToCollect: boolean
  pendingDeliveries: number
  pendingAnnulments: number
  /** Consumos sin pago: se revisan, aprueban y cobran. */
  orders: AccountOrder[]
  subtotal: number
  courtesyTotal: number
  /** Consumos abiertos (lo que se aprueba). El saldo por cobrar es `due`. */
  total: number
  /** Pagos parciales recibidos sobre los consumos abiertos. */
  partialPaid: number
  /** La cuenta pagada conserva sus productos (checklist 29-oct, 01). */
  paidOrders: AccountOrder[]
  payments: AccountPayment[]
  consumed: number
  paid: number
  due: number
  courtesyAll: number
  history: Array<{ action: string; version: number; reason: string; by: string; at: string }>
}

export interface AccountOrder {
  id: string
  createdAt: string
  by: string
  status: OrderStatus
  items: AccountLineItem[]
  total: number
  /** Pasajero de la cabina que lo consumió (null = sin asignar). */
  consumerId: string | null
  consumerName: string
}

export interface AccountPayment {
  id: string
  createdAt: string
  method: PaymentMethod
  total: number
  /** false: pago parcial de una cuenta que aún tiene saldo. */
  settled: boolean
  /** Cobro al que pertenece (varias formas de pago = un cobro, una factura). */
  group?: string | null
  /** Parte por porcentaje con su propia factura. */
  part?: boolean
  /** Lleva la factura del cobro. */
  head?: boolean
  /** Quién pagó (datos de la factura). */
  payer?: string
  /** Cabinas cobradas juntas (en la cabeza del cobro). */
  cabins?: number[]
  invoiceStatus: InvoiceStatus
  invoiceNumber: string
  invoiceError: string
  /** Resumen por correo al pagador (solo el pago que liquida la cuenta). */
  summaryEmail: SummaryEmail
}

/** Cortesía de agencia: no se cobra a la cabina; se factura a la agencia. */
export interface AgencyCourtesy {
  orderId: string
  cabinNumber: number
  name: string
  qty: number
  unitPrice: number
  total: number
  reason: string
  by: string
  at: string
}

/** Factura mensual a la agencia (4-nov-2026): cruceros con cortesías de agencia y lo facturado. */
export interface AgencyCruise {
  id: string
  code: string
  name: string
  routeFrom: string
  routeTo: string
  startDate: string
  endDate: string | null
  status: CruiseStatus
  month: string
  count: number
  total: number
  invoiced: number
  pending: number
  state: 'facturada' | 'parcial' | 'pendiente'
  items: AgencyCourtesy[]
}

export interface AgencyInvoiceRow {
  id: string
  month: string
  amount: number
  items: Array<{ cruiseId: string; code: string; count: number; amount: number }>
  invoiceNumber: string
  sentTo: string
  sentAt: string | null
  note: string
  status: 'vigente' | 'anulada'
  by: string
  createdAt: string
  voided: { by: string; at: string; reason: string } | null
}

export interface AgencyBilling {
  reminderDay: number
  reminder: { month: string; amount: number; cruises: number } | null
  lastEmail: string
  totals: { total: number; invoiced: number; pending: number }
  cruises: AgencyCruise[]
  invoices: AgencyInvoiceRow[]
}

export interface SummaryEmail {
  status: 'no_aplica' | 'enviando' | 'enviado' | 'error'
  to: string
  sentAt: string | null
  error: string
}

export interface CabinAccountRow {
  cabinNumber: number
  guestName: string
  passengers: number
  status: AccountStatus
  version: number
  total: number
  orders: number
  pendingDeliveries: number
  paidOrders: number
  consumed: number
  paid: number
  /** Pagos parciales sobre la cuenta abierta. */
  partialPaid: number
  due: number
  /** Crucero unido: "B-006 · cabina 3", se cobra allá. */
  continuesTo?: string | null
}

export type PaymentMethod = 'efectivo' | 'tarjeta' | 'transferencia' | 'online'
export type InvoiceStatus = 'pendiente' | 'emitiendo' | 'emitida' | 'error' | 'no_aplica' | 'parcial'

export interface Payment {
  _id: string
  cruise: { _id: string; name: string; code: string } | string
  cabinNumber: number
  subtotal: number
  courtesyTotal: number
  /** Lo recibido en este pago. */
  total: number
  /** Total de la cuenta al cobrar (importe de la factura en el pago final). */
  accountTotal?: number | null
  /** false: pago parcial con saldo pendiente. */
  settled?: boolean
  settledBy?: string | null
  method: PaymentMethod
  reference?: string
  cashConfirmed: boolean
  billing: { name: string; idNumber: string; email: string; country: string }
  invoiceStatus: InvoiceStatus
  invoiceId: string
  invoiceNumber?: string
  invoiceUrl?: string
  /** Estado ante el SRI según Contífico (12-nov-2026). */
  invoiceSriStatus?: string
  invoiceEmail?: { status: string; to: string; sentAt: string | null; error: string }
  invoiceError: string
  status: 'vigente' | 'reversado'
  reverseReason: string
  reversedBy: { _id: string; name: string } | string | null
  collectedBy: { _id: string; name: string } | string
  accountVersion: number
  createdAt: string
}

export interface StockItem {
  product: Product
  byLocation: Record<StockLocation, number>
  qty: number
  containers: number
  negative: boolean
  low: boolean
}

export interface StockMovement {
  _id: string
  type: 'carga' | 'venta' | 'merma' | 'ajuste' | 'compra' | 'devolucion' | 'migracion'
  product: { _id: string; name: string; stockUnit: StockUnit; containerLabel: string; icon: string }
  location: StockLocation
  qty: number
  reason: string
  supplier: string
  document: string
  unitCost: number
  legacy: boolean
  user: { _id: string; name: string; role: UserRole }
  createdAt: string
}

export type CountStatus = 'borrador' | 'enviado' | 'aprobado' | 'rechazado'

export interface CountLine {
  product: string
  name: string
  stockUnit: StockUnit
  digitalAtCut: number
  physical: number | null
  reason: string
  /** Envase del producto (botella de 750 ml…): el conteo se muestra en envases. */
  containerSize?: number
  containerLabel?: string
}

export interface StockCount {
  _id: string
  code: string
  location: StockLocation
  cruise: { _id: string; code: string; name: string } | null
  status: CountStatus
  cutAt: string
  lines?: CountLine[]
  notes: string
  createdBy: { _id: string; name: string } | null
  submittedBy: { _id: string; name: string } | null
  submittedAt: string | null
  reviewedBy: { _id: string; name: string } | null
  reviewedAt: string | null
  reviewNote: string
  createdAt: string
  /** Solo en la lista: productos contados y cuántos no coincidieron con el sistema. */
  countedLines?: number
  differences?: number
}

export interface TeamUser {
  _id: string
  name: string
  email: string
  role: UserRole
  active: boolean
  isCashier: boolean
  position?: string
  /** Tiene clave de 4 números para entrar al bar por departamento. */
  hasPin?: boolean
  /** La clave de 4 números, visible para Gerencia (12-nov-2026). */
  barPin?: string
  createdBy: { _id: string; name: string } | null
  updatedBy: { _id: string; name: string } | null
  createdAt: string
  updatedAt: string
}

export interface SalesSummary {
  totals: { total: number; orders: number }
  byDay: Array<{ date: string; total: number; orders: number }>
  byUser: Array<{ name: string; role: UserRole; total: number; orders: number }>
  topProducts: Array<{ name: string; qty: number; total: number; courtesyQty: number }>
}

export interface CruiseSales {
  id: string
  name: string
  startDate: string
  status: CruiseStatus
  collected: number
  courtesies: number
  payments: number
}

export type LiveKind =
  | 'consumo'
  | 'requerimiento'
  | 'compra'
  | 'registro'
  | 'pedido'
  | 'entrega'
  | 'cancelacion'
  | 'anulacion'
  | 'cuenta'
  | 'cobro'
  | 'inventario'
  | 'conteo'
  | 'catalogo'
  | 'equipo'
  | 'salida'

export interface LiveFeedEvent {
  id: string
  kind: LiveKind
  at: string
  title: string
  detail: string
  amount: number | null
  by: string
}

export interface LivePulse {
  now: string
  commercialDate: string
  cruise: { id: string; code: string; name: string; status: CruiseStatus } | null
  today: { total: number; orders: number }
  pending: { deliveries: number; reviews: number; annulments: number; counts: number }
  openAccounts: Array<{ cabinNumber: number; total: number; orders: number; pending: number }>
  feed: LiveFeedEvent[]
}

export interface PublicAccount {
  cruiseName: string
  cabinNumber: number
  guestName: string
  account: {
    cabinNumber: number
    orders: Array<{
      id: string
      createdAt: string
      total: number
      items: Array<{ name: string; qty: number; unitPrice: number; courtesy: boolean }>
    }>
    payments: Array<{ createdAt: string; method: PaymentMethod; total: number }>
    subtotal: number
    courtesyTotal: number
    total: number
    paid: number
    due: number
  }
}

/** Comisiones del bartender (solo Gerencia): 10 % de las ventas del bar ÷ 1,21. */
export interface CruiseCommission {
  id: string
  code: string
  name: string
  routeFrom: string
  routeTo: string
  startDate: string
  endDate: string | null
  startedAt: string | null
  closedAt: string | null
  status: CruiseStatus
  /** Bartender del crucero; null = sin asignar. */
  bartenderId: string | null
  bartenderName: string
  orders: number
  sales: number
  commission: number
  paid: number
  pending: number
  state: 'pagada' | 'parcial' | 'pendiente'
  /** Comisión acumulada hasta este crucero (del más antiguo al más reciente). */
  accumulated: number
}

export interface CommissionPaymentRow {
  id: string
  amount: number
  paidAt: string
  note: string
  status: 'vigente' | 'anulado'
  by: string
  /** Pagos antiguos (antes del 4-nov) no tienen bartender ni detalle. */
  bartenderId: string | null
  bartenderName: string
  items: Array<{ cruiseId: string; code: string; sales: number; amount: number }>
  createdAt: string
  voided: { by: string; at: string; reason: string } | null
}

export interface BartenderCommission {
  id: string | null
  name: string
  cruises: number
  sales: number
  generated: number
  paid: number
  pending: number
}

export interface CommissionSummary {
  rate: number
  divisor: number
  totals: { sales: number; generated: number; paid: number; pending: number; cruises: number }
  bartenders: BartenderCommission[]
  cruises: CruiseCommission[]
  payments: CommissionPaymentRow[]
  /** Solo al registrar un pago. */
  paymentId?: string
}

/** Pedido semanal (guía Inventario y pedidos, 4-nov-2026). */
export type WeeklyOrderStatus = 'bar' | 'directora' | 'aprobado' | 'cancelado'
export type WeeklyOrderPhase = 'bar' | 'directora' | 'atender' | 'en_curso' | 'completo' | 'sin_necesidades' | 'cancelado'
/** De dónde sale lo que se entrega al barco. */
export type DeliverySource = 'puerto' | 'quito' | 'compra'

export interface WeeklyOrderContribution {
  key: string
  kind: 'entrega' | 'envio'
  source: DeliverySource
  qty: number
  byName: string
  at: string
  arrived: boolean
}

export interface WeeklyOrderDelivery {
  key: string
  kind: 'entrega' | 'envio'
  at: string
  byName: string
  items: Array<{ product: string; name: string; source: DeliverySource; qty: number; cost: number }>
  document: string
  arrivedAt: string | null
  arrivedByName: string
}

export interface WeeklyOrderLine {
  product: string
  name: string
  stockUnit: StockUnit
  containerSize: number
  containerLabel: string
  atCut: Record<StockLocation, number>
  target: number
  incoming: number
  consumption: number
  suggested: number | null
  basis: 'objetivo' | 'consumo' | 'revisar' | 'agregado'
  qty: number
  barQty: number | null
  approvedQty: number | null
  observation: string
  editedByName: string
  editedAt: string | null
  /** Avance en envases: ya en el barco, enviado sin llegar y lo que falta atender. */
  delivered: number
  inTransit: number
  pending: number
  contributions: WeeklyOrderContribution[]
}

export interface WeeklyOrder {
  _id: string
  code: string
  week: string
  cutAt: string
  generatedLate: boolean
  status: WeeklyOrderStatus
  phase: WeeklyOrderPhase
  phaseLabel: string
  overdue: boolean
  version: number
  revision: number
  changedAt: string | null
  recipient: string
  noNeeds: boolean
  lines: WeeklyOrderLine[]
  deliveries: WeeklyOrderDelivery[]
  history: Array<{ at: string; byName: string; action: string; detail: string }>
  createdAt: string
}

export interface WeeklyOrderCurrent {
  order: WeeklyOrder | null
  others: Array<{ _id: string; code: string; week: string; cutAt: string; status: WeeklyOrderStatus; phase: WeeklyOrderPhase; overdue: boolean }>
  nextCut: string
}
