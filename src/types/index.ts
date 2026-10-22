export type UserRole = 'admin' | 'direccion' | 'bartender' | 'bodega'

export interface SessionUser {
  id: string
  name: string
  email: string
  role: UserRole
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
  | 'otro'

export interface RecipeItem {
  product: { _id: string; name: string; price: number; unit: string } | string
  qty: number
}

export interface Product {
  _id: string
  name: string
  category: ProductCategory
  icon: string
  price: number
  unit: string
  warehouseStock: number
  isCocktail: boolean
  recipe: RecipeItem[]
  isCustom: boolean
  active: boolean
}

export type CruiseStatus = 'planificado' | 'abordo' | 'cerrado'

export interface Cabin {
  number: number
  guestName: string
  guestCount: number
  country: string
  email: string
  phone: string
  accountToken: string
}

export interface Cruise {
  _id: string
  name: string
  startDate: string
  endDate: string | null
  status: CruiseStatus
  cabins: Cabin[]
  notes: string
}

export interface OrderItem {
  product: string
  name: string
  qty: number
  unitPrice: number
  courtesy: boolean
}

export type OrderStatus = 'abierta' | 'cobrada' | 'anulada'

export interface Order {
  _id: string
  cruise: string
  cabinNumber: number
  items: OrderItem[]
  status: OrderStatus
  total: number
  createdBy: { _id: string; name: string; role: UserRole } | string
  createdAt: string
}

export interface AccountSummary {
  cabinNumber: number
  orders: Array<{
    id: string
    createdAt: string
    items: Array<{ name: string; qty: number; unitPrice: number; courtesy: boolean }>
    total: number
  }>
  subtotal: number
  courtesyTotal: number
  total: number
}

export type PaymentMethod = 'efectivo' | 'tarjeta' | 'transferencia' | 'online'
export type InvoiceStatus = 'pendiente' | 'emitida' | 'error' | 'no_aplica'

export interface Payment {
  _id: string
  cruise: { _id: string; name: string } | string
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
  collectedBy: { _id: string; name: string } | string
  createdAt: string
}

export interface CruiseStockItem {
  _id: string
  product: Product
  initialQty: number
  currentQty: number
}

export interface StockMovement {
  _id: string
  type: 'carga' | 'venta' | 'merma' | 'cortesia' | 'ajuste' | 'compra'
  product: { _id: string; name: string; unit: string; icon: string }
  qty: number
  reason: string
  user: { _id: string; name: string; role: UserRole }
  createdAt: string
}

export interface TeamUser {
  _id: string
  name: string
  email: string
  role: UserRole
  active: boolean
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

export interface LiveFeedEvent {
  id: string
  kind: 'pedido' | 'cobro' | 'inventario'
  at: string
  title: string
  detail: string
  amount: number | null
  by: string
}

export interface LivePulse {
  now: string
  cruise: { id: string; name: string; status: CruiseStatus } | null
  today: { total: number; orders: number }
  openAccounts: Array<{ cabinNumber: number; total: number; orders: number }>
  feed: LiveFeedEvent[]
}

export interface PublicAccount {
  cruiseName: string
  cabinNumber: number
  guestName: string
  account: AccountSummary
}
