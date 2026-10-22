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
  {
    path: '/',
    name: 'Bar',
    component: () => import('@/views/BarView.vue'),
    meta: { title: 'Bar', roles: ['admin', 'direccion', 'bartender'] },
  },
  {
    path: '/cuentas',
    name: 'Accounts',
    component: () => import('@/views/AccountsView.vue'),
    meta: { title: 'Cuentas', roles: ['admin', 'direccion'] },
  },
  {
    path: '/admin',
    name: 'Dashboard',
    component: () => import('@/views/admin/DashboardView.vue'),
    meta: { title: 'Panel', roles: ['admin', 'direccion'] },
  },
  {
    path: '/admin/inventario',
    name: 'Inventory',
    component: () => import('@/views/admin/InventoryView.vue'),
    meta: { title: 'Inventario', roles: ['admin', 'bodega', 'direccion'] },
  },
  {
    path: '/admin/cruceros',
    name: 'Cruises',
    component: () => import('@/views/admin/CruisesView.vue'),
    meta: { title: 'Cruceros', roles: ['admin', 'direccion'] },
  },
  {
    path: '/admin/productos',
    name: 'Products',
    component: () => import('@/views/admin/ProductsView.vue'),
    meta: { title: 'Catálogo', roles: ['admin', 'bodega'] },
  },
  {
    path: '/admin/pagos',
    name: 'Payments',
    component: () => import('@/views/admin/PaymentsView.vue'),
    meta: { title: 'Cobros y facturas', roles: ['admin', 'direccion'] },
  },
  {
    path: '/admin/equipo',
    name: 'Users',
    component: () => import('@/views/admin/UsersView.vue'),
    meta: { title: 'Equipo', roles: ['admin'] },
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
  admin: '/admin',
  direccion: '/cuentas',
  bartender: '/',
  bodega: '/admin/inventario',
}

router.beforeEach(async (to) => {
  const userStore = useUserStore()
  if (to.meta.public) return true

  if (!userStore.isLogged) {
    await userStore.restore()
  }
  if (!userStore.isLogged) {
    return { name: 'Login', query: { next: to.fullPath } }
  }

  const roles = to.meta.roles as UserRole[] | undefined
  if (roles && userStore.role && !roles.includes(userStore.role)) {
    return ROLE_HOME[userStore.role]
  }
  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · Treasure Bar` : 'Treasure Bar'
})

export default router
export { ROLE_HOME }
