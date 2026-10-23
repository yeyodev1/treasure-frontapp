export type UserRole = 'admin' | 'direccion' | 'bartender' | 'bodega'

export interface SessionUser {
  id: string
  name: string
  email: string
  role: UserRole
  isCashier?: boolean
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

export type StockLocation = 'bodega' | 'abordo'

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
  onboardStock: number
  lowStockThreshold: number
  servingSize: number
  servingPrice: number
  recipe: RecipeItem[]
  isCustom: boolean
  active: boolean
  priceHistory: PriceChange[]
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

export interface OrderItem {
  product: string
  name: string
  qty: number
  unitPrice: number
  courtesy: boolean
  deliveredQty: number
  cancelledQty: number
  annulledQty: number
}

export type OrderStatus = 'pendiente' | 'entregada' | 'cancelada'

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
}

export interface AccountSummary {
  cabinNumber: number
  status: AccountStatus
  version: number
  approvedVersion: number | null
  approvedTotal: number | null
  readyToCollect: boolean
  pendingDeliveries: number
  pendingAnnulments: number
  orders: Array<{
    id: string
    createdAt: string
    by: string
    status: OrderStatus
    items: AccountLineItem[]
    total: number
  }>
  subtotal: number
  courtesyTotal: number
  total: number
  history: Array<{ action: string; version: number; reason: string; by: string; at: string }>
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
}

export type PaymentMethod = 'efectivo' | 'tarjeta' | 'transferencia' | 'online'
export type InvoiceStatus = 'pendiente' | 'emitida' | 'error' | 'no_aplica'

export interface Payment {
  _id: string
  cruise: { _id: string; name: string; code: string } | string
  cabinNumber: number
  subtotal: number
  courtesyTotal: number
  total: number
  method: PaymentMethod
  cashConfirmed: boolean
  billing: { name: string; idNumber: string; email: string; country: string }
  invoiceStatus: InvoiceStatus
  invoiceId: string
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
}

export interface TeamUser {
  _id: string
  name: string
  email: string
  role: UserRole
  active: boolean
  isCashier: boolean
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
    subtotal: number
    courtesyTotal: number
    total: number
  }
}
