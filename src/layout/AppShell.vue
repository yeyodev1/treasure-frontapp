<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'
import type { UserRole } from '@/types'
import BrandSeal from '@/components/ui/BrandSeal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { REGISTROS_URL, ROLE_HOME } from '@/router'
import { apiAgencyBilling, apiWeeklyOrderCurrent } from '@/services/api'
import { formatMoney } from '@/utils/format'

interface NavItem {
  to: string
  label: string
  /** Nombre corto para la barra superior de tableta y celular. */
  short?: string
  icon: string
  roles: UserRole[]
  /** Activo también en sus subrutas (Inventario y pedidos y sus pestañas). */
  prefix?: boolean
}

interface NavSection {
  label: string
  items: NavItem[]
}

// Menú en tres grupos (guía visual V3): Operar / Controlar / Administrar.
// Cruceros va primero (pedido del cliente, 3-nov-2026): se inicia el crucero
// y desde ahí se entra al bar. Dirección no ve Bodega ni En vivo.
const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Operar',
    items: [
      { to: '/admin/salidas', label: 'Cruceros', icon: 'fa-ship', roles: ['duena', 'admin', 'direccion'] },
      { to: '/', label: 'Bar', icon: 'fa-martini-glass-citrus', roles: ['duena', 'direccion', 'bartender'] },
      { to: '/wetsuits', label: 'Wetsuits', icon: 'fa-person-swimming', roles: ['duena', 'direccion'] },
      { to: '/cuentas', label: 'Cuentas', icon: 'fa-file-invoice-dollar', roles: ['duena', 'direccion'] },
      { to: '/inventario', label: 'Inventario y pedidos', short: 'Inventario', icon: 'fa-boxes-stacked', roles: ['duena', 'admin', 'direccion', 'bartender', 'bodega'], prefix: true },
    ],
  },
  {
    label: 'Controlar',
    items: [
      { to: '/admin/en-vivo', label: 'En vivo', icon: 'fa-tower-broadcast', roles: ['duena', 'admin'] },
      { to: '/admin', label: 'Resumen del negocio', short: 'Resumen', icon: 'fa-chart-line', roles: ['duena'] },
      { to: '/admin/pagos', label: 'Cobros', icon: 'fa-cash-register', roles: ['duena', 'admin', 'direccion'] },
    ],
  },
  {
    label: 'Administrar',
    items: [
      { to: '/admin/productos', label: 'Catálogo', icon: 'fa-wine-bottle', roles: ['duena', 'admin', 'bodega'] },
      { to: '/admin/equipo', label: 'Equipo', icon: 'fa-users', roles: ['duena'] },
    ],
  },
]

/**
 * Pestañas superiores por perfil (guía "Cuatro personas, un mismo flujo",
 * 4-nov-2026). Siempre arriba y con texto, también en tableta horizontal. Lo
 * demás que el rol puede abrir queda en «Más». Los permisos no cambian.
 */
const PEDIDOS: NavItem = { to: '/inventario/pedido', label: 'Pedido semanal', short: 'Pedidos', icon: 'fa-list-check', roles: [] }
const ROLE_TABS: Partial<Record<UserRole, NavItem[]>> = {
  bartender: [
    // Los wetsuits los cobra la directora de crucero, no el bar (pedido del cliente, 6-nov-2026).
    { to: '/', label: 'Bar', icon: 'fa-martini-glass-citrus', roles: [] },
    { ...PEDIDOS, short: 'Pedido semanal' },
  ],
  direccion: [
    { to: '/admin/salidas', label: 'Cruceros', icon: 'fa-ship', roles: [] },
    { to: '/cuentas', label: 'Cuentas', icon: 'fa-file-invoice-dollar', roles: [] },
    PEDIDOS,
    { to: '/inventario/existencias', label: 'Existencias', icon: 'fa-boxes-stacked', roles: [] },
    { to: '/', label: 'Bar', icon: 'fa-martini-glass-citrus', roles: [] },
    { to: '/wetsuits', label: 'Wetsuits', icon: 'fa-person-swimming', roles: [] },
    { to: '/admin/pagos', label: 'Cobros', icon: 'fa-cash-register', roles: [] },
  ],
  admin: [
    PEDIDOS,
    { to: '/inventario/existencias?ubicacion=puerto', label: 'Bodega de puerto', icon: 'fa-anchor', roles: [] },
    { to: '/inventario/conteos', label: 'Conteo del barco', icon: 'fa-clipboard-list', roles: [] },
    { to: '/inventario/conteos?vista=diferencias', label: 'Diferencias', icon: 'fa-scale-unbalanced', roles: [] },
    { to: '/inventario/compras', label: 'Compras', icon: 'fa-truck-ramp-box', roles: [], prefix: true },
  ],
  duena: [
    { to: '/admin', label: 'Resumen del negocio', short: 'Resumen', icon: 'fa-chart-line', roles: [] },
    PEDIDOS,
    { to: '/inventario/existencias?ubicacion=quito', label: 'Bodega de Quito', icon: 'fa-city', roles: [] },
    { to: '/inventario/existencias', label: 'Inventario', icon: 'fa-boxes-stacked', roles: [] },
    { to: '/inventario/compras', label: 'Compras', icon: 'fa-truck-ramp-box', roles: [], prefix: true },
    { to: '/admin/equipo', label: 'Equipo', icon: 'fa-users', roles: [] },
  ],
}

const ROLE_LABELS: Record<UserRole, string> = {
  duena: 'Gerencia',
  admin: 'Administración',
  direccion: 'Dirección de crucero',
  bartender: 'Bartender',
  bodega: 'Bodega',
  capitan: 'Capitán',
  tripulante: 'Tripulación',
  designada: 'Persona Designada',
}

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const confirmStore = useConfirmStore()
const { muted, toggleMute, play } = useSound()

const drawerOpen = shallowRef(false)

const sections = computed(() =>
  NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => userStore.role && item.roles.includes(userStore.role),
    ),
  })).filter((section) => section.items.length),
)

// Las pestañas van siempre arriba, a la vista (la tripulación no encontraba
// el menú escondido tras el botón de tres rayas). Bodega conserva sus secciones.
const topItems = computed(
  () => (userStore.role && ROLE_TABS[userStore.role]) || sections.value.flatMap((section) => section.items),
)
/** «Más»: secciones que el rol puede abrir y no están en sus pestañas (y, para Gerencia, Ver como). */
const hasMore = computed(
  () =>
    userStore.isRealAdmin ||
    sections.value.some((sec) => sec.items.some((i) => !topItems.value.some((t) => t.to.split('?')[0] === i.to))),
)

function matches(item: NavItem): boolean {
  const [path, qs] = item.to.split('?')
  const pathOk = item.prefix ? route.path.startsWith(path!) : route.path === path
  if (!pathOk) return false
  return [...new URLSearchParams(qs ?? '')].every(([k, v]) => route.query[k] === v)
}

/** Activa: la pestaña más específica que coincide (Bodega de Quito antes que Inventario). */
function isOn(item: NavItem): boolean {
  if (!matches(item)) return false
  return !topItems.value.some((o) => o !== item && o.to.length > item.to.length && o.to.startsWith(item.to.split('?')[0]!) && matches(o))
}
const topnav = useTemplateRef<HTMLElement>('topnav')

// Si las secciones no caben, un desvanecido en el borde avisa que hay más.
const moreLeft = shallowRef(false)
const moreRight = shallowRef(false)

function measureTopnav() {
  const el = topnav.value
  if (!el) return
  moreLeft.value = el.scrollLeft > 4
  moreRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
}

function revealActiveTab() {
  nextTick(() => {
    const active = topnav.value?.querySelector<HTMLElement>('.topnav-item.router-link-exact-active')
    active?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
    measureTopnav()
  })
}

/**
 * Pedido semanal (guía 4-nov-2026): al bar le avisa que tiene la propuesta por
 * revisar; a la directora, si a las 18h00 el bar no la revisó (abre ese pedido).
 * Se consulta al entrar y cada 10 minutos; nunca aprueba nada.
 */
const orderNotice = shallowRef<{ text: string; tone: 'warn' | 'info'; id: string; action: string } | null>(null)
/** Desde el día 28 de cada mes: factura mensual a la agencia pendiente (solo Gerencia). */
const agencyNotice = shallowRef<string | null>(null)
let orderTimer: ReturnType<typeof setInterval> | null = null

/**
 * Aviso según el perfil, con el pedido exacto que nombra: bar → revisar;
 * directora → revisar/aprobar (y alerta si el bar no revisó); administración
 * y dueña → atender su parte del aprobado. Nadie recibe una tarea ajena.
 */
async function checkWeeklyOrder() {
  const r = userStore.role
  if (r !== 'bartender' && r !== 'direccion' && r !== 'admin' && r !== 'duena') return
  try {
    const { order, others } = await apiWeeklyOrderCurrent()
    const all = [order, ...others].filter((o): o is NonNullable<typeof o> => Boolean(o))
    const overdue = all.find((o) => o.overdue)
    const toReview = all.find((o) => o.status === 'directora')
    const toServe = all.find((o) => o.phase === 'atender' || o.phase === 'en_curso')
    const forBar = all.find((o) => o.status === 'bar')
    if (r === 'direccion' && overdue) {
      orderNotice.value = { id: overdue._id, tone: 'warn', action: 'Revisar y aprobar', text: `El bar no revisó el pedido ${overdue.code}.` }
    } else if (r === 'direccion' && toReview) {
      orderNotice.value = { id: toReview._id, tone: 'info', action: 'Revisar y aprobar', text: `El bar envió el pedido ${toReview.code} a revisión.` }
    } else if (r === 'bartender' && forBar) {
      orderNotice.value = { id: forBar._id, tone: forBar.overdue ? 'warn' : 'info', action: 'Revisar pedido', text: `El pedido semanal ${forBar.code} está listo para que lo revises.` }
    } else if ((r === 'admin' || r === 'duena') && toServe) {
      orderNotice.value = {
        id: toServe._id,
        tone: 'info',
        action: r === 'admin' ? 'Confirmar mi entrega' : 'Confirmar mi envío',
        text: `El pedido ${toServe.code} está aprobado: atiende tu parte.`,
      }
    } else {
      orderNotice.value = null
    }
  } catch {
    // Sin señal: el aviso se intenta de nuevo en el siguiente ciclo.
  }
  if (userStore.isOwner) {
    try {
      const { reminder } = await apiAgencyBilling()
      agencyNotice.value = reminder
        ? `Toca facturar a la agencia: ${formatMoney(reminder.amount)} de ${reminder.cruises} ${reminder.cruises === 1 ? 'crucero' : 'cruceros'}.`
        : null
    } catch {
      // Igual que el pedido: se reintenta en el siguiente ciclo.
    }
  }
}


onMounted(() => {
  window.addEventListener('resize', measureTopnav, { passive: true })
  measureTopnav()
  void checkWeeklyOrder()
  orderTimer = setInterval(() => void checkWeeklyOrder(), 10 * 60_000)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', measureTopnav)
  if (orderTimer) clearInterval(orderTimer)
})
watch(
  () => route.path,
  (path) => {
    if (path === '/inventario/pedido') void checkWeeklyOrder()
  },
)

const pageTitle = computed(() => (route.meta.title as string) ?? '')

/** En el bar el menú lateral se recoge a íconos: la tableta necesita el ancho. */
const railMode = computed(() => route.name === 'Bar')

const VIEW_AS_OPTIONS = [
  { value: 'duena', label: 'Mi vista (Gerencia)' },
  { value: 'admin', label: 'Ver como Administración' },
  { value: 'direccion', label: 'Ver como Dirección de crucero' },
  { value: 'bartender', label: 'Ver como Bartender' },
  { value: 'bodega', label: 'Ver como Bodega' },
]

const viewAsModel = computed({
  get: () => userStore.viewAs ?? 'duena',
  set: (value: string) => {
    userStore.setViewAs(value as UserRole)
    const target = ROLE_HOME[(userStore.role ?? 'duena') as UserRole]
    router.push(target)
  },
})

function exitViewAs() {
  viewAsModel.value = 'duena'
}

const initials = computed(() => {
  const name = userStore.user?.name ?? ''
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
})

// Al navegar se cierra el drawer en pantallas pequeñas.
watch(
  () => route.fullPath,
  () => {
    drawerOpen.value = false
    revealActiveTab()
  },
  { immediate: true },
)

function onToggleMute() {
  toggleMute()
  if (!muted.value) play('tap')
}

async function logout() {
  const ok = await confirmStore.ask({
    title: '¿Cerrar sesión?',
    message: 'Tu sesión en esta tableta o dispositivo se cerrará y volverás a la pantalla de ingreso.',
    confirmLabel: 'Salir',
    icon: 'fa-arrow-right-from-bracket',
  })
  if (!ok) return
  userStore.clear()
  router.replace({ name: 'Login' })
}
</script>

<template>
  <div class="shell">
    <div class="masthead">
    <header class="topbar">
      <div class="topbar-left">
        <!-- Las pestañas de arriba son el menú; «Más» abre lo demás que el rol puede usar. -->
        <button
          v-if="hasMore"
          class="menu-btn"
          type="button"
          :aria-label="drawerOpen ? 'Cerrar menú' : 'Abrir menú'"
          @click="drawerOpen = !drawerOpen"
        >
          <i class="fa-solid" :class="drawerOpen ? 'fa-xmark' : 'fa-bars'" aria-hidden="true" />
          <span class="menu-btn-label">Más</span>
        </button>
        <div class="brand">
          <BrandSeal :size="44" class="brand-seal" />
          <span class="brand-text">
            <span class="brand-eyebrow">Treasure of Galápagos</span>
            <span class="brand-page">{{ pageTitle }}</span>
          </span>
        </div>
      </div>

      <div class="session">
        <!-- Quién tiene la sesión iniciada en esta tablet (4-nov-2026). -->
        <span v-if="userStore.user" class="session-who" :title="`Sesión de ${userStore.user.name}`">
          <i class="fa-solid fa-circle-user" aria-hidden="true" />
          <span class="session-who-text">
            <strong>{{ userStore.user.name }}</strong>
            <small>
              {{ userStore.realRole ? ROLE_LABELS[userStore.realRole] : '' }}
              <template v-if="userStore.viewAs"> · viendo como {{ ROLE_LABELS[userStore.viewAs] }}</template>
            </small>
          </span>
        </span>
        <button
          class="icon-btn"
          type="button"
          :aria-label="muted ? 'Activar sonidos' : 'Silenciar sonidos'"
          :title="muted ? 'Activar sonidos' : 'Silenciar sonidos'"
          @click="onToggleMute"
        >
          <i class="fa-solid" :class="muted ? 'fa-volume-xmark' : 'fa-volume-high'" aria-hidden="true" />
        </button>
        <button class="session-out" type="button" @click="logout">
          <i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true" />
          <span class="session-out-label">Salir</span>
        </button>
      </div>
    </header>

    <div v-if="topItems.length" class="topnav-wrap" :class="{ 'topnav-wrap--left': moreLeft, 'topnav-wrap--right': moreRight }">
      <nav ref="topnav" class="topnav" aria-label="Secciones" @scroll.passive="measureTopnav">
        <RouterLink
          v-for="item in topItems"
          :key="item.to"
          :to="item.to"
          class="topnav-item"
          active-class=""
          exact-active-class=""
          :class="{ 'router-link-exact-active': isOn(item) }"
          :aria-current="isOn(item) ? 'page' : undefined"
          :aria-label="item.label"
        >
          <i class="fa-solid" :class="item.icon" aria-hidden="true" />
          <span>{{ item.short ?? item.label }}</span>
        </RouterLink>
      </nav>
    </div>
    </div>

    <div class="body">
      <Transition name="fade">
        <div v-if="drawerOpen" class="scrim" @click="drawerOpen = false" />
      </Transition>

      <nav class="sidenav" :class="{ 'sidenav--open': drawerOpen, 'sidenav--rail': railMode && !drawerOpen }">
        <div class="sidenav-sections">
          <div v-for="section in sections" :key="section.label" class="nav-section">
            <p class="nav-section-label">{{ section.label }}</p>
            <RouterLink
              v-for="item in section.items"
              :key="item.to"
              :to="item.to"
              class="nav-item"
              :class="{ 'router-link-exact-active': item.prefix && route.path.startsWith(item.to) }"
              :title="railMode ? item.label : undefined"
            >
              <span class="nav-indicator" aria-hidden="true" />
              <i class="fa-solid nav-icon" :class="item.icon" aria-hidden="true" />
              <span class="nav-label">{{ item.label }}</span>
            </RouterLink>
          </div>
          <div v-if="userStore.isRealAdmin" class="nav-section nav-section--extra">
            <p class="nav-section-label">Barco</p>
            <a :href="REGISTROS_URL" class="nav-item" target="_blank" rel="noopener">
              <span class="nav-indicator" aria-hidden="true" />
              <i class="fa-solid nav-icon fa-clipboard-check" aria-hidden="true" />
              <span class="nav-label">Registros ISM</span>
              <i class="fa-solid fa-arrow-up-right-from-square nav-external" aria-hidden="true" />
            </a>
          </div>
        </div>

        <div class="sidenav-bottom">
          <div v-if="userStore.isRealAdmin" class="view-as">
            <p class="view-as-label">
              <i class="fa-solid fa-eye" aria-hidden="true" /> Ver la app como
            </p>
            <BaseSelect v-model="viewAsModel" :options="VIEW_AS_OPTIONS" />
          </div>

          <div class="sidenav-user">
            <span class="user-avatar">{{ initials }}</span>
            <span class="user-info">
              <span class="user-name">{{ userStore.user?.name }}</span>
              <span class="user-role">
                {{ userStore.realRole ? ROLE_LABELS[userStore.realRole] : '' }}
              </span>
            </span>
          </div>
        </div>
      </nav>

      <main class="content">
        <Transition name="fade">
          <RouterLink
            v-if="orderNotice && route.path !== '/inventario/pedido'"
            :to="{ path: '/inventario/pedido', query: { id: orderNotice.id } }"
            class="order-notice"
            :class="`order-notice--${orderNotice.tone}`"
          >
            <i class="fa-solid" :class="orderNotice.tone === 'warn' ? 'fa-bell' : 'fa-list-check'" aria-hidden="true" />
            <span>{{ orderNotice.text }}</span>
            <strong>{{ orderNotice.action }} <i class="fa-solid fa-arrow-right" aria-hidden="true" /></strong>
          </RouterLink>
        </Transition>
        <Transition name="fade">
          <RouterLink v-if="agencyNotice && route.hash !== '#agencia'" to="/#agencia" class="order-notice order-notice--warn">
            <i class="fa-solid fa-handshake" aria-hidden="true" />
            <span>{{ agencyNotice }}</span>
            <strong>Facturar <i class="fa-solid fa-arrow-right" aria-hidden="true" /></strong>
          </RouterLink>
        </Transition>
        <!-- Aviso cuando administración está mirando la app como otro rol.
             Vive dentro del contenido para no desplazar el sidebar. -->
        <Transition name="fade">
          <div v-if="userStore.isRealAdmin && userStore.viewAs" class="viewing-as">
            <i class="fa-solid fa-eye" aria-hidden="true" />
            <span>
              Estás viendo la app como
              <strong>{{ ROLE_LABELS[userStore.viewAs] }}</strong>
            </span>
            <button type="button" class="viewing-as-exit" @click="exitViewAs">
              Volver a mi vista
            </button>
          </div>
        </Transition>
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.shell {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  // Portada del menú: azul empolvado con las algas a línea.
  background: var(--powder-300);
  border-bottom: 1px solid rgba(27, 43, 37, 0.22);
  color: var(--ink-900);
  box-sizing: border-box;
  height: calc(var(--bar-h) + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 0.75rem 0;
  position: relative;
  isolation: isolate;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: url('/brand/algas.png') center 40% / 320px auto repeat;
    opacity: 0.3;
    // Despeja el sello y el título: las algas aparecen hacia la derecha.
    mask-image: linear-gradient(to right, transparent 120px, #000 340px);
    pointer-events: none;
    z-index: -1;
  }
}

.shell {
  --bar-h: 64px;
  --nav-h: 66px;
  // Alto total de lo fijo arriba: barra + pestañas (en todos los tamaños, guía 4 perfiles).
  --header-h: calc(var(--bar-h) + var(--nav-h));
}

.masthead {
  position: sticky;
  top: 0;
  z-index: 30;
}

// Secciones siempre visibles en tableta y celular; en escritorio está el sidebar.
.topnav-wrap {
  position: relative;
  background: var(--surface);
  border-bottom: 1px solid var(--line);

  // Desvanecido en el borde con más secciones fuera de la vista.
  &::before,
  &::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 36px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease;
    z-index: 1;
  }

  &::before {
    left: 0;
    background: linear-gradient(to right, var(--surface), rgba(255, 255, 255, 0));
  }

  &::after {
    right: 0;
    background: linear-gradient(to left, var(--surface), rgba(255, 255, 255, 0));
  }

  &--left::before,
  &--right::after {
    opacity: 1;
  }
}

.topnav {
  display: flex;
  align-items: stretch;
  gap: 0.2rem;
  height: var(--nav-h);
  padding: 0.35rem 0.5rem;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;

  &::-webkit-scrollbar {
    display: none;
  }
}

// Pestañas con ícono arriba y nombre abajo: en tableta entran todas a la vista.
.topnav-item {
  flex: 1 0 auto;
  min-width: 68px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.22rem;
  padding: 0 0.6rem;
  border-radius: 12px;
  color: var(--ink-600);
  font-weight: 600;
  font-size: 0.82rem;
  line-height: 1.1;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease, transform 0.12s ease;

  i {
    font-size: 1.12rem;
    color: var(--navy-600);
    transition: color 0.15s ease;
  }

  &:active {
    transform: scale(0.96);
  }

  &:hover:not(.router-link-exact-active) {
    background: var(--powder-100);
    color: var(--ink-900);
  }

  &.router-link-exact-active {
    background: var(--navy-800);
    color: #fff;

    i {
      color: var(--powder-300);
    }
  }
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.menu-btn {
  @include touch-target;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0 0.5rem;
  font-weight: 600;
  border-radius: var(--radius-sm);
  color: var(--ink-900);
  font-size: 1.1rem;
  transition: background 0.15s ease, transform 0.15s ease;

  &:hover {
    background: rgba(27, 43, 37, 0.08);
  }

  &:active {
    transform: scale(0.94);
  }
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}

.brand-seal {
    flex-shrink: 0;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}

// La marca completa en pequeño arriba (nunca truncada) y la vista
// actual como título principal: se lee de un vistazo en cualquier pantalla.
.brand-eyebrow {
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--navy-700);
  white-space: nowrap;

  @include tablet {
    font-size: 0.7rem;
  }
}

.brand-page {
  font-family: var(--font-serif);
  font-size: 1.2rem;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @include tablet {
    font-size: 1.3rem;
  }
}

.session {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-shrink: 0;
}

.icon-btn {
  @include touch-target;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--ink-900);
  transition: background 0.15s ease, transform 0.15s ease;

  &:hover {
    background: rgba(27, 43, 37, 0.08);
  }

  &:active {
    transform: scale(0.94);
  }
}

.session-out {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-width: 48px;
  min-height: 44px;
  border: 1px solid rgba(27, 43, 37, 0.35);
  border-radius: var(--radius-sm);
  padding: 0.38rem 0.6rem;
  color: var(--ink-900);
  font-weight: 600;
  font-size: 0.92rem;
  transition: background 0.15s ease, border-color 0.15s ease;

  &:hover {
    background: rgba(27, 43, 37, 0.08);
    border-color: var(--navy-700);
  }

  @include tablet {
    padding: 0.38rem 0.8rem;
  }
}

.session-who {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  color: var(--ink-900);

  > i {
    font-size: 1.35rem;
  }
}

.session-who-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.15;

  strong {
    max-width: 22ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.92rem;
  }

  small {
    font-size: 0.75rem;
    color: var(--ink-600);
    white-space: nowrap;
  }
}

.session-out-label {
  display: none;

  @include tablet {
    display: inline;
  }
}

.body {
  display: flex;
  flex: 1;
  position: relative;
}

.scrim {
  position: fixed;
  inset: 0;
  background: rgba(15, 29, 22, 0.5);
  z-index: 24;
}

// Sidebar en todos los dispositivos: drawer deslizante en pantallas
// pequeñas, columna fija en escritorio.
.sidenav {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  width: 250px;
  padding: calc(var(--header-h) + 12px + env(safe-area-inset-top)) 0.8rem 1rem;
  background: var(--surface);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1rem;
  z-index: 25;
  transform: translateX(-100%);
  transition: transform 0.24s cubic-bezier(0.32, 0.72, 0.25, 1);
  overflow-y: auto;

  &--open {
    transform: translateX(0);
    box-shadow: var(--shadow-lg);
  }
}

// Menú recogido (solo íconos) en la pantalla del bar, desde tableta horizontal.
.sidenav--rail {
  @include desktop {
    width: 76px;
    padding-left: 0.55rem;
    padding-right: 0.55rem;
    transition: width 0.22s ease;

    .nav-section-label,
    .nav-label,
    .view-as,
    .viewing-as,
    .nav-section--extra,
    .user-name,
    .user-role {
      display: none;
    }

    .nav-item {
      justify-content: center;
      padding-left: 0;
      padding-right: 0;
    }
  }
}

.sidenav-sections {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.nav-section-label {
  margin: 0 0 0.3rem;
  padding: 0 0.8rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--ink-400);
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-height: 46px;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 0.97rem;
  color: var(--ink-600);
  transition: background 0.15s ease, color 0.15s ease;

  & + & {
    margin-top: 0.15rem;
  }

  .nav-indicator {
    position: absolute;
    left: 0;
    top: 22%;
    bottom: 22%;
    width: 3px;
    border-radius: 3px;
    background: var(--gold-500);
    opacity: 0;
    transform: scaleY(0.4);
    transition: opacity 0.18s ease, transform 0.18s ease;
  }

  &.router-link-exact-active {
    background: var(--navy-800);
    color: var(--cream-100);

    .nav-icon {
      color: var(--gold-500);
    }

    .nav-indicator {
      opacity: 1;
      transform: scaleY(1);
    }
  }

  &:hover:not(.router-link-exact-active) {
    background: var(--powder-100);
    color: var(--ink-900);
  }
}

.nav-external {
  margin-left: auto;
  font-size: 0.7rem;
  opacity: 0.6;
}

.nav-icon {
  width: 1.25rem;
  text-align: center;
  font-size: 0.95rem;
  color: var(--ink-400);
  transition: color 0.15s ease;
}

.viewing-as {
  position: sticky;
  top: calc(var(--header-h) + env(safe-area-inset-top));
  z-index: 23;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem max(16px, env(safe-area-inset-left, 0px));
  background: rgba(192, 138, 62, 0.16);
  border-bottom: 1px solid var(--warning);
  color: var(--navy-900);
  font-size: 0.92rem;

  i {
    color: var(--warning);
  }
}

.viewing-as-exit {
  margin-left: auto;
  min-height: 44px;
  font-weight: 700;
  font-size: 0.9rem;
  color: var(--navy-700);
  text-decoration: underline;
  white-space: nowrap;
}

.sidenav-bottom {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.view-as {
  padding: 0 0.2rem;
}

.view-as-label {
  margin: 0 0 0.35rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--ink-400);

  i {
    margin-right: 0.25rem;
    color: var(--gold-500);
  }
}

.sidenav-user {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.7rem 0.6rem;
  border-top: 1px solid var(--line);
}

.user-avatar {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--navy-800);
  color: var(--gold-400);
  font-family: var(--font-serif);
  font-size: 0.95rem;
  flex-shrink: 0;
}

.user-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}

.user-name {
  font-weight: 600;
  font-size: 0.88rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-role {
  font-size: 0.8rem;
  color: var(--ink-400);
}

.content {
  flex: 1;
  min-width: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.order-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  min-height: 52px;
  border-radius: var(--radius-sm);
  font-weight: 500;

  span {
    flex: 1 1 220px;
  }

  strong {
    white-space: nowrap;
  }

  &--warn {
    background: #fbf0dc;
    color: #6b4716;
  }

  &--info {
    background: var(--powder-100);
    color: var(--navy-800);
  }
}
</style>
