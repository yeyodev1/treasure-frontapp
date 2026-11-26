import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useUserStore } from '@/stores/user'
import type { UserRole } from '@/types'

const routes: Array<RouteRecordRaw> = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: 'Ingresar', public: true },
  },
  {
    // Cuenta del pasajero: se abre desde el QR, sin sesión.
    path: '/cuenta/:token',
    name: 'PublicAccount',
    component: () => import('@/views/PublicAccountView.vue'),
    meta: { title: 'Tu cuenta', public: true },
  },
  // Operar
  {
    path: '/',
    name: 'Bar',
    component: () => import('@/views/BarView.vue'),
    meta: { title: 'Bar', roles: ['direccion', 'bartender'] },
  },
  {
    path: '/wetsuits',
    name: 'Wetsuits',
    component: () => import('@/views/WetsuitsView.vue'),
    meta: { title: 'Wetsuits', roles: ['direccion'] },
  },
  {
    path: '/cuentas',
    name: 'Accounts',
    component: () => import('@/views/AccountsView.vue'),
    // El bar ve la cuenta de cada cabina en la pantalla del Bar (31-oct-2026);
    // Cuentas queda para Dirección: aprobar la prefactura y cobrar.
    meta: { title: 'Cuentas', roles: ['direccion'] },
  },
  {
    // BAR - STOCK (pedido del cliente, 19-nov-2026): inventario de bebidas, una pantalla por perfil.
    path: '/bar-stock',
    name: 'BarStock',
    component: () => import('@/views/BarStockView.vue'),
    meta: { title: 'BAR - STOCK', roles: ['admin', 'direccion', 'bartender', 'bodega'] },
  },
  // Bar-stock (especificación del 24-nov-2026): se elimina el módulo Inventario (pedido semanal,
  // existencias, compras, conteos) y las bodegas; todo vive en BAR - STOCK. Los enlaces viejos llevan ahí.
  { path: '/inventario/:rest(.*)*', redirect: '/bar-stock' },
  { path: '/abastecimiento', redirect: '/bar-stock' },
  { path: '/bodega', redirect: '/bar-stock' },
  { path: '/admin/inventario', redirect: '/bar-stock' },
  // Controlar
  {
    path: '/admin/en-vivo',
    name: 'Live',
    component: () => import('@/views/admin/LiveView.vue'),
    meta: { title: 'En vivo', roles: ['direccion'] },
  },
  {
    path: '/admin',
    name: 'Dashboard',
    component: () => import('@/views/admin/DashboardView.vue'),
    // Solo Gerencia: el servidor también lo restringe (/reports/*).
    meta: { title: 'Resumen del negocio', roles: ['duena'] },
  },
  {
    path: '/admin/pagos',
    name: 'Payments',
    component: () => import('@/views/admin/PaymentsView.vue'),
    meta: { title: 'Cobros', roles: ['direccion'] },
  },
  // Administrar
  {
    path: '/admin/salidas',
    name: 'Cruises',
    component: () => import('@/views/admin/CruisesView.vue'),
    meta: { title: 'Cruceros', roles: ['direccion'] },
  },
  { path: '/admin/cruceros', redirect: '/admin/salidas' },
  {
    path: '/admin/productos',
    name: 'Products',
    component: () => import('@/views/admin/ProductsView.vue'),
    meta: { title: 'Catálogo', roles: [] },
  },
  {
    path: '/admin/equipo',
    name: 'Users',
    component: () => import('@/views/admin/UsersView.vue'),
    meta: { title: 'Equipo', roles: ['duena'] },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    redirect: '/',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

/** Primera vista a la que puede entrar cada rol. */
const ROLE_HOME: Record<UserRole, string> = {
  duena: '/admin/en-vivo',
  admin: '/bar-stock',
  // Dirección empieza en Cruceros (primera pestaña): de ahí entra al bar.
  direccion: '/admin/salidas',
  bartender: '/',
  bodega: '/bar-stock',
  capitan: '/',
  tripulante: '/',
  designada: '/',
}

export const REGISTROS_URL = import.meta.env.VITE_REGISTROS_URL || 'https://registros.teseturis.app'

/** La tripulación, el Capitán y la Persona Designada trabajan en Registros ISM. */
const REGISTROS_ROLES: UserRole[] = ['capitan', 'tripulante', 'designada']

router.beforeEach(async (to) => {
  const userStore = useUserStore()
  if (to.meta.public) return true

  if (!userStore.isLogged) {
    await userStore.restore()
  }
  if (!userStore.isLogged) {
    return { name: 'Login', query: { next: to.fullPath } }
  }

  if (userStore.role && REGISTROS_ROLES.includes(userStore.role)) {
    window.location.href = REGISTROS_URL
    return false
  }

  const roles = to.meta.roles as UserRole[] | undefined
  // La dueña entra a todo (salvo cuando mira la app como otro rol).
  if (roles && userStore.role && userStore.role !== 'duena' && !roles.includes(userStore.role)) {
    return ROLE_HOME[userStore.role]
  }
  return true
})

router.afterEach((to) => {
  document.title = to.meta.title
    ? `${to.meta.title} · Treasure of Galápagos`
    : 'Treasure of Galápagos'
})

export default router
export { ROLE_HOME }
