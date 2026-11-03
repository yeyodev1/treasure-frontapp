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
    path: '/cuentas',
    name: 'Accounts',
    component: () => import('@/views/AccountsView.vue'),
    // El bar ve la cuenta de cada cabina en la pantalla del Bar (31-oct-2026);
    // Cuentas queda para Dirección: aprobar la prefactura y cobrar.
    meta: { title: 'Cuentas', roles: ['direccion'] },
  },
  {
    // Requerimientos: el bar pide, la directora aprueba, bodega recibe.
    path: '/abastecimiento',
    name: 'Requisitions',
    component: () => import('@/views/RequisitionsView.vue'),
    meta: { title: 'Abastecimiento', roles: ['admin', 'direccion', 'bartender', 'bodega'] },
  },
  {
    // Bodega en tablet: compras, recepciones, cargas al barco, conteos y mermas.
    path: '/bodega',
    name: 'Warehouse',
    component: () => import('@/views/BodegaView.vue'),
    meta: { title: 'Bodega', roles: ['admin', 'bodega', 'direccion'] },
  },
  // Controlar
  {
    path: '/admin/en-vivo',
    name: 'Live',
    component: () => import('@/views/admin/LiveView.vue'),
    meta: { title: 'En vivo', roles: ['admin', 'direccion'] },
  },
  {
    path: '/admin',
    name: 'Dashboard',
    component: () => import('@/views/admin/DashboardView.vue'),
    // Solo Gerencia: el servidor también lo restringe (/reports/*).
    meta: { title: 'Resumen del negocio', roles: ['duena'] },
  },
  {
    path: '/admin/inventario',
    name: 'Inventory',
    component: () => import('@/views/admin/InventoryView.vue'),
    meta: { title: 'Inventario', roles: ['admin', 'bodega', 'direccion'] },
  },
  {
    path: '/admin/pagos',
    name: 'Payments',
    component: () => import('@/views/admin/PaymentsView.vue'),
    meta: { title: 'Cobros', roles: ['admin', 'direccion'] },
  },
  // Administrar
  {
    path: '/admin/salidas',
    name: 'Cruises',
    component: () => import('@/views/admin/CruisesView.vue'),
    meta: { title: 'Cruceros', roles: ['admin', 'direccion'] },
  },
  { path: '/admin/cruceros', redirect: '/admin/salidas' },
  {
    path: '/admin/productos',
    name: 'Products',
    component: () => import('@/views/admin/ProductsView.vue'),
    meta: { title: 'Catálogo', roles: ['admin', 'bodega'] },
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
  admin: '/bodega',
  // Dirección empieza en Cruceros (primera pestaña): de ahí entra al bar.
  direccion: '/admin/salidas',
  bartender: '/',
  bodega: '/bodega',
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
